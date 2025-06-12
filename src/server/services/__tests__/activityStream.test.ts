import ActivityStream from '../activityStream';
import { PullRequest } from 'server/models';

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

  it('should initialize with correct properties', () => {
    expect(activityStream).toBeDefined();
    expect(activityStream.queueManager).toBeDefined();
    expect(activityStream.redis).toBe(mockRedis);
    expect(activityStream.redlock).toBeDefined();
    expect(activityStream.db).toBeDefined();
  });

  describe('processComments', () => {
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

    it('should not call updatePullRequestActivityStream if no build exists', async () => {
      const mockPullRequest = createMockPullRequest({ build: null });
      setupMocks(mockPullRequest);

      const { job, done } = createJobAndDone();

      await activityStream.processComments(job, done);

      expect(activityStream.db.models.PullRequest.findOne).toHaveBeenCalledWith({ id: 123 });
      expect(mockPullRequest.$fetchGraph).toHaveBeenCalledWith('[build.[deploys.[service, deployable]], repository]');
      expect(done).toHaveBeenCalled();
      expect(activityStream.db.services.ActivityStream.updatePullRequestActivityStream).not.toHaveBeenCalled();
    });

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

      expect(activityStream.db.models.PullRequest.findOne).toHaveBeenCalledWith({ id: 123 });
      expect(mockPullRequest.$fetchGraph).toHaveBeenCalledWith('[build.[deploys.[service, deployable]], repository]');
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
      expect(done).toHaveBeenCalled();
    });

    it('should handle build with multiple deploys', async () => {
      const mockPullRequest = createMockPullRequest({
        build: {
          ...createMockPullRequest().build,
          deploys: [
            { id: 1, service: {}, deployable: {} },
            { id: 2, service: {}, deployable: {} },
            { id: 3, service: {}, deployable: {} },
          ],
        },
      });
      setupMocks(mockPullRequest);

      const { job, done } = createJobAndDone();

      await activityStream.processComments(job, done);

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

    it('should handle build with different deploy statuses', async () => {
      const mockPullRequest = createMockPullRequest({
        build: {
          ...createMockPullRequest().build,
          deploys: [
            { id: 1, service: {}, deployable: {}, status: 'success' },
            { id: 2, service: {}, deployable: {}, status: 'failed' },
            { id: 3, service: {}, deployable: {}, status: 'pending' },
          ],
        },
      });
      setupMocks(mockPullRequest);

      const { job, done } = createJobAndDone();

      await activityStream.processComments(job, done);

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
  });
});
