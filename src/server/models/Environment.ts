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
import { Repository, Service } from '.';

export default class Environment extends Model {
  name!: string;

  services?: [Service];
  enableFullYaml: boolean;
  classicModeOnly: boolean;

  autoDeploy?: boolean;
  defaultServices?: [Service];
  optionalServices?: [Service];

  repositories?: [Repository];

  static tableName = 'environments';
  static timestamps = true;

  static jsonSchema = {
    type: 'object',
    properties: {
      name: {
        type: 'string',
      },
    },
  };

  static relationMappings = {
    // Services is deprecated. It was replaced by defaultServices and optionalServices.
    services: {
      relation: Model.HasManyRelation,
      modelClass: () => Service,
      join: {
        from: 'services.environmentId',
        to: 'environments.id',
      },
    },
    defaultServices: {
      relation: Model.ManyToManyRelation,
      modelClass: () => Service,
      join: {
        from: 'environments.id',
        through: {
          from: 'environmentDefaultServices.environmentId',
          to: 'environmentDefaultServices.serviceId',
        },
        to: 'services.id',
      },
    },
    optionalServices: {
      relation: Model.ManyToManyRelation,
      modelClass: () => Service,
      join: {
        from: 'environments.id',
        through: {
          from: 'environmentOptionalServices.environmentId',
          to: 'environmentOptionalServices.serviceId',
        },
        to: 'services.id',
      },
    },
    repositories: {
      relation: Model.HasManyRelation,
      modelClass: () => Repository,
      join: {
        from: 'environments.id',
        to: 'repositories.defaultEnvId',
      },
    },
  };
}
