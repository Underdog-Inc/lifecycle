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

import Queue from 'bull';
import type { Queue as BullQueue } from 'bull';
import rootLogger from './logger';

const logger = rootLogger.child({
  filename: 'lib/queueManager.ts',
});

export default class QueueManager {
  private static instance: QueueManager;
  private queues: BullQueue[] = [];

  private constructor() {}

  public static getInstance(): QueueManager {
    if (!this.instance) {
      this.instance = new QueueManager();
    }
    return this.instance;
  }

  public registerQueue(queueName: string, options: Queue.QueueOptions): BullQueue<any> {
    logger.debug(`Registering queue ${queueName}`);
    const queue = new Queue(queueName, options);
    this.queues.push(queue);
    return queue;
  }

  public getQueues(): BullQueue[] {
    return this.queues;
  }

  public async emptyAndCloseAllQueues(): Promise<void> {
    for (const queue of this.queues) {
      logger.debug(`Closing queue: ${queue.name}`);
      try {
        await queue.close();
      } catch (error) {
        logger.warn(`⚠️ Error closing queue ${queue.name}:`, error.message);
      }
    }
    logger.info('✅ All bull queues have been closed successfully.');
  }
}
