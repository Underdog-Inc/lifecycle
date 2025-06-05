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

import RepositoryService from 'server/services/repository';
import { GITHUB_REPOSITORY_DATA as repoData } from 'server/services/__fixtures__/github';

describe('RepositoryService', () => {
  let service, db, redis, redlock;

  beforeEach(() => {
    db = {
      models: {
        Repository: {
          findOne: jest.fn(),
          create: jest.fn(),
        },
      },
    };
    redis = {};
    redlock = {};
    service = new RepositoryService(db, redis, redlock);
  });

  describe('findRepository', () => {
    test('returns existing repository', async () => {
      db.models.Repository.findOne.mockReturnValue({ id: 1 });
      const result = await service.findRepository(1, 2, 3);
      expect(result).toEqual({ id: 1 });
      expect(db.models.Repository.findOne).toHaveBeenCalledWith({
        githubRepositoryId: 2,
        githubInstallationId: 3,
        ownerId: 1,
      });
      expect(db.models.Repository.create).not.toHaveBeenCalled();
    });

    test('creates new repository if none exists', async () => {
      db.models.Repository.findOne.mockReturnValue(null);
      db.models.Repository.create.mockReturnValue({ id: 1 });
      const result = await service.findOrCreateRepository(
        repoData.ownerId,
        repoData.githubRepositoryId,
        repoData.githubInstallationId,
        repoData.fullName,
        repoData.htmlUrl,
        repoData.defaultEnvId
      );
      expect(result).toEqual({ id: 1 });
      expect(db.models.Repository.findOne).toHaveBeenCalledWith({
        githubRepositoryId: repoData.githubRepositoryId,
        githubInstallationId: repoData.githubInstallationId,
        ownerId: repoData.ownerId,
      });
      expect(db.models.Repository.create).toHaveBeenCalledWith({
        githubRepositoryId: repoData.githubRepositoryId,
        githubInstallationId: repoData.githubInstallationId,
        ownerId: repoData.ownerId,
        fullName: repoData.fullName,
        htmlUrl: repoData.htmlUrl,
        defaultEnvId: repoData.defaultEnvId,
      });
    });
  });
});
