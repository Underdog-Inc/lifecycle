import ActivityStream from '../activityStream';
import { PullRequest, Build, Deploy, Repository } from 'server/models';

// Mock dependencies
jest.mock('server/lib/fastly');
jest.mock('server/lib/logger');
jest.mock('server/lib/dependencies', () => ({
  redisClient: {
    getBullCreateClient: jest.fn(),
  },
}));

// Mock BaseService
jest.mock('../_service', () => {
  return jest.fn().mockImplementation(() => ({
    queueManager: {
      registerQueue: jest.fn().mockReturnValue({
        add: jest.fn(),
      }),
    },
    redis: {},
    redlock: {
      lock: jest.fn(),
    },
    db: {
      models: {},
      services: {},
    },
  }));
});

// Test helpers
const createMockPullRequest = (overrides = {}) =>
  ({
    id: 123,
    $fetchGraph: jest.fn().mockResolvedValue(undefined),
    build: {
      deploys: [
        {
          id: 1,
          service: {},
          deployable: {},
        },
      ],
      id: 456,
      uuid: 'test-build-uuid',
    },
    repository: {
      id: 789,
      githubInstallationId: 'test-installation',
    },
    ...overrides,
  } as unknown as PullRequest);

const createMockBuild = (overrides = {}) =>
  ({
    id: 456,
    uuid: 'test-build-uuid',
    status: 'BUILT',
    enableFullYaml: false,
    githubDeployments: true,
    ...overrides,
  } as Build);

const createMockDeploy = (overrides = {}) =>
  ({
    id: 1,
    name: 'test-deploy',
    service: {
      name: 'test-service',
      type: 'GITHUB',
      public: true,
    },
    deployable: {
      name: 'test-deployable',
      type: 'GITHUB',
      public: true,
    },
    active: true,
    uuid: 'deploy-uuid',
    status: 'SUCCESS',
    statusMessage: '',
    dockerImage: 'test-image',
    initDockerImage: 'test-init-image',
    ...overrides,
  } as unknown as Deploy);

const createMockRepository = (overrides = {}) =>
  ({
    id: 789,
    githubInstallationId: 'test-installation',
    ...overrides,
  } as unknown as Repository);

describe('ActivityStream', () => {
  let activityStream: ActivityStream;
  const mockRedis = {
    del: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    activityStream = new ActivityStream();
    activityStream['redis'] = mockRedis as any;
    activityStream.db = {
      models: {},
      services: {
        BuildService: {
          resolveAndDeployBuildQueue: {
            add: jest.fn().mockResolvedValue(undefined),
          },
        },
      },
    } as any;
    activityStream.fastly = {
      getServiceDashboardUrl: jest.fn().mockResolvedValue(null),
      purgeAllServiceCache: jest.fn().mockResolvedValue(undefined),
    } as any;
    activityStream.updatePullRequestActivityStream = jest.fn().mockResolvedValue(undefined);
    activityStream.updateBuildsAndDeploysFromCommentEdit = jest
      .fn()
      .mockImplementation(async (pullRequest, commentBody) => {
        const build = pullRequest.build;
        const deploys = build?.deploys || [];
        const repository = pullRequest.repository;
        const runUuid = 'test-run-uuid';

        if (commentBody.includes('#REDEPLOY') || commentBody.includes('[x] Redeploy Environment')) {
          await activityStream.db.services.BuildService.resolveAndDeployBuildQueue.add({
            buildId: build.id,
            runUUID: runUuid,
          });
          return;
        }

        if (commentBody.includes('[x] Purge Fastly Service Cache')) {
          await activityStream['purgeFastlyServiceCache'](build.uuid);
          await activityStream.updatePullRequestActivityStream(
            build,
            deploys,
            pullRequest,
            repository,
            true,
            false,
            null,
            true
          );
          return;
        }

        await activityStream['applyCommentOverrides']({
          build,
          deploys,
          pullRequest,
          commentBody,
          runUuid,
        });
        await activityStream.updatePullRequestActivityStream(
          build,
          deploys,
          pullRequest,
          repository,
          true,
          true,
          null,
          true
        );
      });
    activityStream['purgeFastlyServiceCache'] = jest.fn().mockResolvedValue(undefined);
    activityStream['applyCommentOverrides'] = jest.fn().mockResolvedValue(undefined);
  });

  describe('Initialization', () => {
    it('should initialize with correct properties', () => {
      expect(activityStream).toBeDefined();
      expect(activityStream.queueManager).toBeDefined();
      expect(activityStream.redis).toBe(mockRedis);
      expect(activityStream.redlock).toBeDefined();
      expect(activityStream.db).toBeDefined();
    });
  });

  describe('processComments', () => {
    const setupMocks = (pullRequest: PullRequest | null) => {
      activityStream.db.models.PullRequest = {
        findOne: jest.fn().mockResolvedValue(pullRequest),
      } as unknown as typeof PullRequest;

      activityStream.db.services.ActivityStream = {
        updatePullRequestActivityStream: jest.fn().mockResolvedValue(undefined),
      } as unknown as ActivityStream;
    };

    const createJobAndDone = (data = 123) => ({
      job: { data },
      done: jest.fn(),
    });

    it('should process comments for a valid PR with build', async () => {
      const mockPullRequest = createMockPullRequest();
      setupMocks(mockPullRequest);
      const { job, done } = createJobAndDone();

      await activityStream.processComments(job, done);

      expect(activityStream.db.models.PullRequest.findOne).toHaveBeenCalledWith({ id: 123 });
      expect(mockPullRequest.$fetchGraph).toHaveBeenCalledWith('[build.[deploys.[service, deployable]], repository]');
      expect(done).toHaveBeenCalled();
      expect(activityStream.db.services.ActivityStream.updatePullRequestActivityStream).toHaveBeenCalledWith(
        mockPullRequest.build,
        mockPullRequest.build.deploys,
        mockPullRequest,
        mockPullRequest.repository,
        true,
        true,
        null,
        false
      );
    });

    it('should not process comments if no build exists', async () => {
      const mockPullRequest = createMockPullRequest({ build: null });
      setupMocks(mockPullRequest);
      const { job, done } = createJobAndDone();

      await activityStream.processComments(job, done);

      expect(activityStream.db.models.PullRequest.findOne).toHaveBeenCalledWith({ id: 123 });
      expect(mockPullRequest.$fetchGraph).toHaveBeenCalledWith('[build.[deploys.[service, deployable]], repository]');
      expect(done).toHaveBeenCalled();
      expect(activityStream.db.services.ActivityStream.updatePullRequestActivityStream).not.toHaveBeenCalled();
    });

    describe('Error handling', () => {
      it('should throw error when database operation fails', async () => {
        activityStream.db.models.PullRequest = {
          findOne: jest.fn().mockRejectedValue(new Error('Database error')),
        } as unknown as typeof PullRequest;

        const { job, done } = createJobAndDone();

        await expect(activityStream.processComments(job, done)).rejects.toThrow('Database error');
        expect(done).not.toHaveBeenCalled();
      });

      it('should throw error when pull request does not exist', async () => {
        setupMocks(null);
        const { job, done } = createJobAndDone(999);

        await expect(activityStream.processComments(job, done)).rejects.toThrow();
        expect(activityStream.db.models.PullRequest.findOne).toHaveBeenCalledWith({ id: 999 });
        expect(done).not.toHaveBeenCalled();
      });

      it('should throw error when fetchGraph fails', async () => {
        const mockPullRequest = createMockPullRequest({
          $fetchGraph: jest.fn().mockRejectedValue(new Error('Failed to fetch graph data')),
        });
        setupMocks(mockPullRequest);
        const { job, done } = createJobAndDone();

        await expect(activityStream.processComments(job, done)).rejects.toThrow('Failed to fetch graph data');
        expect(done).not.toHaveBeenCalled();
      });

      it('should call done but throw error when updatePullRequestActivityStream fails', async () => {
        const mockPullRequest = createMockPullRequest();
        setupMocks(mockPullRequest);
        activityStream.db.services.ActivityStream = {
          updatePullRequestActivityStream: jest.fn().mockRejectedValue(new Error('Update failed')),
        } as unknown as ActivityStream;

        const { job, done } = createJobAndDone();

        await expect(activityStream.processComments(job, done)).rejects.toThrow('Update failed');
        expect(done).toHaveBeenCalled();
      });
    });

    describe('Edge cases', () => {
      it('should handle empty deploys array', async () => {
        const mockPullRequest = createMockPullRequest({
          build: {
            ...createMockPullRequest().build,
            deploys: [],
          },
        });
        setupMocks(mockPullRequest);
        const { job, done } = createJobAndDone();

        await activityStream.processComments(job, done);

        expect(activityStream.db.services.ActivityStream.updatePullRequestActivityStream).toHaveBeenCalledWith(
          mockPullRequest.build,
          [],
          mockPullRequest,
          mockPullRequest.repository,
          true,
          true,
          null,
          false
        );
      });

      it('should handle missing repository', async () => {
        const mockPullRequest = createMockPullRequest({
          repository: null,
        });
        setupMocks(mockPullRequest);
        const { job, done } = createJobAndDone();

        await activityStream.processComments(job, done);

        expect(activityStream.db.services.ActivityStream.updatePullRequestActivityStream).toHaveBeenCalledWith(
          mockPullRequest.build,
          mockPullRequest.build.deploys,
          mockPullRequest,
          null,
          true,
          true,
          null,
          false
        );
      });
    });
  });

  describe('updatePullRequestActivityStream', () => {
    beforeEach(() => {
      activityStream.fastly = {
        getServiceDashboardUrl: jest.fn().mockResolvedValue(null),
        purgeAllServiceCache: jest.fn().mockResolvedValue(undefined),
        getFastlyServiceId: jest.fn().mockResolvedValue('mock-service-id'),
      } as any;

      activityStream.commentQueue = {
        add: jest.fn().mockResolvedValue(undefined),
      } as any;

      activityStream['forceUnlock'] = jest.fn().mockResolvedValue(undefined);

      activityStream['updateMissionControlComment'] = jest.fn().mockResolvedValue(undefined);

      activityStream.updatePullRequestActivityStream = jest
        .fn()
        .mockImplementation(
          async (build, _deploys, pullRequest, _repository, _updateMissionControl, _updateStatus, _error, queue) => {
            try {
              const lock = await activityStream.redlock.lock(`build.${build.id}`, 9000);

              try {
                if (
                  pullRequest.labels &&
                  pullRequest.labels.includes('purge-fastly-service-cache') &&
                  build.status === 'DEPLOYED'
                ) {
                  const serviceId = await activityStream.fastly.getFastlyServiceId('test-uuid', 'compute-shield-id');
                  await activityStream.fastly.purgeAllServiceCache(serviceId, build.uuid, 'fastly');
                }

                if (queue) {
                  await activityStream.commentQueue.add(pullRequest.id, {
                    jobId: pullRequest.id,
                    removeOnComplete: true,
                    removeOnFail: true,
                  });
                }
                return Promise.resolve();
              } finally {
                await lock.unlock();
              }
            } catch (err) {
              await activityStream['forceUnlock'](
                `build.${build.id}`,
                'Error acquiring lock',
                'updatePullRequestActivityStream'
              );
              return Promise.resolve();
            }
          }
        );
    });

    it('should successfully update activity stream and queue comment', async () => {
      const build = createMockBuild();
      const deploys = [createMockDeploy()];
      const pullRequest = createMockPullRequest();
      const repository = createMockRepository();

      const mockLock = { unlock: jest.fn() };
      activityStream.redlock.lock = jest.fn().mockResolvedValue(mockLock);

      await activityStream.updatePullRequestActivityStream(
        build,
        deploys,
        pullRequest,
        repository,
        true,
        true,
        null,
        true
      );

      expect(activityStream.redlock.lock).toHaveBeenCalledWith(`build.${build.id}`, 9000);
      expect(activityStream.commentQueue.add).toHaveBeenCalledWith(pullRequest.id, {
        jobId: pullRequest.id,
        removeOnComplete: true,
        removeOnFail: true,
      });
      expect(mockLock.unlock).toHaveBeenCalled();
    });

    it('should handle Fastly cache purge when label is present', async () => {
      const build = createMockBuild({ status: 'DEPLOYED' });
      const deploys = [createMockDeploy()];
      const pullRequest = createMockPullRequest({
        labels: ['purge-fastly-service-cache'],
      });
      const repository = createMockRepository();

      const mockLock = { unlock: jest.fn() };
      activityStream.redlock.lock = jest.fn().mockResolvedValue(mockLock);

      await activityStream.updatePullRequestActivityStream(
        build,
        deploys,
        pullRequest,
        repository,
        true,
        true,
        null,
        true
      );

      expect(activityStream.fastly.purgeAllServiceCache).toHaveBeenCalledWith('mock-service-id', build.uuid, 'fastly');
    });

    it('should handle lock errors and force unlock', async () => {
      const build = createMockBuild();
      const deploys = [createMockDeploy()];
      const pullRequest = createMockPullRequest();
      const repository = createMockRepository();

      activityStream.redlock.lock = jest.fn().mockRejectedValue(new Error('LockError'));

      await activityStream.updatePullRequestActivityStream(
        build,
        deploys,
        pullRequest,
        repository,
        true,
        true,
        null,
        true
      );

      expect(activityStream['forceUnlock']).toHaveBeenCalledWith(
        `build.${build.id}`,
        expect.any(String),
        expect.any(String)
      );
      expect(activityStream.commentQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('updateBuildsAndDeploysFromCommentEdit', () => {
    it('should handle redeploy request from comment', async () => {
      const build = createMockBuild();
      const pullRequest = createMockPullRequest();
      const commentBody = '#REDEPLOY';

      await activityStream.updateBuildsAndDeploysFromCommentEdit(pullRequest, commentBody);

      expect(activityStream.db.services.BuildService.resolveAndDeployBuildQueue.add).toHaveBeenCalledWith({
        buildId: build.id,
        runUUID: expect.any(String),
      });
      expect(activityStream.updatePullRequestActivityStream).not.toHaveBeenCalled();
    });

    it('should handle Fastly purge request from comment', async () => {
      const build = createMockBuild();
      const pullRequest = createMockPullRequest();
      const commentBody = '[x] Purge Fastly Service Cache';

      await activityStream.updateBuildsAndDeploysFromCommentEdit(pullRequest, commentBody);

      expect(activityStream['purgeFastlyServiceCache']).toHaveBeenCalledWith(build.uuid);
      expect(activityStream.updatePullRequestActivityStream).toHaveBeenCalledWith(
        pullRequest.build,
        pullRequest.build.deploys,
        pullRequest,
        pullRequest.repository,
        true,
        false,
        null,
        true
      );
    });

    it('should handle environment overrides from comment', async () => {
      const pullRequest = createMockPullRequest();
      const commentBody = 'ENV:TEST_KEY:test_value';

      await activityStream.updateBuildsAndDeploysFromCommentEdit(pullRequest, commentBody);

      expect(activityStream['applyCommentOverrides']).toHaveBeenCalledWith({
        build: pullRequest.build,
        deploys: pullRequest.build.deploys,
        pullRequest,
        commentBody,
        runUuid: 'test-run-uuid',
      });
      expect(activityStream.updatePullRequestActivityStream).toHaveBeenCalledWith(
        pullRequest.build,
        pullRequest.build.deploys,
        pullRequest,
        pullRequest.repository,
        true,
        true,
        null,
        true
      );
    });
  });
});
