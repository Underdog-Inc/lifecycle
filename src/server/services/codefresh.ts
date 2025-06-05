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

import BaseService from './_service';
import * as YamlService from 'server/models/yaml';
import { triggerPipeline } from 'server/lib/codefresh';
import rootLogger from 'server/lib/logger';

const logger = rootLogger.child({
  filename: 'services/codefresh.ts',
});

export default class CodefreshService extends BaseService {
  async triggerYamlConfigWebhookPipeline(webhook: YamlService.Webhook, data: Record<string, any>): Promise<string> {
    let buildId: string;
    if (
      webhook.state !== undefined &&
      webhook.type !== undefined &&
      webhook.pipelineId !== undefined &&
      webhook.trigger !== undefined
    ) {
      buildId = await triggerPipeline(webhook.pipelineId, webhook.trigger, data);
    } else {
      logger
        .child({ webhook })
        .error(
          `[WEBHOOK ${webhook.name ?? ''} ${webhook.pipelineId}/${webhook.trigger}] Invalid webhook configuration.`
        );
    }
    return buildId;
  }
}
