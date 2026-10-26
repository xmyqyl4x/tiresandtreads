FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.25.0
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/application/package.json ./packages/application/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/integrations/package.json ./packages/integrations/package.json
RUN --mount=type=cache,id=tt-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS tooling
COPY . .
ENV APP_ENV=test-local
ENV PROVIDER_MODE=fixtures

FROM tooling AS builder
RUN pnpm build

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runner
ARG SOURCE_REVISION=working
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /workspace/.local/preflight.mjs ./preflight.mjs
COPY --from=builder --chown=node:node /workspace/.local/worker.mjs ./worker.mjs
COPY --from=builder --chown=node:node /workspace/.local/import.mjs ./import.mjs
COPY --from=builder --chown=node:node /workspace/.local/source.mjs ./source.mjs
COPY --from=builder --chown=node:node /workspace/.local/mail-recover.mjs ./mail-recover.mjs
COPY --chown=node:node scripts/runtime/start.mjs ./start.mjs
USER node
EXPOSE 3000
CMD ["node", "start.mjs"]
