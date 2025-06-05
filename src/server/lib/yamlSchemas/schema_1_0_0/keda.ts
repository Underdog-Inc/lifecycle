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

export const kedaScaleToZero = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string' },
    replicas: {
      type: 'object',
      additionalProperties: false,
      properties: {
        min: { type: 'number' },
        max: { type: 'number' },
      },
    },
    scaledownPeriod: { type: 'number' },
    maxRetries: { type: 'number' },
    scalingMetric: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requestRate: {
          type: 'object',
          additionalProperties: false,
          properties: {
            granularity: { type: 'string' },
            targetValue: { type: 'number' },
            window: { type: 'string' },
          },
        },
        concurrency: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targetValue: { type: 'number' },
          },
        },
      },
    },
  },
};
