# The QueueSprout worker: dispatcher, publish steps, token refresh, media jobs.
# Build from the repo root:  docker build -f docker/worker.Dockerfile -t queuesprout-worker .
# Runs on amd64 and arm64 (Oracle Ampere): sharp ships prebuilt binaries for both.

# The official Node image; a mirror such as public.ecr.aws/docker/library/node works too.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @queuesprout/worker...
RUN pnpm --filter @queuesprout/worker build
# A self-contained folder: package.json, dist/ (workspace code bundled in) and the
# production node_modules it still needs (pg, pg-boss, sharp, the AWS SDK).
RUN pnpm --filter @queuesprout/worker deploy --legacy --prod /out

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.source="https://github.com/rickavila296/queuesprout" \
      org.opencontainers.image.description="QueueSprout worker" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
CMD ["node", "dist/index.js"]
