import { NextApiRequest, NextApiResponse } from 'next/types';
import rootLogger from 'server/lib/logger';
import { Build } from 'server/models';

import { BuildStatus, DeployStatus } from 'shared/constants';
import BuildService from 'server/services/build';

const logger = rootLogger.child({
  filename: 'builds/[uuid]/torndown.ts',
});

/**
 * @openapi
 * /api/v1/builds/{uuid}/torndown:
 *   patch:
 *     summary: Change the Status of of all Deploys, Builds and Deployables that has this uuid attached to tornDown
 *     description: |
 *       Triggers a redeployment of a specific service within a build. The service
 *       will be queued for deployment and its status will be updated accordingly.
 *     tags:
 *       - Builds
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the build
 *     responses:
 *       200:
 *         description: This namespace env-{uuid} was updated to changed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 namespacesUpdated:
 *                   type: string
 *                   example: [{"id": 64087, "uuid": "noisy-mud-690038", "status": "torn_down"}]
 *       404:
 *         description: Build not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: The uuid doesn't exist. Please check the uuid.
 */
// eslint-disable-next-line import/no-anonymous-default-export
export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'PATCH') {
    logger.info({ method: req.method }, `[${req.method}] Method not allowed`);
    return res.status(405).json({ error: `${req.method} is not allowed` });
  }

  const uuid = req.query?.uuid;

  try {
    if (!uuid) {
      logger.info(`[${uuid}] The uuid is required`);
      return res.status(500).json({ error: 'The uuid is required' });
    }
    const buildService = new BuildService();

    const build: Build = await buildService.db.models.Build.query()
      .findOne({
        uuid,
      })
      .withGraphFetched('[deploys]');

    if (build.isStatic || !build) {
      logger.info(`[${uuid}] The build doesn't exist or is static environment`);
      return res.status(404).json({ error: `The build doesn't exist or is static environment` });
    }

    const deploysIds = build.deploys.map((deploy) => deploy.id);

    await buildService.db.models.Build.query().findById(build.id).patch({
      status: BuildStatus.TORN_DOWN,
      statusMessage: 'Namespace was deleted successfully',
    });

    await buildService.db.models.Deploy.query()
      .whereIn('id', deploysIds)
      .patch({ status: DeployStatus.TORN_DOWN, statusMessage: 'Namespace was deleted successfully' });

    const updatedDeploys = await buildService.db.models.Deploy.query()
      .whereIn('id', deploysIds)
      .select('id', 'uuid', 'status');

    return res.status(200).json({
      status: `The namespace env-${uuid} it was delete sucessfuly`,
      namespacesUpdated: updatedDeploys,
    });
  } catch (error) {
    logger.error({ error }, `[${uuid}] Error in cleanup API in`);
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};
