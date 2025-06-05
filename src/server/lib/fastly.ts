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

import * as FastlyInstance from 'fastly/dist/index.js';
import rootLogger from 'server/lib/logger';
import { Redis } from 'ioredis';
import { FASTLY_TOKEN } from 'shared/config';
import GlobalConfigService from 'server/services/globalConfig';

FastlyInstance.ApiClient.instance.authenticate(FASTLY_TOKEN);
const fastlyService = new FastlyInstance.ServiceApi();
const fastlyPurge = new FastlyInstance.PurgeApi();

const logger = rootLogger.child({
  filename: 'lib/fastly.ts',
});

class Fastly {
  redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getFastlyUrl(): Promise<string> {
    const { domainDefaults } = await GlobalConfigService.getInstance().getAllConfigs();
    return `fastly.${domainDefaults.http}`;
  }

  async getCacheKey(uuid: string, fastlyServiceType = ''): Promise<string> {
    let key: string = null;
    if (!uuid) return key;
    const name = fastlyServiceType ?? 'fastly';
    // ensure it has a proper initial uuuid
    const FASTLY_URL = await this.getFastlyUrl();
    const escapedDomain = this.escapeDomain(FASTLY_URL);
    // eslint-disable-next-line no-useless-escape
    const serviceNameRegex = `${name}-[a-z]*-[a-z]*-[-9]*${escapedDomain}`;
    const uuidRegex = '[a-z]*-[a-z]*-[0-9]*';

    if (uuid.match(serviceNameRegex) != null) {
      key = `${uuid}-id`;
    } else if (uuid.match(uuidRegex) != null) {
      key = `${name}-${uuid}.${FASTLY_URL}-id`;
    }

    return key;
  }

  /**
   * Refresh the fastly service metadata redis cache by retrieving them from Fastly
   * @param uuid If uuid is defined, cache value will be returned after refreshing the whole cache.
   */
  async refresh(uuid: string, fastlyServiceType: string): Promise<string> {
    const serviceName = `${fastlyServiceType}-${uuid}`;
    const FASTLY_URL = await this.getFastlyUrl();
    const name = `${serviceName}.${FASTLY_URL}`;
    const text = `[BUILD ${uuid}][fastly][refresh][serviceName ${name}]`;
    try {
      if (!name) throw new Error('Service name is missing');
      const service = await fastlyService.searchService({ name });
      if (!service) {
        throw new Error('No data returned from Fastly service search');
      }
      const cacheKey = await this.getCacheKey(uuid, fastlyServiceType);
      if (!cacheKey) {
        return;
      }
      const id = service?.id;
      this.redis.set(cacheKey, id);
      this.redis.expire(cacheKey, 86400);
      return id;
    } catch (error) {
      logger.child({ error }).warn(`${text} There is an issue to retrieve Fastly service id from Fastly`);
    }
  }

  async getFastlyServiceId(uuid: string, fastlyServiceType: string): Promise<string> {
    let result: string = null;
    const key = await this.getCacheKey(uuid, fastlyServiceType);
    result = await this.redis.get(key);
    if (result == null) result = await this.refresh(uuid, fastlyServiceType);
    return result;
  }

  async getServiceDashboardUrl(uuid: string, fastlyServiceType: string): Promise<URL> {
    let serviceDashboardUrl: URL = null;
    const serviceId = await this.getFastlyServiceId(uuid, fastlyServiceType);
    if (serviceId) serviceDashboardUrl = new URL(`https://manage.fastly.com/configure/services/${serviceId}`);
    return serviceDashboardUrl;
  }

  /**
   * Purge all the cache for the Fastly service for the corresponding LC environment.
   * @param serviceId Fastly Service ID
   */
  async purgeAllServiceCache(serviceId: string, uuid: string, fastlyServiceType: string) {
    const text = `[BUILD ${uuid}][fastly][purgeAllServiceCache]`;
    try {
      if (!serviceId) throw new Error('Service ID is missing');
      await fastlyPurge.purgeAll({ service_id: serviceId });
    } catch (error) {
      logger
        .child({ error })
        .info(
          `${text}[serviceid ${serviceId}] has an error with the ${fastlyServiceType} service with ${serviceId} service id`
        );
    }
  }

  private escapeDomain(input: string): string {
    return '\\.' + input.replace(/\./g, '\\.');
  }
}

export default Fastly;
