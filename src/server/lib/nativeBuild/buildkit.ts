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

import { ContainerBuildOptions } from 'server/lib/codefresh/types';
import rootLogger from '../logger';
import * as yaml from 'js-yaml';
import Deploy from 'server/models/Deploy';
import { createJob, buildImage as genericBuildImage, getGitHubToken, GIT_USERNAME, JobResult } from './utils';
import { constructEcrTag } from '../codefresh/utils';
import GlobalConfigService from 'server/services/globalConfig';

const logger = rootLogger.child({
  filename: 'lib/buildkit/buildkit.ts',
});

export interface BuildkitBuildOptions extends ContainerBuildOptions {
  namespace?: string;
}

export async function createBuildkitContainer(
  repoName: string,
  dockerfilePath: string,
  destination: string,
  buildArgs: string[],
  namespace: string,
  containerName: string = 'buildkit',
  gitToken: string,
  branch: string
): Promise<any> {
  const shortRepoName = repoName.split('/')[1] || repoName;
  const { lifecycleDefaults } = await GlobalConfigService.getInstance().getAllConfigs();

  const inClusterRegistry = lifecycleDefaults?.ecrDomain;
  const region = 'us-west-2';

  const formattedBuildArgs = buildArgs
    .map((arg) => {
      const [key, value] = arg.split('=');
      return `--opt build-arg:${key}=${value}`;
    })
    .join(' ');

  return {
    name: containerName,
    image: 'moby/buildkit:v0.12.0',
    env: [
      {
        name: 'AWS_REGION',
        value: region,
      },
    ],
    command: ['/bin/sh', '-c'],
    args: [
      `set -e
      apk add --no-cache docker
      
      # Run buildctl
      BUILDKIT_HOST=tcp://buildkit.lifecycle-app.svc.cluster.local:1234 buildctl build \
        --frontend dockerfile.v0 \
        --opt context=https://x-access-token:${gitToken}@github.com/${repoName}.git#${branch} \
        --opt filename=${dockerfilePath} \
        --output type=image,name=${destination},push=true \
        ${formattedBuildArgs} \
        --import-cache type=registry,ref=${inClusterRegistry}/${shortRepoName}:cache,insecure=true \
        --export-cache type=registry,ref=${inClusterRegistry}/${shortRepoName}:cache,mode=min,compression=zstd,insecure=true`,
    ],
    volumeMounts: [
      {
        name: 'buildkit-workspace',
        mountPath: '/workspace',
      },
    ],
  };
}

export const generateBuildkitManifest = async (
  deploy: Deploy,
  jobId: string,
  options: BuildkitBuildOptions
): Promise<string> => {
  const { tag, ecrDomain, namespace = 'lifecycle-app', initTag } = options;

  const appShort = deploy.deployable.appShort;
  const ecrRepo = deploy.deployable.ecr;
  const envVars = deploy.env;
  const repo = deploy.repository.fullName;
  const revision = deploy.sha;
  const dockerfilePath = deploy.deployable.dockerfilePath;
  const initDockerfilePath = deploy.deployable.initDockerfilePath;
  const branch = deploy.branchName;

  const gitToken = await getGitHubToken();
  const ecrRepoTag = constructEcrTag({ repo: ecrRepo, tag, ecrDomain });

  const buildArgList = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);

  const containers = [];

  const mainBuildkitContainer = await createBuildkitContainer(
    repo,
    dockerfilePath,
    ecrRepoTag,
    buildArgList,
    namespace,
    'buildkit-main',
    gitToken,
    branch
  );

  containers.push(mainBuildkitContainer);

  if (initDockerfilePath && initTag) {
    const initEcrRepoTag = constructEcrTag({ repo: ecrRepo, tag: initTag, ecrDomain });

    const initBuildkitContainer = await createBuildkitContainer(
      repo,
      initDockerfilePath,
      initEcrRepoTag,
      buildArgList,
      namespace,
      'buildkit-init',
      gitToken,
      branch
    );

    containers.push(initBuildkitContainer);
  }

  const shortSha = revision.substring(0, 7);
  let jobName = `${deploy.uuid}-buildkit-${jobId}-${shortSha}`.substring(0, 63);
  if (jobName.endsWith('-')) {
    jobName = jobName.slice(0, -1);
  }

  // Volume configuration for buildkit
  const volumeConfig = {
    workspaceName: 'buildkit-workspace',
    volumes: [
      {
        name: 'buildkit-workspace',
        emptyDir: {},
      },
    ],
  };

  const job = createJob(jobName, namespace, GIT_USERNAME, gitToken, null, containers, volumeConfig);
  const manifestResources = [job];
  const manifestYaml = manifestResources.map((resource) => yaml.dump(resource)).join('\n---\n');

  logger.info('Generated Buildkit manifest for', { appShort, tag });
  return manifestYaml;
};

// Main function to build images with Buildkit
export const buildkitImageBuild = async (deploy: Deploy, options: ContainerBuildOptions): Promise<JobResult> => {
  return genericBuildImage(deploy, options as BuildkitBuildOptions, generateBuildkitManifest, 'Buildkit');
};
