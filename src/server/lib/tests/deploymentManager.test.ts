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

import { DeploymentManager } from '../deploymentManager/deploymentManager';
import { Deploy } from 'server/models';
// import { deployHelm } from '../helm';

jest.mock('../helm', () => ({
  deployHelm: jest.fn().mockResolvedValue(void 0),
}));

// todo: add more tests for the below scenarios
// let deploysWithoutDependencies: Deploy[];
// let deploysWithDependencies: Deploy[];
// let deploysWithSelfDependency: Deploy[];
// let deploysWithInvalidDependencies: Deploy[];

describe('DeploymentManager', () => {
  let deploys: Deploy[];
  let deploymentManager: DeploymentManager;

  beforeEach(() => {
    deploys = [
      { deployable: { name: 'serviceA', deploymentDependsOn: [] } },
      { deployable: { name: 'serviceB', deploymentDependsOn: ['serviceA'] } },
    ] as Deploy[];

    deploymentManager = new DeploymentManager(deploys);
  });

  describe('constructor', () => {
    it('should initialize deploys and calculate deployment order', () => {
      expect(deploymentManager['deploys'].size).toBe(2);
      expect(deploymentManager['deploymentLevels'].size).toBeGreaterThan(0);
    });
  });

  describe('calculateDeploymentOrder', () => {
    it('should correctly calculate deployment levels', () => {
      const levels = deploymentManager['deploymentLevels'];
      expect(levels.get(0)).toMatchObject([{ deployable: { name: 'serviceA' } }]);
      expect(levels.get(1)).toMatchObject([{ deployable: { name: 'serviceB' } }]);
    });
  });

  // todo: add db mock for this test
  // describe('deploy', () => {
  //   it('should call deployHelm for each deployment level', async () => {
  //     await deploymentManager.deploy();

  //     expect(deployHelm).toHaveBeenCalledTimes(2);
  //   });
  // });
});
