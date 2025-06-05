# Copyright 2025 GoodRx, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Use a common base image for both stages
FROM node:20-slim

# Set environment variables
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_DEFAULT_TO_LATEST=0
RUN corepack enable

# Create the working directory and copy the application code
WORKDIR /app

# Install required packages and tools
RUN apt-get update && apt-get install -y curl awscli jq && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Codefresh CLI and other tools
RUN pnpm install -g codefresh

# Install kubectl and helm
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
  chmod +x ./kubectl && \
  mv ./kubectl /usr/local/bin/kubectl && \
  curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 && \
  chmod 700 get_helm.sh && \
  ./get_helm.sh

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

ARG DATABASE_URL
ARG REDIS_URL

ENV REDIS_URL=${REDIS_URL}
ENV DATABASE_URL=${DATABASE_URL}

# Expose the required port
ENV PORT 3000
EXPOSE 3000

# Copy scripts and set permissions
COPY ./sysops/tilt/scripts/app_setup_entrypoint.sh /app_setup_entrypoint.sh
RUN chmod +x /app_setup_entrypoint.sh

# Set the entry point and default command
ENTRYPOINT ["/app_setup_entrypoint.sh"]
