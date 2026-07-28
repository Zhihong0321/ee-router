FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/install-agy.sh \
    && bash /tmp/install-agy.sh --dir /usr/local/bin \
    && rm -f /tmp/install-agy.sh \
    && agy --version

# AGY resolves its native OAuth profile from the OS user's passwd home.
# Railway mounts the EE Router persistent volume at /storage.
RUN usermod --home /storage node

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/storage \
    AGY_BIN=/usr/local/bin/agy \
    AGY_SCRATCH_ROOT=/tmp/agyproxy \
    AGY_DIAGNOSTICS_ROOT=/storage/agy-diagnostics \
    AGY_TIMEOUT_MS=300000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./dist/db/migrations
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
    && chown -R node:node /app

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
