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

import { Deploy } from 'server/models';
import { deployHelm } from '../helm';
import rootLogger from '../logger';
import { DeployStatus } from 'shared/constants';

const logger = rootLogger.child({
  filename: 'lib/DeploymentManager/deployable.ts',
});

export class DeploymentManager {
  private deploys: Map<string, Deploy> = new Map();
  private deploymentLevels: Map<number, Deploy[]> = new Map();

  constructor(deploys: Deploy[]) {
    deploys.forEach((deploy) => {
      this.deploys.set(deploy.deployable.name, deploy);
    });

    this.calculateDeploymentOrder();
  }

  private calculateDeploymentOrder(): void {
    this.removeInvalidDependencies();
    let level = 0;

    this.deploys.forEach((deploy, deployableName) => {
      const selfDependencyIndex = deploy.deployable.deploymentDependsOn.indexOf(deployableName);
      if (selfDependencyIndex > -1) {
        logger.warn(`Service ${deploy.uuid} is dependent on itself`);
        deploy.deployable.deploymentDependsOn.splice(selfDependencyIndex, 1);
      }
    });
    let deploysWithoutDependencies = Array.from(this.deploys.values()).filter(
      (d) => d.deployable.deploymentDependsOn.length === 0
    );

    while (deploysWithoutDependencies.length > 0) {
      this.deploymentLevels.set(
        level,
        deploysWithoutDependencies.map((d) => d)
      );
      const nextToDeploy: Deploy[] = [];

      deploysWithoutDependencies.forEach((deploy) => {
        Array.from(this.deploys.values()).forEach((d) => {
          if (d.deployable.deploymentDependsOn.includes(deploy.deployable.name)) {
            const index = d.deployable.deploymentDependsOn.indexOf(deploy.deployable.name);
            d.deployable.deploymentDependsOn.splice(index, 1);
            if (d.deployable.deploymentDependsOn.length === 0) {
              nextToDeploy.push(d);
            }
          }
        });
      });

      deploysWithoutDependencies = nextToDeploy;
      level++;
    }
  }

  private removeInvalidDependencies(): void {
    const validDeployNames = new Set(this.deploys.keys());

    this.deploys.forEach((deploy) => {
      deploy.deployable.deploymentDependsOn = deploy.deployable.deploymentDependsOn.filter((dependencyName) => {
        logger.warn(`Service ${deploy.uuid} has an invalid dependency: ${dependencyName}`);
        return validDeployNames.has(dependencyName);
      });
    });
  }

  public async deploy(): Promise<void> {
    for (const value of this.deploys.values()) {
      await value.$query().patch({ status: DeployStatus.QUEUED });
    }
    for (let level = 0; level < this.deploymentLevels.size; level++) {
      const deployablesAtLevel = this.deploymentLevels.get(level);
      if (deployablesAtLevel) {
        await deployHelm(deployablesAtLevel);
      }
    }
  }
}
