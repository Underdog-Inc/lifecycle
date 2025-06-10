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

import { NextApiRequest, NextApiResponse } from 'next/types';
import rootLogger from 'server/lib/logger';
import BuildService from 'server/services/build';
import { Build } from 'server/models';

const logger = rootLogger.child({
  filename: 'builds/[uuid]/services.ts',
});

/**
 * @openapi
 * /api/v1/builds/{uuid}/services:
 *   get:
 *     summary: List all services for a build
 *     description: |
 *       Retrieves a list of all services (deploys) associated with a specific build.
 *       Each service includes deployment status, configuration details, and runtime information.
 *       Returns both classic services and deployables depending on the build configuration.
 *     tags:
 *       - Builds
 *       - Services
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the build
 *       - in: query
 *         name: active
 *         required: false
 *         schema:
 *           type: boolean
 *         description: If true, only returns active services
 *     responses:
 *       200:
 *         description: Successfully retrieved services for build
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 services:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       deploy:
 *                         type: object
 *                         description: Deploy information
 *                         properties:
 *                           id:
 *                             type: integer
 *                           uuid:
 *                             type: string
 *                           status:
 *                             type: string
 *                             description: Deployment status
 *                           statusMessage:
 *                             type: string
 *                           active:
 *                             type: boolean
 *                           dockerImage:
 *                             type: string
 *                           publicUrl:
 *                             type: string
 *                           ipAddress:
 *                             type: string
 *                           port:
 *                             type: integer
 *                           branchName:
 *                             type: string
 *                           tag:
 *                             type: string
 *                           sha:
 *                             type: string
 *                           replicaCount:
 *                             type: integer
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                           updatedAt:
 *                             type: string
 *                             format: date-time
 *                       service:
 *                         type: object
 *                         description: Service configuration (classic mode)
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           type:
 *                             type: string
 *                           port:
 *                             type: string
 *                           public:
 *                             type: boolean
 *                           dockerImage:
 *                             type: string
 *                           dockerfilePath:
 *                             type: string
 *                           branchName:
 *                             type: string
 *                           defaultTag:
 *                             type: string
 *                           command:
 *                             type: string
 *                           arguments:
 *                             type: string
 *                       deployable:
 *                         type: object
 *                         description: Deployable configuration (full YAML mode)
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           type:
 *                             type: string
 *                           port:
 *                             type: string
 *                           public:
 *                             type: boolean
 *                           dockerImage:
 *                             type: string
 *                           dockerfilePath:
 *                             type: string
 *                           branchName:
 *                             type: string
 *                           defaultTag:
 *                             type: string
 *                           command:
 *                             type: string
 *                           arguments:
 *                             type: string
 *                           active:
 *                             type: boolean
 *                 buildInfo:
 *                   type: object
 *                   properties:
 *                     uuid:
 *                       type: string
 *                     enableFullYaml:
 *                       type: boolean
 *                       description: Whether this build uses full YAML configuration
 *                     totalServices:
 *                       type: integer
 *                       description: Total number of services
 *                     activeServices:
 *                       type: integer
 *                       description: Number of active services
 *       404:
 *         description: Build not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Build not found for abc-123
 *       405:
 *         description: Method not allowed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: POST is not allowed
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Unable to retrieve services for build abc-123.
 */
// eslint-disable-next-line import/no-anonymous-default-export
export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `${req.method} is not allowed` });
  }

  const { uuid, active } = req.query;

  if (!uuid || typeof uuid !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing build UUID' });
  }

  try {
    const buildService = new BuildService();

    const build: Build = await buildService.db.models.Build.query()
      .findOne({ uuid })
      .withGraphFetched('[deploys.[service, deployable], environment]');

    if (!build) {
      logger.info(`Build with UUID ${uuid} not found`);
      return res.status(404).json({ error: `Build not found for ${uuid}` });
    }

    let deploys = build.deploys || [];

    // Filter for active services only if requested
    if (active !== undefined && (active as string).toLowerCase() === 'true') {
      deploys = deploys.filter((deploy) => deploy.active);
    }

    // Transform deploys into service information
    const services = deploys.map((deploy) => {
      const serviceInfo: any = {
        deploy: {
          id: deploy.id,
          uuid: deploy.uuid,
          status: deploy.status,
          statusMessage: deploy.statusMessage,
          active: deploy.active,
          dockerImage: deploy.dockerImage,
          publicUrl: deploy.publicUrl,
          ipAddress: deploy.ipAddress,
          port: deploy.port,
          branchName: deploy.branchName,
          tag: deploy.tag,
          sha: deploy.sha,
          replicaCount: deploy.replicaCount,
          createdAt: deploy.createdAt,
          updatedAt: deploy.updatedAt,
        },
      };

      // Include service info for classic mode
      if (deploy.service) {
        serviceInfo.service = {
          id: deploy.service.id,
          name: deploy.service.name,
          type: deploy.service.type,
          port: deploy.service.port,
          public: deploy.service.public,
          dockerImage: deploy.service.dockerImage,
          dockerfilePath: deploy.service.dockerfilePath,
          branchName: deploy.service.branchName,
          defaultTag: deploy.service.defaultTag,
          command: deploy.service.command,
          arguments: deploy.service.arguments,
        };
      }

      // Include deployable info for full YAML mode
      if (deploy.deployable) {
        serviceInfo.deployable = {
          id: deploy.deployable.id,
          name: deploy.deployable.name,
          type: deploy.deployable.type,
          port: deploy.deployable.port,
          public: deploy.deployable.public,
          dockerImage: deploy.deployable.dockerImage,
          dockerfilePath: deploy.deployable.dockerfilePath,
          branchName: deploy.deployable.branchName,
          defaultTag: deploy.deployable.defaultTag,
          command: deploy.deployable.command,
          arguments: deploy.deployable.arguments,
          active: deploy.deployable.active,
        };
      }

      return serviceInfo;
    });

    // Calculate summary statistics
    const totalServices = deploys.length;
    const activeServices = deploys.filter((deploy) => deploy.active).length;

    return res.status(200).json({
      services,
      buildInfo: {
        uuid: build.uuid,
        enableFullYaml: build.enableFullYaml,
        totalServices,
        activeServices,
      },
    });
  } catch (error) {
    logger.error(`Unable to retrieve services for build ${uuid}. Error: \n ${error}`);
    return res.status(500).json({ error: `Unable to retrieve services for build ${uuid}.` });
  }
};
