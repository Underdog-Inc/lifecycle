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

import mockRedisClient from 'server/lib/__mocks__/redisClientMock';
mockRedisClient();

import { constructHelmDeploysBuildMetaData } from 'server/lib/helm';
import { Deploy } from 'server/models';

jest.mock('server/lib/envVariables', () => ({
  EnvironmentVariables: class {},
}));

describe('Helm tests', () => {
  test('constructHelmDeploysBuildMetaData should return the correct metadata', async () => {
    const deploys = [
      {
        build: {
          uuid: '123',
          pullRequest: {
            branchName: 'feature/branch',
            fullName: 'user/repo',
            latestCommit: 'abc123',
          },
        },
      },
    ] as Partial<Deploy[]>;

    const expectedMetadata = {
      uuid: '123',
      branchName: 'feature/branch',
      fullName: 'user/repo',
      sha: 'abc123',
      error: '',
    };

    const metadata = await constructHelmDeploysBuildMetaData(deploys);
    expect(metadata).toEqual(expectedMetadata);
  });

  test('constructHelmDeploysBuildMetaData should handle missing build or pull request', async () => {
    const deploys = [
      {
        build: null,
        $fetchGraph: jest.fn(),
      },
    ];
    const metadata = await constructHelmDeploysBuildMetaData(deploys);
    expect(metadata).toEqual({ branchName: '', fullName: '', sha: '', uuid: '', error: 'no_related_build_found' });
  });
});
