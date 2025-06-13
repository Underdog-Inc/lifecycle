/**
 * Copyright 2025 GoodRx, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-unused-vars */
import rootLogger from 'server/lib/logger';
import BaseService from './_service';
import Bull from 'bull';
import fs from 'fs';
import { JOB_VERSION, TMP_PATH } from 'shared/config';
import _ from 'lodash';
import { IngressConfiguration } from '../../server/services/build';
import { shellPromise } from 'server/lib/shell';
import yaml from 'js-yaml';
import { redisClient } from 'server/lib/dependencies';
import GlobalConfigService from './globalConfig';

const MANIFEST_PATH = `${TMP_PATH}/ingress`;

const logger = rootLogger.child({
  filename: 'services/ingress.ts',
});

export default class IngressService extends BaseService {
  async updateIngressManifest(): Promise<boolean> {
    return true;
  }

  /**
   * Job for generating manifests
   */
  ingressManifestQueue = this.queueManager.registerQueue(`ingress-manifest-${JOB_VERSION}`, {
    createClient: redisClient.getBullCreateClient(),
    defaultJobOptions: {
      attempts: 5,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
    settings: {
      maxStalledCount: 1,
    },
  });

  /**
   * Job for cleaning up ingress
   */
  ingressCleanupQueue = this.queueManager.registerQueue(`ingress-cleanup-${JOB_VERSION}`, {
    createClient: redisClient.getBullCreateClient(),
    defaultJobOptions: {
      attempts: 5,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
    settings: {
      maxStalledCount: 1,
    },
  });

  /**
   * Cleans up ingresses for a build that has been deleted
   * @param job a job with a buildId in the data object
   * @param done the done callback
   */
  ingressCleanupForBuild = async (job: Bull.Job<any>, done: Bull.DoneCallback) => {
    const buildId = job.data.buildId;
    // For cleanup purpose, we want to include the ingresses for all the services (active or not) to cleanup just in case.
    const configurations = await this.db.services.BuildService.configurationsForBuildId(buildId, true);
    const namespace = await this.db.services.BuildService.getNamespace({ id: buildId });
    try {
      configurations.forEach(async (configuration) => {
        await shellPromise(`kubectl delete ingress ingress-${configuration.deployUUID} --namespace ${namespace}`).catch(
          (error) => {
            logger.warn(`[DEPLOY ${configuration.deployUUID}] ${error}`);
            return null;
          }
        );
      });
    } catch (e) {
      // It's ok if this fails.
      logger.warn(e);
    }
    done();
  };

  createOrUpdateIngressForBuild = async (job: Bull.Job<any>, done: Bull.DoneCallback) => {
    const buildId = job.data.buildId;
    // We just want to create/update ingress for active services only
    const configurations = await this.db.services.BuildService.configurationsForBuildId(buildId, false);
    const namespace = await this.db.services.BuildService.getNamespace({ id: buildId });
    const { lifecycleDefaults } = await GlobalConfigService.getInstance().getAllConfigs();
    const manifests = configurations.map((configuration) => {
      return yaml.dump(
        this.generateNginxManifestForConfiguration({
          configuration,
          defaultUUID: lifecycleDefaults?.defaultUUID,
          ingressClassName: lifecycleDefaults?.ingressClassName,
        }),
        {
          skipInvalid: true,
        }
      );
    });
    manifests.forEach(async (manifest, idx) => {
      await this.applyManifests(manifest, `${buildId}-${idx}-nginx`, namespace);
    });
    done();
  };

  /**
   * Generates an nginx manifest for an ingress configuration
   * @param configuration the ingress configuration that describes a deploy object
   * @param defaultUUID the default UUID from global configuration
   * @param ingressClassName the ingress class name from global configuration (defaults to 'nginx' if not set)
   */
  private generateNginxManifestForConfiguration = ({
    configuration,
    defaultUUID,
    ingressClassName,
  }: {
    configuration: IngressConfiguration;
    defaultUUID: string;
    ingressClassName?: string;
  }) => {
    const annotations = {
      // Default annotations for all ingresses
      'nginx.ingress.kubernetes.io/configuration-snippet': `proxy_set_header Authorization $http_authorization;
proxy_set_header X-Forwarded-For "$http_x_forwarded_for, $http_cf_connecting_ip";
proxy_set_header X-Request-Start "t=$msec";
add_header "Access-Control-Expose-Headers" "Authorization, Location-Expires";`,
      'nginx.ingress.kubernetes.io/cors-allow-headers':
        'Authorization,Cache-Control,Client-Request-Id,Client-Device-Id,Client-Type,Client-Version,Content-Type,DNT,If-Modified-Since,Keep-Alive,Location-Expires,Referring-Link,UD-Auth0-Forwarded-For,UD-Idempotency-Key,UD-User-ID,User-Agent,User-Latitude,User-Location-Token,User-Geo-Comply-License-Key,User-Longitude,X-Requested-With,X-Request-Start',
      'nginx.ingress.kubernetes.io/cors-allow-methods': 'GET, PUT, POST, OPTIONS, DELETE, PATCH',
      'nginx.ingress.kubernetes.io/cors-allow-origin': '*',
      'nginx.ingress.kubernetes.io/enable-cors': 'true',
      // Allow configuration-specific annotations to override defaults
      ...configuration.ingressAnnotations,
    };
    if (configuration.ipWhitelist && configuration.ipWhitelist.length > 0) {
      annotations['nginx.ingress.kubernetes.io/whitelist-source-range'] = configuration.ipWhitelist.join(', ');
    }
    return {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: `ingress-${configuration.deployUUID}`,
        annotations,
        labels: {
          lc_uuid: configuration.deployUUID,
        },
      },
      spec: {
        rules: this.generateRulesForManifest(configuration),
        ingressClassName: ingressClassName || 'nginx',
      },
    };
  };

  /**
   * Generates the rules for an ingress configuration
   * @param configuration the ingress configuration to generate rules for
   */
  private generateRulesForManifest = (configuration: IngressConfiguration) => {
    return _.flatten(
      Object.entries(configuration.pathPortMapping).map((entry) => {
        return [
          {
            host: `${configuration.host}`,
            http: {
              paths: [
                {
                  path: entry[0],
                  pathType: 'ImplementationSpecific',
                  backend: {
                    service: {
                      name: configuration.serviceHost,
                      port: {
                        number: entry[1],
                      },
                    },
                  },
                },
              ],
            },
          },
        ];
      })
    );
  };

  /**
   * Applies a manifest to the k8 cluster
   * @param manifest the manifest to apply
   * @param ingressName a name for the manifest for tmp directory namespacing
   */
  private applyManifests = async (manifest, ingressName, namespace: string) => {
    try {
      const localPath = `${MANIFEST_PATH}/global-ingress/${ingressName}-ingress.yaml`;
      await fs.promises.mkdir(`${MANIFEST_PATH}/global-ingress/`, {
        recursive: true,
      });
      await fs.promises.writeFile(localPath, manifest, 'utf8');
      await shellPromise(`kubectl apply -f ${localPath} --namespace ${namespace}`);
    } catch (error) {
      logger.warn(error);
    }
  };
}
