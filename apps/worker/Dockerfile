# Sosial publish worker — Railway deploys this directory (set Root Directory
# to apps/worker). Builds TypeScript, runs the claim→dispatch→complete loop.
# Required env: WORKER_SUPABASE_URL, WORKER_SERVICE_ROLE_KEY (service_role!).
#
# node:20-slim (Debian), NOT alpine: sharp ships glibc prebuilds and fails
# on musl. package-lock.json is committed, so `npm ci` is reproducible.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund && npm install -g typescript
COPY src ./src
RUN tsc -p tsconfig.json
CMD ["node", "dist/index.js"]
