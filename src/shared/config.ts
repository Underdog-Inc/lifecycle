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

import 'dotenv/config';
import getConfig from 'next/config';
import { serverRuntimeConfig as fallbackServerRuntimeConfig } from '../../next.config';

let serverRuntimeConfig = null;

/* There are some situations where getConfig is not initialized because of how next works */
if (getConfig() === undefined) {
  serverRuntimeConfig = fallbackServerRuntimeConfig;
} else {
  serverRuntimeConfig = getConfig().serverRuntimeConfig;
}

const getServerRuntimeConfig = (key: string, fallback?: any): any => {
  return getProp(serverRuntimeConfig, key, fallback);
};

const getProp = (config: Record<string, any>, key: string, fallback?: any): any => {
  const value = config[key];
  if (!!value || !!fallback) {
    return value || fallback;
  } else {
    // The literal fallback value of "false" is valid. All other falsy fallbacks are not.
    if (fallback === false) return fallback;

    if ('yes' === process.env.BUILD_MODE) return '';

    throw new Error(`Required config missing: '${key}'`);
  }
};

export const APP_ENV = getServerRuntimeConfig('APP_ENV', 'development');
export const IS_PROD = APP_ENV === 'production';
export const IS_STG = APP_ENV === 'staging';
export const IS_DEV = APP_ENV !== 'production';
export const TMP_PATH = `/tmp/lifecycle`;

export const DATABASE_URL = getServerRuntimeConfig('DATABASE_URL');

export const LIFECYCLE_UI_HOSTHAME_WITH_SCHEME = getServerRuntimeConfig(
  'LIFECYCLE_UI_HOSTHAME_WITH_SCHEME',
  'REPLACE_ME_WITH_UI_URL'
);

export const GITHUB_APP_ID = getServerRuntimeConfig('GITHUB_APP_ID');
export const GITHUB_CLIENT_ID = getServerRuntimeConfig('GITHUB_CLIENT_ID');
export const GITHUB_CLIENT_SECRET = getServerRuntimeConfig('GITHUB_CLIENT_SECRET');

export const LIFECYCLE_MODE = getServerRuntimeConfig('LIFECYCLE_MODE');
export const REDIS_URL = getServerRuntimeConfig('REDIS_URL');
export const REDIS_PORT = getServerRuntimeConfig('REDIS_PORT', 6379);

export const GITHUB_PRIVATE_KEY = getServerRuntimeConfig('GITHUB_PRIVATE_KEY')
  .replace(/\\n/g, '\n')
  .replace(/\\k/g, '\n');
export const GITHUB_WEBHOOK_SECRET = getServerRuntimeConfig('GITHUB_WEBHOOK_SECRET');

export const JOB_VERSION = getServerRuntimeConfig('JOB_VERSION', 'default');

export const LOG_LEVEL = getServerRuntimeConfig('LOG_LEVEL', 'debug');

export const FASTLY_TOKEN = getServerRuntimeConfig('FASTLY_TOKEN');

export const CODEFRESH_API_KEY = getServerRuntimeConfig('CODEFRESH_API_KEY');

export const MAX_GITHUB_API_REQUEST = getServerRuntimeConfig('MAX_GITHUB_API_REQUEST', 40);

export const GITHUB_API_REQUEST_INTERVAL = getServerRuntimeConfig('GITHUB_API_REQUEST_INTERVAL', 10000);

export const WEBHOOK_QUEUE_NAME = `webhook-processing-${JOB_VERSION}`;

export const GITHUB_APP_INSTALLATION_ID = getServerRuntimeConfig('GITHUB_APP_INSTALLATION_ID');

export const APP_AUTH = {
  appId: Number(GITHUB_APP_ID),
  privateKey: GITHUB_PRIVATE_KEY,
  clientId: GITHUB_CLIENT_ID,
  clientSecret: GITHUB_CLIENT_SECRET,
};

/**
 * @description datadog env vars
 */
export const DD_ENV = getServerRuntimeConfig('DD_ENV', 'prd');
export const DD_SERVICE = getServerRuntimeConfig('DD_SERVICE', 'lifecycle-job');
export const DD_VERSION = getServerRuntimeConfig('DD_VERSION', 'lifecycle');
export const DD_ENVS = {
  ENV: DD_ENV,
  SERVICE: DD_SERVICE,
  VERSION: DD_VERSION,
};
export const ENVIRONMENT = getServerRuntimeConfig('ENVIRONMENT', 'production');
export const APP_HOST = getServerRuntimeConfig('APP_HOST', 'http://localhost:5001');
