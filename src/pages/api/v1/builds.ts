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

const logger = rootLogger.child({
  filename: 'builds.ts',
});

/**
 * @openapi
 * /api/v1/builds:
 *   get:
 *     summary: List builds with filtering and pagination
 *     description: |
 *       Retrieves a paginated and filterable list of builds in the system. The builds are returned with
 *       their basic information including status, environment, and pull request details.
 *     tags:
 *       - Builds
 *     parameters:
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by build status (e.g., queued, building, deployed, error, torn_down)
 *       - in: query
 *         name: isStatic
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Filter by static environment flag
 *       - in: query
 *         name: active
 *         required: false
 *         schema:
 *           type: boolean
 *         description: If true, excludes torn_down builds
 *       - in: query
 *         name: environmentId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Filter by environment ID
 *       - in: query
 *         name: environmentName
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by environment name
 *       - in: query
 *         name: repository
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by repository full name (e.g., owner/repo)
 *       - in: query
 *         name: branch
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by branch name
 *       - in: query
 *         name: prStatus
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter by pull request status (open, closed, merged)
 *       - in: query
 *         name: pullRequestId
 *         required: false
 *         schema:
 *           type: integer
 *         description: Filter by specific pull request ID
 *       - in: query
 *         name: createdAfter
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter builds created after this date (ISO 8601)
 *       - in: query
 *         name: createdBefore
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter builds created before this date (ISO 8601)
 *       - in: query
 *         name: updatedAfter
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter builds updated after this date (ISO 8601)
 *       - in: query
 *         name: updatedBefore
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter builds updated before this date (ISO 8601)
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *         description: Search text across build UUID, branch name, and PR title
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of items per page
 *       - in: query
 *         name: sortBy
 *         required: false
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, status]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         required: false
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Successfully retrieved list of builds
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 builds:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: Internal build ID
 *                       uuid:
 *                         type: string
 *                         description: Unique identifier for the build
 *                       status:
 *                         type: string
 *                         description: Current status of the build
 *                       statusMessage:
 *                         type: string
 *                         description: Detailed status message
 *                       environmentId:
 *                         type: integer
 *                         description: ID of the associated environment
 *                       sha:
 *                         type: string
 *                         description: Git SHA associated with the build
 *                       namespace:
 *                         type: string
 *                         description: Kubernetes namespace for the build
 *                       isStatic:
 *                         type: boolean
 *                         description: Whether this is a static environment
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         description: When the build was created
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *                         description: When the build was last updated
 *                       environment:
 *                         type: object
 *                         description: Environment details
 *                         properties:
 *                           id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                       pullRequest:
 *                         type: object
 *                         description: Pull request details
 *                         properties:
 *                           id:
 *                             type: integer
 *                           fullName:
 *                             type: string
 *                           branchName:
 *                             type: string
 *                           title:
 *                             type: string
 *                           status:
 *                             type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                       description: Current page number
 *                     totalPages:
 *                       type: integer
 *                       description: Total number of pages
 *                     total:
 *                       type: integer
 *                       description: Total number of builds matching filters
 *                     limit:
 *                       type: integer
 *                       description: Items per page
 *                     hasNextPage:
 *                       type: boolean
 *                       description: Whether there are more pages
 *                     hasPrevPage:
 *                       type: boolean
 *                       description: Whether there are previous pages
 *       400:
 *         description: Bad request - invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid date format for createdAfter
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
 *                   example: Unable to retrieve builds.
 */
// eslint-disable-next-line import/no-anonymous-default-export
export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: `${req.method} is not allowed` });
  }

  try {
    const buildService = new BuildService();

    // Extract and validate query parameters
    const {
      status,
      isStatic,
      active,
      environmentId,
      environmentName,
      repository,
      branch,
      prStatus,
      pullRequestId,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
      search,
      page = '1',
      limit = '50',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Validate pagination parameters
    const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNumber = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 50));
    const offset = (pageNumber - 1) * limitNumber;

    // Validate sort parameters
    const validSortFields = ['createdAt', 'updatedAt', 'status'];
    const sortField = validSortFields.includes(sortBy as string) ? (sortBy as string) : 'createdAt';
    const sortDirection = (sortOrder as string) === 'asc' ? 'asc' : 'desc';

    // Build query
    let query = buildService.db.models.Build.query().withGraphFetched('[environment, pullRequest]');

    // Apply filters
    if (status) {
      query = query.where('builds.status', status as string);
    }

    if (isStatic !== undefined) {
      const isStaticBool = (isStatic as string).toLowerCase() === 'true';
      query = query.where('builds.isStatic', isStaticBool);
    }

    if (active !== undefined && (active as string).toLowerCase() === 'true') {
      query = query.whereNot('builds.status', 'torn_down');
    }

    if (environmentId) {
      const envId = parseInt(environmentId as string, 10);
      if (!isNaN(envId)) {
        query = query.where('builds.environmentId', envId);
      }
    }

    if (environmentName) {
      query = query.joinRelated('environment').where('environment.name', 'ilike', `%${environmentName}%`);
    }

    if (pullRequestId) {
      const prId = parseInt(pullRequestId as string, 10);
      if (!isNaN(prId)) {
        query = query.where('builds.pullRequestId', prId);
      }
    }

    // Date filters
    if (createdAfter) {
      const date = new Date(createdAfter as string);
      if (!isNaN(date.getTime())) {
        query = query.where('builds.createdAt', '>=', date.toISOString());
      } else {
        return res.status(400).json({ error: 'Invalid date format for createdAfter' });
      }
    }

    if (createdBefore) {
      const date = new Date(createdBefore as string);
      if (!isNaN(date.getTime())) {
        query = query.where('builds.createdAt', '<=', date.toISOString());
      } else {
        return res.status(400).json({ error: 'Invalid date format for createdBefore' });
      }
    }

    if (updatedAfter) {
      const date = new Date(updatedAfter as string);
      if (!isNaN(date.getTime())) {
        query = query.where('builds.updatedAt', '>=', date.toISOString());
      } else {
        return res.status(400).json({ error: 'Invalid date format for updatedAfter' });
      }
    }

    if (updatedBefore) {
      const date = new Date(updatedBefore as string);
      if (!isNaN(date.getTime())) {
        query = query.where('builds.updatedAt', '<=', date.toISOString());
      } else {
        return res.status(400).json({ error: 'Invalid date format for updatedBefore' });
      }
    }

    // Repository and branch filters (requires joining pullRequest)
    if (repository || branch || prStatus || search) {
      query = query.joinRelated('pullRequest');

      if (repository) {
        query = query.where('pullRequest.fullName', 'ilike', `%${repository}%`);
      }

      if (branch) {
        query = query.where('pullRequest.branchName', 'ilike', `%${branch}%`);
      }

      if (prStatus) {
        query = query.where('pullRequest.status', prStatus as string);
      }

      // Search functionality
      if (search) {
        const searchTerm = `%${search}%`;
        query = query.where((builder) => {
          builder
            .where('builds.uuid', 'ilike', searchTerm)
            .orWhere('pullRequest.branchName', 'ilike', searchTerm)
            .orWhere('pullRequest.title', 'ilike', searchTerm);
        });
      }
    }

    // Get total count before applying pagination
    const totalQuery = query.clone().clearSelect().clearOrder().count('builds.id as count').first();
    const totalResult = (await totalQuery) as any;
    const total = parseInt(totalResult?.count as string, 10) || 0;

    // Apply sorting and pagination
    query = query.orderBy(`builds.${sortField}`, sortDirection).offset(offset).limit(limitNumber);

    const builds = await query;

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limitNumber);
    const hasNextPage = pageNumber < totalPages;
    const hasPrevPage = pageNumber > 1;

    return res.status(200).json({
      builds,
      pagination: {
        currentPage: pageNumber,
        totalPages,
        total,
        limit: limitNumber,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    logger.error(`Unable to retrieve builds. Error: \n ${error}`);
    return res.status(500).json({ error: 'Unable to retrieve builds.' });
  }
};
