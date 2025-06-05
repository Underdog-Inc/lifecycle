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

import { constructEcrTag } from 'server/lib/codefresh/utils';
import { ContainerBuildOptions } from 'server/lib/codefresh/types';
import rootLogger from '../logger';
import * as yaml from 'js-yaml';
import Deploy from 'server/models/Deploy';
import {
  createCloneScript,
  createJob,
  buildImage as genericBuildImage,
  getGitHubToken,
  GIT_USERNAME,
  JobResult,
} from './utils';

const logger = rootLogger.child({
  filename: 'lib/kaniko/kaniko.ts',
});

// Interface for Kaniko options
export interface KanikoBuildOptions extends ContainerBuildOptions {
  namespace?: string;
}

// Utility Functions
export function createPersistentVolumeClaim(name: string): any {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name,
      namespace: 'lifecycle-app',
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: {
        requests: {
          storage: '5Gi',
        },
      },
    },
  };
}

export function createKanikoContainer(
  repoName: string,
  dockerfilePath: string,
  destination: string,
  buildArgs: string[],
  namespace: string,
  containerName: string = 'kaniko'
): any {
  const shortRepoName = repoName.split('/')[1] || repoName;
  const cachePath = `${shortRepoName}-cache`;

  return {
    name: containerName,
    image: 'gcr.io/kaniko-project/executor:latest',
    args: [
      // Use a local directory context instead of git clone
      `--context=/workspace/repo-${shortRepoName}`,
      `--dockerfile=${dockerfilePath}`,
      ...buildArgs.map((arg) => `--build-arg=${arg}`),
      `--destination=${destination}`,
      '--cache=true',
      `--cache-repo=distribution.${namespace}.svc.cluster.local:5000/${cachePath}`,
      `--insecure-registry=distribution.${namespace}.svc.cluster.local:5000`,
      `--skip-tls-verify-registry=distribution.${namespace}.svc.cluster.local:5000`,
      '--cache-copy-layers',
      '--snapshot-mode=redo',
      '--use-new-run',
      '--cleanup',
    ],
    volumeMounts: [
      {
        name: 'kaniko-cache',
        mountPath: '/cache',
      },
      {
        name: 'kaniko-workspace',
        mountPath: '/workspace',
      },
    ],
  };
}

// Main Function to Generate Manifest
export const generateKanikoManifest = async (
  deploy: Deploy,
  jobId: string,
  options: KanikoBuildOptions
): Promise<string> => {
  const { tag, ecrDomain, namespace = 'lifecycle-app', initTag } = options;

  const appShort = deploy.deployable.appShort;
  const ecrRepo = deploy.deployable.ecr;
  const envVars = deploy.env;
  const repo = deploy.repository.fullName;
  const revision = deploy.sha;
  const dockerfilePath = deploy.deployable.dockerfilePath;
  const initDockerfilePath = deploy.deployable.initDockerfilePath;
  const branch = deploy.branchName;

  const gitToken = await getGitHubToken();

  const repoName = repo.split('/')[1] || repo;

  const ecrRepoTag = constructEcrTag({ repo: ecrRepo, tag, ecrDomain });

  const buildArgList = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);

  const cachePvc = createPersistentVolumeClaim('kaniko-cache');

  const cloneScript = createCloneScript(repo, branch, revision, repoName);

  const containers = [];

  const mainKanikoContainer = createKanikoContainer(
    repo,
    dockerfilePath,
    ecrRepoTag,
    buildArgList,
    namespace,
    'kaniko-main'
  );

  containers.push(mainKanikoContainer);

  if (initDockerfilePath && initTag) {
    const initEcrRepoTag = constructEcrTag({ repo: ecrRepo, tag: initTag, ecrDomain });

    const initKanikoContainer = createKanikoContainer(
      repo,
      initDockerfilePath,
      initEcrRepoTag,
      buildArgList,
      namespace,
      'kaniko-init'
    );

    containers.push(initKanikoContainer);
  }

  const shortSha = revision.substring(0, 7);
  let jobName = `${deploy.uuid}-kaniko-${jobId}-${shortSha}`.substring(0, 63);
  if (jobName.endsWith('-')) {
    jobName = jobName.slice(0, -1);
  }

  const volumeConfig = {
    workspaceName: 'kaniko-workspace',
    volumes: [
      {
        name: 'kaniko-cache',
        persistentVolumeClaim: {
          claimName: 'kaniko-cache',
        },
      },
      {
        name: 'kaniko-workspace',
        emptyDir: {},
      },
    ],
  };

  const job = createJob(jobName, namespace, GIT_USERNAME, gitToken, cloneScript, containers, volumeConfig);

  const manifestResources = [cachePvc, job];

  const manifestYaml = manifestResources.map((resource) => yaml.dump(resource)).join('\n---\n');

  logger.info('Generated Kaniko manifest for', { appShort, tag });
  return manifestYaml;
};

/**
 * Helper function to build images with Kaniko
 */
export const kanikoImageBuild = async (deploy: Deploy, options: KanikoBuildOptions): Promise<JobResult> => {
  return genericBuildImage(deploy, options, generateKanikoManifest, 'Kaniko');
};
