# Balance-check worker. The Playwright image ships Chromium and its system libraries;
# its version must match the "playwright" dependency in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Virtual display for assisted checks (a normal, visible Chrome; see CMD).
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HEARTBEAT_FILE=/tmp/worker-heartbeat \
    STATE_DIR=/app/state

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src

# Saved merchant sign-ins live here (a named volume), owned by the unprivileged user.
RUN mkdir -p /app/state && chown pwuser:pwuser /app/state && chmod 700 /app/state
USER pwuser

# Healthy while the poll loop is alive (heartbeat written every poll).
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD node -e "const t=+require('fs').readFileSync(process.env.HEARTBEAT_FILE,'utf8');process.exit(Date.now()-t<120000?0:1)"

# Assisted checks (Sport Chek) run a normal, visible Chrome on a virtual display, shown
# to you through the live view. Falls back to headless if the display tool is missing.
EXPOSE 8787
CMD ["sh", "-c", "if command -v xvfb-run >/dev/null && command -v xauth >/dev/null; then exec xvfb-run -a -s '-screen 0 1280x1024x24' npx tsx src/index.ts; else exec npx tsx src/index.ts; fi"]
