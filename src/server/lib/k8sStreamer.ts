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

import { KubeConfig } from '@kubernetes/client-node';
import rootLogger from './logger';
import * as k8s from '@kubernetes/client-node';
import { PassThrough, Writable } from 'stream';

const logger = rootLogger.child({
  filename: 'lib/k8sStreamer.ts',
});

export interface AbortHandle {
  abort: () => void;
}

/**
 * Streams logs from a specific container within a Kubernetes pod.
 * @param params Parameters including podName, namespace, containerName, and options.
 * @param callbacks Callbacks for data, error, and end events.
 * @returns An AbortHandle to stop the stream.
 */
export function streamK8sLogs(
  params: {
    podName: string;
    namespace: string;
    containerName: string;
    follow: boolean;
    tailLines: number;
    timestamps: boolean;
  },
  callbacks: {
    // eslint-disable-next-line no-unused-vars
    onData: (line: string) => void;
    // eslint-disable-next-line no-unused-vars
    onError: (err: Error) => void;
    onEnd: () => void;
  }
): AbortHandle {
  const { podName, namespace, containerName: rawContainerName, follow, tailLines, timestamps } = params;
  const containerName = rawContainerName.startsWith('[init] ') ? rawContainerName.substring(7) : rawContainerName;
  const logCtx = { podName, namespace, containerName, follow, tailLines };

  const kc = new KubeConfig();
  kc.loadFromDefault();
  const k8sLog = new k8s.Log(kc);

  let k8sRequest: any | null = null;
  let streamEnded = false;

  const stream = new PassThrough();
  let buffer = '';

  stream.on('data', (chunk) => {
    if (streamEnded) return;
    try {
      buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.substring(0, newlineIndex);
        buffer = buffer.substring(newlineIndex + 1);
        if (line) {
          callbacks.onData(line);
        }
      }
    } catch (e: any) {
      logger.error({ ...logCtx, err: e }, 'Error processing log stream data chunk');
    }
  });

  stream.on('end', () => {
    if (streamEnded) return;
    streamEnded = true;
    try {
      if (buffer) {
        callbacks.onData(buffer);
        buffer = '';
      }
      callbacks.onEnd();
    } catch (e: any) {
      logger.error({ ...logCtx, err: e }, 'Error during log stream end processing');
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    }
  });

  stream.on('error', (err) => {
    if (streamEnded) return;
    streamEnded = true;
    logger.error({ ...logCtx, err }, 'K8s log stream encountered an error event.');
    buffer = '';
    callbacks.onError(err);
  });

  (async () => {
    try {
      const logOptions = {
        follow,
        tailLines,
        timestamps,
        pretty: false,
      };

      k8sRequest = await k8sLog.log(namespace, podName, containerName, stream as Writable, logOptions);

      logger.debug(logCtx, 'k8sLog.log promise resolved (stream likely ended or follow=false).');

      if (k8sRequest) {
        k8sRequest.on('error', (err: Error) => {
          if (streamEnded) return;
          logger.error({ ...logCtx, err }, 'K8s request object emitted error.');
          if (stream.writable) {
            stream.emit('error', err);
          } else {
            callbacks.onError(err);
          }
        });
        k8sRequest.on('complete', () => {
          if (streamEnded) return;
          if (stream.writable) {
            stream.end();
          }
        });
      }
    } catch (err: any) {
      if (streamEnded) return;
      if (err.name !== 'AbortError') {
        logger.error({ ...logCtx, err }, 'Failed to establish K8s log stream connection.');
        buffer = '';
        if (stream.writable) {
          stream.emit('error', err);
        } else {
          callbacks.onError(err);
        }
      } else {
        if (stream.writable) {
          stream.end();
        }
      }
    }
  })();

  return {
    abort: () => {
      if (k8sRequest && typeof k8sRequest.abort === 'function') {
        try {
          k8sRequest.abort();
        } catch (abortErr) {
          logger.error({ ...logCtx, err: abortErr }, 'Error calling abort() on K8s request.');
        }
      } else {
        logger.warn(logCtx, "Abort requested, but K8s request object not available or doesn't have abort method.");
      }
      stream.destroy();
      streamEnded = true;
    },
  };
}
