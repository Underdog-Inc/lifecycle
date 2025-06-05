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

import { IServices } from 'server/services/types';
import rootLogger from '../lib/logger';
import { defaultDb } from 'server/lib/dependencies';
import RedisClient from 'server/lib/redisClient';
import QueueManager from 'server/lib/queueManager';

let isBootstrapped = false;

const logger = rootLogger.child({
  filename: 'jobs/index.ts',
});

export default function bootstrapJobs(services: IServices) {
  if (defaultDb.services) {
    return;
  }

  logger.info(`Bootstrapping jobs...... Yes`);
  services.GithubService.webhookQueue.process(125, services.GithubService.processWebhooks);
  services.ActivityStream.commentQueue.process(2, services.ActivityStream.processComments);
  /* Run once per hour */
  services.PullRequest.cleanupClosedPRQueue.add(
    {},
    {
      repeat: {
        every: 60000 * 60, // Once an hour
      },
    }
  );
  services.PullRequest.cleanupClosedPRQueue.process(services.PullRequest.processCleanupClosedPRs);
  services.GlobalConfig.setupCacheRefreshJob();
  services.PullRequest.cleanupClosedPRQueue.add({}, {});

  services.Ingress.ingressManifestQueue.process(1, services.Ingress.createOrUpdateIngressForBuild);

  services.Ingress.ingressCleanupQueue.process(1, services.Ingress.ingressCleanupForBuild);

  services.BuildService.deleteQueue.process(20, services.BuildService.processDeleteQueue);

  services.Webhook.webhookQueue.process(10, services.Webhook.processWebhookQueue);

  services.BuildService.resolveAndDeployBuildQueue.process(
    125,
    services.BuildService.processResolveAndDeployBuildQueue
  );
  /**
   * The actual build queue
   */
  services.BuildService.buildQueue.process(125, services.BuildService.processBuildQueue);
  services.GithubService.githubDeploymentQueue.process(125, services.GithubService.processGithubDeployment);

  defaultDb.services = services;

  if (process.env.NEXT_MANUAL_SIG_HANDLE) {
    if (!isBootstrapped) {
      isBootstrapped = true;

      // This function is used to handle graceful shutdowns add things as needed.
      const handleExit = async (signal: string) => {
        logger.info(` ✍️Shutting down (${signal})`);
        try {
          const redisClient = RedisClient.getInstance();
          const queueManager = QueueManager.getInstance();
          await queueManager.emptyAndCloseAllQueues();
          await redisClient.close();
          process.exit(0);
        } catch (error) {
          logger.info(`Unable to shutdown gracefully: ${error}`);
          process.exit(0);
        }
      };

      process.on('SIGINT', () => handleExit('SIGINT'));
      process.on('SIGTERM', () => handleExit('SIGTERM'));
      logger.info(' ✍️Signal handlers registered');
    }
  }
  logger.info('Bootstrapping complete');
}
