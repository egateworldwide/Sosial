# Ephemeral TikTok photo host — Railway deploys this directory (Root Directory:
# apps/tiktok-photo-host). node:20-slim (Debian), NOT alpine: sharp ships glibc
# prebuilds and fails on musl. package-lock.json is committed, so npm ci is
# reproducible.
#
# Required env: BASE_URL, UPLOAD_KEY. Recommended: DATA_DIR=/data on a volume,
# TTL_HOURS=24. Railway injects PORT.
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
EXPOSE 3000
CMD ["node", "server.js"]
