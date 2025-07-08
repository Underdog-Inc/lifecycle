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

import yaml from 'js-yaml';
import fs from 'fs';
import { Build } from 'server/models';
import { Webhook } from 'server/models/yaml';
import { createWebhookJob, WebhookJobConfig } from 'server/lib/kubernetes/webhookJobFactory';
import { shellPromise } from 'server/lib/shell';
import { waitForJobAndGetLogs } from 'server/lib/nativeBuild/utils';
import { ensureServiceAccountForJob } from 'server/lib/kubernetes/common/serviceAccount';
import rootLogger from 'server/lib/logger';
import { nanoid } from 'nanoid';

const logger = rootLogger.child({
  filename: 'lib/webhook/index.ts',
});

const MANIFEST_PATH = process.env.MANIFEST_PATH || '/tmp/lifecycle/manifests';

export interface WebhookExecutionResult {
  success: boolean;
  jobName: string;
  logs: string;
  status: string;
  metadata?: Record<string, any>;
}

export async function executeDockerWebhook(
  webhook: Webhook,
  build: Build,
  resolvedEnv: Record<string, string>
): Promise<WebhookExecutionResult> {
  if (!webhook.docker) {
    throw new Error('Docker webhook configuration is missing');
  }

  const namespace = build.namespace;
  const serviceAccountName = await ensureServiceAccountForJob(namespace, 'webhook');

  const jobConfig: WebhookJobConfig = {
    name: webhook.name || 'docker-webhook',
    namespace,
    serviceAccount: serviceAccountName,
    buildUuid: build.uuid,
    buildId: String(build.id),
    buildSha: build.sha,
    webhookName: webhook.name || 'docker-webhook',
    webhookType: 'docker',
    image: webhook.docker.image,
    command: webhook.docker.command,
    args: webhook.docker.args,
    env: resolvedEnv,
    timeout: webhook.docker.timeout,
  };

  return executeWebhookJob(jobConfig, build);
}

export async function executeCommandWebhook(
  webhook: Webhook,
  build: Build,
  resolvedEnv: Record<string, string>
): Promise<WebhookExecutionResult> {
  if (!webhook.command) {
    throw new Error('Command webhook configuration is missing');
  }

  const namespace = build.namespace;
  const serviceAccountName = await ensureServiceAccountForJob(namespace, 'webhook');

  const jobConfig: WebhookJobConfig = {
    name: webhook.name || 'command-webhook',
    namespace,
    serviceAccount: serviceAccountName,
    buildUuid: build.uuid,
    buildId: String(build.id),
    buildSha: build.sha,
    webhookName: webhook.name || 'command-webhook',
    webhookType: 'command',
    image: webhook.command.image,
    script: webhook.command.script,
    env: resolvedEnv,
    timeout: webhook.command.timeout,
  };

  return executeWebhookJob(jobConfig, build);
}

async function executeWebhookJob(jobConfig: WebhookJobConfig, build: Build): Promise<WebhookExecutionResult> {
  const executionId = nanoid();
  logger.info(`[WEBHOOK ${build.uuid}] Starting ${jobConfig.webhookType} webhook: ${jobConfig.webhookName}`, {
    buildUuid: build.uuid,
    webhookName: jobConfig.webhookName,
    webhookType: jobConfig.webhookType,
    executionId,
  });

  try {
    const job = createWebhookJob(jobConfig);
    const manifest = yaml.dump(job);

    const manifestDir = `${MANIFEST_PATH}/webhooks`;
    await fs.promises.mkdir(manifestDir, { recursive: true });
    const manifestPath = `${manifestDir}/${job.metadata.name}-${executionId}.yaml`;
    await fs.promises.writeFile(manifestPath, manifest, 'utf8');
    await shellPromise(`kubectl apply -f ${manifestPath}`);

    const jobResult = await waitForJobAndGetLogs(job.metadata.name, jobConfig.namespace, `[WEBHOOK ${build.uuid}]`);

    logger.info(`[WEBHOOK ${build.uuid}] Webhook execution completed`, {
      buildUuid: build.uuid,
      webhookName: jobConfig.webhookName,
      success: jobResult.success,
      status: jobResult.status,
    });

    return {
      success: jobResult.success,
      jobName: job.metadata.name,
      logs: jobResult.logs,
      status: jobResult.status || (jobResult.success ? 'succeeded' : 'failed'),
      metadata: {},
    };
  } catch (error) {
    logger.error(`[WEBHOOK ${build.uuid}] Webhook execution failed`, {
      buildUuid: build.uuid,
      webhookName: jobConfig.webhookName,
      error: error.message,
    });

    return {
      success: false,
      jobName: '',
      logs: error.message,
      status: 'failed',
      metadata: {
        error: error.message,
      },
    };
  }
}
