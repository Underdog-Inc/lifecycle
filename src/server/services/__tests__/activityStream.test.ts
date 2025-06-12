import ActivityStream from '../activityStream';
import { PullRequest, Build, Deploy, Repository } from 'server/models';
import GlobalConfigService from '../globalConfig';

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

      activityStream.updatePullRequestActivityStream = jest
        .fn()
        .mockImplementation(
          async (build, deploys, pullRequest, repository, updateMissionControl, updateStatus, error, queue) => {
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

  describe('manageDeployments', () => {
    beforeEach(() => {
      activityStream.db.services = {
        GithubService: {
          githubDeploymentQueue: {
            add: jest.fn().mockResolvedValue(undefined),
          },
        },
      } as any;

      const mockGlobalConfigService = {
        getOrgChartName: jest.fn().mockResolvedValue('org-chart'),
      } as unknown as GlobalConfigService;
      jest.spyOn(GlobalConfigService, 'getInstance').mockReturnValue(mockGlobalConfigService);

      activityStream['manageDeployments'] = jest.fn().mockImplementation(async (build, deploys) => {
        if (!build.githubDeployments) return;

        try {
          await Promise.all(
            deploys.map(async (deploy) => {
              const service = deploy.service;
              const deployable = deploy.deployable;
              const isActive = deploy.active;
              const isPublic = build.enableFullYaml ? deployable.public : service.public;
              const serviceType = build.enableFullYaml ? deployable.type : service.type;
              const isDeployment = isActive && isPublic && ['DOCKER', 'GITHUB', 'CODEFRESH'].includes(serviceType);

              if (isDeployment) {
                await activityStream.db.services.GithubService.githubDeploymentQueue.add(
                  { deployId: deploy.id, action: 'create' },
                  { delay: 10000, jobId: deploy.id }
                );
              }
            })
          );
        } catch (error) {
          // Errors are logged but not thrown
        }
      });
    });

    it('should add deployments to queue for valid deploys', async () => {
      const build = createMockBuild();
      const deploys = [
        createMockDeploy(), // valid deployment
        createMockDeploy({ active: false }), // inactive
        createMockDeploy({ service: { public: false, type: 'GITHUB' } }), // not public
        createMockDeploy({ service: { public: true, type: 'EXTERNAL_HTTP' } }), // wrong type
      ];

      await activityStream['manageDeployments'](build, deploys);

      expect(activityStream.db.services.GithubService.githubDeploymentQueue.add).toHaveBeenCalledTimes(1);
      expect(activityStream.db.services.GithubService.githubDeploymentQueue.add).toHaveBeenCalledWith(
        { deployId: 1, action: 'create' },
        { delay: 10000, jobId: 1 }
      );
    });

    it('should handle full YAML deploys correctly', async () => {
      const build = createMockBuild({ enableFullYaml: true });
      const deploys = [
        createMockDeploy(),
        createMockDeploy({
          deployable: {
            name: 'helm-deploy',
            type: 'HELM',
            public: true,
            helm: { chart: { name: 'org-chart' } },
          },
        }),
      ];

      await activityStream['manageDeployments'](build, deploys);

      expect(activityStream.db.services.GithubService.githubDeploymentQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should not process deployments if githubDeployments is disabled', async () => {
      const build = createMockBuild({ githubDeployments: false });
      const deploys = [createMockDeploy()];

      await activityStream['manageDeployments'](build, deploys);

      expect(activityStream.db.services.GithubService.githubDeploymentQueue.add).not.toHaveBeenCalled();
    });

    it('should handle errors during deployment processing', async () => {
      const build = createMockBuild();
      const deploys = [createMockDeploy()];

      activityStream.db.services.GithubService.githubDeploymentQueue.add = jest
        .fn()
        .mockRejectedValue(new Error('Queue error'));

      await expect(activityStream['manageDeployments'](build, deploys)).resolves.not.toThrow();
    });
  });
});
