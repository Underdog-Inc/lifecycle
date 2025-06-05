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

import type { NextApiRequest, NextApiResponse } from 'next';
import rootLogger from 'server/lib/logger';
import { Deploy } from 'server/models';
import { getLogStreamingInfoForJob } from 'server/lib/logStreamingHelper';

const logger = rootLogger.child({
  filename: __filename,
});

/**
 * @openapi
 * /api/v1/builds/{uuid}/services/{name}/buildLogs:
 *   get:
 *     summary: Get streaming info for build logs of a service
 *     description: |
 *       Retrieves information required to stream logs for the build job
 *       associated with a specific service within an environment.
 *       Returns connection details if the build job pod is active (Running/Pending).
 *       Returns a status object if the build job pod is completed or not found.
 *       This endpoint *does not* return the actual log content.
 *     tags:
 *       - Services
 *       - Logs
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: The UUID of the environment (maps to build uuid)
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the service (which will be joined with the environment UUID to form the deployment uuid)
 *     responses:
 *       '200':
 *         description: OK. Contains streaming info or completion status.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object # Inline definition for StreamingInfo
 *                   required: [status, streamingRequired, websocket, containers]
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [Running, Pending]
 *                     streamingRequired:
 *                       type: boolean
 *                       example: true
 *                     websocket:
 *                       type: object
 *                       required: [endpoint, parameters]
 *                       properties:
 *                         endpoint:
 *                           type: string
 *                           example: /api/logs/stream
 *                         parameters:
 *                           type: object
 *                           required: [podName, namespace, follow, tailLines, timestamps]
 *                           properties:
 *                             podName:
 *                               type: string
 *                             namespace:
 *                               type: string
 *                             follow:
 *                               type: boolean
 *                             tailLines:
 *                               type: integer
 *                             timestamps:
 *                               type: boolean
 *                     containers:
 *                       type: array
 *                       items:
 *                         type: object # Inline definition for ContainerInfo
 *                         required: [containerName, state]
 *                         properties:
 *                           containerName:
 *                             type: string
 *                           state:
 *                             type: string
 *                 - type: object # Inline definition for LogSourceStatus
 *                   required: [status, streamingRequired, message]
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [Completed, Failed, NotFound, Unavailable, NotApplicable, Unknown]
 *                     streamingRequired:
 *                       type: boolean
 *                       example: false
 *                     message:
 *                       type: string
 *       '404':
 *         description: Environment, service (Deploy record), or associated build job not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object # Inline definition for Error
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Service MyService not found within environment abc-123.
 *       '405':
 *         description: Method not allowed (only GET is supported).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: POST is not allowed
 *       '500':
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal server error occurred.
 *       '502':
 *         description: Bad Gateway (Error communicating with Kubernetes).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to communicate with Kubernetes.
 */
// eslint-disable-next-line import/no-anonymous-default-export
export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    logger.warn({ method: req.method }, 'Method not allowed');
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `${req.method} is not allowed` });
  }

  const { uuid, name } = req.query;

  if (typeof uuid !== 'string' || typeof name !== 'string') {
    logger.warn({ uuid, name }, 'Missing or invalid query parameters');
    return res.status(400).json({ error: 'Missing or invalid uuid or name parameters' });
  }

  try {
    const deployUUID = `${name}-${uuid}`;
    const deploy = await Deploy.query().findOne({ uuid: deployUUID }).withGraphFetched('build');
    const responseData = await getLogStreamingInfoForJob(deploy, deploy.buildJobName);
    return res.status(200).json(responseData);
  } catch (error) {
    logger.error({ err: error }, `Error getting build log streaming info for service ${name} in environment ${uuid}.`);
    if (error.message?.includes('Kubernetes') || error.statusCode === 502) {
      return res.status(502).json({ error: 'Failed to communicate with Kubernetes.' });
    }
    return res.status(500).json({ error: 'Internal server error occurred.' });
  }
};
