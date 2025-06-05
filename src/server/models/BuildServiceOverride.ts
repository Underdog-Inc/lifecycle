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

import Model from './_Model';
import { Build, Service } from '.';
import { Pojo } from 'objection';

export default class BuildServiceOverride extends Model {
  branchName: string;
  tagName: string;
  env: string;
  build?: Build;
  service?: Service;
  serviceId: number;
  buildId: number;
  active: boolean;

  static tableName = 'build_service_overrides';
  static timestamps = true;

  static relationMappings = {
    build: {
      relation: Model.BelongsToOneRelation,
      modelClass: () => Build,
      join: {
        from: 'build_service_overrides.buildId',
        to: 'builds.id',
      },
    },
    service: {
      relation: Model.BelongsToOneRelation,
      modelClass: () => Service,
      join: {
        from: 'build_service_overrides.serviceId',
        to: 'services.id',
      },
    },
  };

  $formatDatabaseJson(json: Pojo) {
    json = super.$formatDatabaseJson(json);

    return {
      ...json,
      env: JSON.stringify(json.env || {}),
    };
  }
}
