# Sosial publish worker — Railway deploys this directory (set Root Directory
# to apps/worker). Builds TypeScript, runs the claim→dispatch→complete loop.
# Required env: WORKER_SUPABASE_URL, WORKER_SERVICE_ROLE_KEY (service_role!).
FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
# No runtime deps by design; typescript only for the build step.
RUN npm install --no-audit --no-fund && npm install -g typescript
COPY src ./src
RUN tsc -p tsconfig.json
CMD ["node", "dist/index.js"]
