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

import React from 'react';
import { useRouter } from 'next/router';
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { GetServerSideProps } from 'next';
import { defaultDb } from 'server/lib/dependencies';

type ContainerInfo = {
  containerName: string;
  state: string;
};

type WebSocketInfo = {
  endpoint: string;
  parameters: {
    podName: string;
    namespace: string;
    follow: boolean;
    tailLines: number;
    timestamps: boolean;
  };
};

type StreamingLogInfo = {
  status: 'Running' | 'Pending';
  streamingRequired: true;
  websocket: WebSocketInfo;
  containers: ContainerInfo[];
};

type NonStreamingLogInfo = {
  status: 'Completed' | 'Failed' | 'NotFound' | 'Unavailable' | 'NotApplicable' | 'Unknown';
  streamingRequired: false;
  message: string;
  podName?: string | null;
  containers?: string[];
  buildOutput?: string | null;
};

type LogInfo = StreamingLogInfo | NonStreamingLogInfo;

type LogMessage = {
  type: 'log' | 'error' | 'end';
  payload?: string;
  message?: string;
  reason?: string;
};

function isNonStreamingLogInfo(logInfo: LogInfo): logInfo is NonStreamingLogInfo {
  return !logInfo.streamingRequired;
}

function isStreamingLogInfo(logInfo: LogInfo): logInfo is StreamingLogInfo {
  return logInfo.streamingRequired;
}

type ServiceBuildLogsProps = {
  dbLogs?: {
    buildOutput: string;
    containers: string[];
  } | null;
  serverError?: {
    message: string;
    type: string;
  };
};

export default function ServiceBuildLogs({ dbLogs, serverError }: ServiceBuildLogsProps) {
  const router = useRouter();
  const { uuid, name } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null);
  const [activeContainer, setActiveContainer] = useState<string>('');
  const [logsByContainer, setLogsByContainer] = useState<Record<string, string[]>>({});
  const [socketsByContainer, setSocketsByContainer] = useState<Record<string, WebSocket | null>>({});
  const [connectingContainers, setConnectingContainers] = useState<string[]>([]);
  const [completedContainers, setCompletedContainers] = useState<Set<string>>(new Set());
  const [errorContainers, setErrorContainers] = useState<Set<string>>(new Set());

  const isMountedRef = useRef(true);
  const autoCloseTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const closeContainerConnection = useCallback((containerName: string) => {
    if (autoCloseTimeouts.current[containerName]) {
      clearTimeout(autoCloseTimeouts.current[containerName]);
      delete autoCloseTimeouts.current[containerName];
    }

    setSocketsByContainer(prev => {
      const newSockets = { ...prev };
      if (newSockets[containerName] && newSockets[containerName]?.readyState !== WebSocket.CLOSED) {
        newSockets[containerName]?.close();
        newSockets[containerName] = null;
      }
      return newSockets;
    });
  }, []);

  const closeAllConnections = useCallback(() => {
    Object.keys(socketsByContainer).forEach(containerName => {
      closeContainerConnection(containerName);
    });
  }, [closeContainerConnection, socketsByContainer]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      isMountedRef.current = false;

      // Clear any pending timeouts
      const timeouts = autoCloseTimeouts.current;
      Object.values(timeouts).forEach(timeout => {
        clearTimeout(timeout);
      });

      // Close all connections
      closeAllConnections();
    };
  }, []);

  const processDbLogs = useCallback((buildOutput: string) => {
    const containers: { containerName: string, logs: string[] }[] = [];

    const mainContainerMatch = buildOutput.indexOf('--- MAIN CONTAINER ---');
    const initContainerMatch = buildOutput.indexOf('--- INIT CONTAINER ---');

    if (mainContainerMatch !== -1) {
      const mainLogsStart = mainContainerMatch + '--- MAIN CONTAINER ---'.length;
      let mainLogsEnd;

      if (initContainerMatch !== -1 && initContainerMatch > mainContainerMatch) {
        mainLogsEnd = initContainerMatch;
      } else {
        mainLogsEnd = buildOutput.length;
      }

      const mainLogs = buildOutput.substring(mainLogsStart, mainLogsEnd).trim().split('\n');
      containers.push({ containerName: 'MAIN CONTAINER', logs: mainLogs });
    }

    if (initContainerMatch !== -1) {
      const initLogsStart = initContainerMatch + '--- INIT CONTAINER ---'.length;
      let initLogsEnd;

      if (mainContainerMatch !== -1 && mainContainerMatch > initContainerMatch) {
        initLogsEnd = mainContainerMatch;
      } else {
        initLogsEnd = buildOutput.length;
      }

      const initLogs = buildOutput.substring(initLogsStart, initLogsEnd).trim().split('\n');
      containers.push({ containerName: 'INIT CONTAINER', logs: initLogs });
    }

    if (containers.length === 0) {
      containers.push({ containerName: 'main', logs: buildOutput.split('\n') });
    }

    return containers;
  }, []);

  const fetchLogInfo = useCallback(async () => {
    if (!uuid || !name || !isMountedRef.current) return;

    try {
      setLoading(true);
      setError(null);
      setCompletedContainers(new Set());
      setErrorContainers(new Set());

      if (dbLogs?.buildOutput) {
        const buildLogs = dbLogs.buildOutput;
        const containers = processDbLogs(buildLogs);

        const newLogsByContainer: Record<string, string[]> = {};
        containers.forEach(container => {
          newLogsByContainer[container.containerName] = container.logs;
        });

        setLogsByContainer(newLogsByContainer);

        const completedSet = new Set<string>();
        containers.forEach(container => {
          completedSet.add(container.containerName);
        });
        setCompletedContainers(completedSet);

        if (containers.length > 0) {
          setActiveContainer(containers[0].containerName);
        } else {
          setActiveContainer('main');
        }

        const dummyLogInfo: NonStreamingLogInfo = {
          status: 'Completed',
          streamingRequired: false,
          message: 'Logs loaded from database',
          containers: dbLogs.containers || containers.map(c => c.containerName),
          buildOutput: buildLogs
        };

        setLogInfo(dummyLogInfo);
        setLoading(false);
        return;
      }

      const apiBaseUrl = window.location.origin;

      const apiEndpoint = `/api/v1/builds/${uuid}/services/${name}/buildLogs`;
      const apiUrl = `${apiBaseUrl}${apiEndpoint}`;

      let response;
      try {
        response = await axios.get<LogInfo>(apiUrl);
      } catch (apiError) {
        console.error("Error calling buildLogs API:", apiError.message);
        setError(`API Error: ${apiError.message}`);
        setLoading(false);
        return;
      }

      if (!isMountedRef.current) return;

      if (isNonStreamingLogInfo(response.data) && response.data.buildOutput) {
        const buildLogs = response.data.buildOutput;
        const containers = processDbLogs(buildLogs);

        const newLogsByContainer: Record<string, string[]> = {};
        containers.forEach(container => {
          newLogsByContainer[container.containerName] = container.logs;
        });

        setLogsByContainer(newLogsByContainer);

        const completedSet = new Set<string>();
        containers.forEach(container => {
          completedSet.add(container.containerName);
        });
        setCompletedContainers(completedSet);
      }

      setLogInfo(response.data);

      if (isNonStreamingLogInfo(response.data) && response.data.status === 'Failed') {
        const errorSet = new Set<string>();
        if (response.data.containers && response.data.containers.length > 0) {
          response.data.containers.forEach(containerName => {
            errorSet.add(containerName);
          });
        }
        setErrorContainers(errorSet);
      }

      if (isStreamingLogInfo(response.data)) {
        if (response.data.containers && response.data.containers.length > 0) {
          setActiveContainer(response.data.containers[0].containerName);
        } else {
          setActiveContainer('main');
        }
      } else if (isNonStreamingLogInfo(response.data) && response.data.containers?.length) {
        setActiveContainer(response.data.containers[0]);
      } else {
        setActiveContainer('main');
      }

      setLoading(false);
    } catch (err: any) {
      if (!isMountedRef.current) return;

      console.error('Error fetching log info:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Unknown error';
      setError(`Failed to fetch log information: ${errorMessage}`);

      setActiveContainer('main');

      setLoading(false);
    }
  }, [uuid, name, dbLogs, processDbLogs]);

  useEffect(() => {
    if (dbLogs?.buildOutput) {
      fetchLogInfo();
    }
  }, [dbLogs, fetchLogInfo]);

  useEffect(() => {
    if (dbLogs?.buildOutput) {
      return;
    }

    if (uuid && name) {
      fetchLogInfo();
    }
  }, [uuid, name, fetchLogInfo, dbLogs]);

  const markContainerAsCompleted = useCallback((containerName: string, isError: boolean = false) => {
    if (isMountedRef.current) {
      if (isError) {
        setErrorContainers(prev => {
          const newSet = new Set(prev);
          newSet.add(containerName);
          return newSet;
        });
      }

      setCompletedContainers(prev => {
        const newSet = new Set(prev);
        newSet.add(containerName);
        return newSet;
      });

      setConnectingContainers(prev => prev.filter(c => c !== containerName));

      closeContainerConnection(containerName);
    }
  }, [closeContainerConnection]);

  const connectToContainer = useCallback((containerName: string) => {
    if (!logInfo || !isMountedRef.current) return;

    if (isNonStreamingLogInfo(logInfo) && completedContainers.has(containerName)) {
      return;
    }

    let podName: string | null = null;
    let namespace: string = 'lifecycle-app';

    if (isStreamingLogInfo(logInfo)) {
      podName = logInfo.websocket.parameters.podName;
      namespace = logInfo.websocket.parameters.namespace;
    } else if (isNonStreamingLogInfo(logInfo) && logInfo.podName) {
      podName = logInfo.podName;
      namespace = 'lifecycle-app';
    }

    if (!podName) {
      if (isMountedRef.current) {
        setError('No pod information available for connection');
      }
      return;
    }

    closeContainerConnection(containerName);

    if (isMountedRef.current) {
      setConnectingContainers(prev => [...prev, containerName]);

      if (!completedContainers.has(containerName)) {
        setLogsByContainer(prev => ({
          ...prev,
          [containerName]: []
        }));
      }
    }

    // Build WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; // includes hostname and port if present

    const params = new URLSearchParams();
    params.append('podName', podName);
    params.append('namespace', namespace);
    params.append('containerName', containerName);
    params.append('follow', isStreamingLogInfo(logInfo) ? 'true' : 'false');
    params.append('tailLines', '200');
    params.append('timestamps', 'false');

    const wsUrl = `${wsProtocol}//${host}/api/logs/stream?${params.toString()}`;

    try {
      const newSocket = new WebSocket(wsUrl);

      newSocket.onopen = () => {
        if (isMountedRef.current) {
          setConnectingContainers(prev => prev.filter(c => c !== containerName));
        }
      };

      const shouldAutoClose = isNonStreamingLogInfo(logInfo);
      let hasReceivedLogs = false;

      newSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as LogMessage;

          if (data.type === 'log' && data.payload) {
            if (isMountedRef.current) {
              setLogsByContainer(prev => ({
                ...prev,
                [containerName]: [...(prev[containerName] || []), data.payload]
              }));
            }

            hasReceivedLogs = true;

            if (shouldAutoClose && hasReceivedLogs && !autoCloseTimeouts.current[containerName]) {
              autoCloseTimeouts.current[containerName] = setTimeout(() => {
                if (isMountedRef.current) {
                  markContainerAsCompleted(containerName, false);
                }

                if (autoCloseTimeouts.current[containerName]) {
                  delete autoCloseTimeouts.current[containerName];
                }
              }, 1000);
            }
          } else if (data.type === 'error' && data.message) {
            console.error(`Log stream error for ${containerName}:`, data.message);
            if (isMountedRef.current) {
              setError(`Log stream error for ${containerName}: ${data.message}`);
              setConnectingContainers(prev => prev.filter(c => c !== containerName));

              if (shouldAutoClose) {
                markContainerAsCompleted(containerName, true);
              }
            }
          } else if (data.type === 'end') {
            if (isMountedRef.current) {
              setConnectingContainers(prev => prev.filter(c => c !== containerName));

              if (shouldAutoClose) {
                const isError = isNonStreamingLogInfo(logInfo) &&
                  (logInfo.status === 'Failed' || data.reason?.toLowerCase().includes('error'));
                markContainerAsCompleted(containerName, isError);
              }
            }
          }
        } catch (err) {
          console.error(`Error parsing WebSocket message for ${containerName}:`, err);
        }
      };

      newSocket.onerror = (err) => {
        console.error(`WebSocket error for ${containerName}:`, err);
        if (isMountedRef.current) {
          if (!completedContainers.has(containerName)) {
            setError(`WebSocket connection error for ${containerName}`);
          }

          setConnectingContainers(prev => prev.filter(c => c !== containerName));

          if (shouldAutoClose) {
            markContainerAsCompleted(containerName, true);
          }
        }
      };

      newSocket.onclose = () => {
        if (isMountedRef.current) {
          setConnectingContainers(prev => prev.filter(c => c !== containerName));

          if (shouldAutoClose) {
            const isError = isNonStreamingLogInfo(logInfo) &&
              (logInfo.status === 'Failed' || errorContainers.has(containerName));
            markContainerAsCompleted(containerName, isError);
          }
        }
      };

      if (isMountedRef.current) {
        setSocketsByContainer(prev => ({
          ...prev,
          [containerName]: newSocket
        }));
      } else {
        newSocket.close();
      }

    } catch (err) {
      console.error(`Error creating WebSocket for ${containerName}:`, err);
      if (isMountedRef.current) {
        setError(`Failed to create WebSocket for ${containerName}`);
        setConnectingContainers(prev => prev.filter(c => c !== containerName));

        if (isNonStreamingLogInfo(logInfo)) {
          markContainerAsCompleted(containerName, true);
        }
      }
    }
  }, [logInfo, closeContainerConnection, completedContainers, markContainerAsCompleted, errorContainers]);

  useEffect(() => {
    if (activeContainer && !socketsByContainer[activeContainer] && !completedContainers.has(activeContainer) && isMountedRef.current) {
      connectToContainer(activeContainer);
    }
  }, [activeContainer, socketsByContainer, connectToContainer, completedContainers]);

  const handleTabChange = (containerName: string) => {
    setActiveContainer(containerName);
  };

  const getAvailableContainers = (): { containerName: string, state: string }[] => {
    if (!logInfo) {
      return [{ containerName: activeContainer || 'main', state: 'unknown' }];
    }

    if (isStreamingLogInfo(logInfo) && logInfo.containers.length > 0) {
      return logInfo.containers;
    }

    if (isNonStreamingLogInfo(logInfo) && logInfo.containers && logInfo.containers.length > 0) {
      // Convert string container names to ContainerInfo objects
      return logInfo.containers.map(containerName => ({
        containerName,
        state: 'unknown'
      }));
    }

    return [{ containerName: activeContainer || 'main', state: 'unknown' }];
  };

  // eslint-disable-next-line no-unused-vars
  const isContainerConnected = (containerName: string): boolean => {
    return !!socketsByContainer[containerName] &&
      socketsByContainer[containerName]?.readyState === WebSocket.OPEN;
  };

  const isContainerConnecting = (containerName: string): boolean => {
    return connectingContainers.includes(containerName) ||
      (!!socketsByContainer[containerName] &&
        socketsByContainer[containerName]?.readyState === WebSocket.CONNECTING);
  };

  const isContainerCompleted = (containerName: string): boolean => {
    return completedContainers.has(containerName);
  };

  // eslint-disable-next-line no-unused-vars
  const isContainerError = (containerName: string): boolean => {
    return errorContainers.has(containerName);
  };

  useEffect(() => {
    if (serverError) {
      console.error("Server-side error occurred:", serverError);
      setError(`Server error: ${serverError.message}`);
      setLoading(false);
    }
  }, [serverError]);

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px' }}>
        <h1>Build Logs: {name || 'Loading...'}</h1>
        {serverError && (
          <div style={{
            padding: '10px 15px',
            backgroundColor: '#fff0f0',
            borderRadius: '4px',
            marginBottom: '20px',
            border: '1px solid #ffcccc'
          }}>
            <p style={{ margin: 0, color: '#cc0000' }}>
              Server Error: {serverError.message} ({serverError.type})
            </p>
          </div>
        )}
        <div style={{
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px',
          marginTop: '20px'
        }}>
          <p>Loading log information...</p>
        </div>
      </div>
    );
  }

  const containers = getAvailableContainers();

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '10px', height: '95vh', display: 'flex', flexDirection: 'column' }}>
      {error && (
        <div style={{
          padding: '10px 15px',
          backgroundColor: '#fff0f0',
          borderRadius: '4px',
          marginBottom: '10px',
          border: '1px solid #ffcccc'
        }}>
          <p style={{ margin: 0, color: '#cc0000' }}>{error}</p>
        </div>
      )}

      {containers.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {/* Container tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #dee2e6',
            marginBottom: '10px',
            overflowX: 'auto',
            whiteSpace: 'nowrap'
          }}>
            {containers.map(container => {
              return (
                <div
                  key={container.containerName}
                  onClick={() => handleTabChange(container.containerName)}
                  style={{
                    padding: '10px 15px',
                    cursor: 'pointer',
                    borderBottom: activeContainer === container.containerName ? '2px solid #007bff' : 'none',
                    fontWeight: activeContainer === container.containerName ? 'bold' : 'normal',
                    color: activeContainer === container.containerName ? '#007bff' : 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    position: 'relative'
                  }}
                >
                  {container.containerName}
                </div>
              );
            })}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {logsByContainer[activeContainer]?.length > 0 ? (
              <pre style={{
                backgroundColor: '#1e1e1e',
                color: '#d4d4d4',
                padding: '10px',
                borderRadius: '4px',
                overflow: 'auto',
                fontSize: '13px',
                margin: 0,
                flex: 1
              }}>
                {logsByContainer[activeContainer].join('\n')}
              </pre>
            ) : (
              <div style={{
                backgroundColor: '#1e1e1e',
                color: '#d4d4d4',
                padding: '20px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                flex: 1
              }}>
                {isContainerConnecting(activeContainer) && !isContainerCompleted(activeContainer) ?
                  "Connecting to container logs..." :
                  "No logs available for this container."}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '4px',
          border: '1px solid #ddd',
          flex: 1
        }}>
          <p>No containers available for this pod.</p>
        </div>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { uuid, name } = context.params || {};

  if (!uuid || !name || Array.isArray(uuid) || Array.isArray(name)) {
    return {
      props: {
        dbLogs: null
      }
    };
  }

  try {
    const deployName = `${name}-${uuid}`;

    const deploy = await defaultDb.models.Deploy.query()
      .findOne({ uuid: deployName })
      .select('buildOutput');

    if (deploy && deploy.buildOutput) {
      const buildLogs = deploy.buildOutput;
      const containers = [];

      if (buildLogs.includes('--- MAIN CONTAINER ---')) {
        containers.push('MAIN CONTAINER');
      }

      if (buildLogs.includes('--- INIT CONTAINER ---')) {
        containers.push('INIT CONTAINER');
      }

      if (containers.length === 0) {
        containers.push('main');
      }

      return {
        props: {
          dbLogs: {
            buildOutput: deploy.buildOutput,
            containers: containers
          }
        }
      };
    }

    return {
      props: {
        dbLogs: null
      }
    };
  } catch (error) {
    console.error(`Error retrieving build logs for deployment ${name}-${uuid}:`, error);
    console.error("Stack trace:", error.stack);

    return {
      props: {
        dbLogs: null,
        serverError: {
          message: error.message,
          type: error.name || typeof error
        }
      }
    };
  }
}; 
