# Balance-check worker: small Node image, no browser needed.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    HEARTBEAT_FILE=/tmp/worker-heartbeat

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src

# Run as the image's unprivileged user.
USER node

# Healthy while the poll loop is alive (heartbeat written every poll).
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD node -e "const t=+require('fs').readFileSync(process.env.HEARTBEAT_FILE,'utf8');process.exit(Date.now()-t<120000?0:1)"

CMD ["npx", "tsx", "src/index.ts"]
