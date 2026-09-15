# --- Rental Tracker image ---
# Node major-version tag (project policy: no :latest, no exact patch pin).
# The base image is refreshed whenever CI rebuilds, i.e. when a release is cut.
# There is deliberately no scheduled rebuild: republishing an existing version
# tag with different contents would break the guarantee that a pinned version
# is immutable, which is the whole point of pinning it in Ansible.
FROM node:24-alpine

# The version is stamped in at build time from the git tag that produced the
# image — never from a file anyone has to remember to edit. A local
# `docker build` with no arg says "dev", which is also the truth.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# App directory inside the container
WORKDIR /app

# No runtime npm deps (server uses only Node built-ins), but copy manifest
# first so the layer caches and `npm start` resolves.
COPY package.json ./

# Copy application code (server + public SPA, incl. vendored chart.umd.min.js)
COPY server.js ./
COPY public ./public

# Data is written here; mounted as a volume so it survives container rebuilds.
ENV DATA_DIR=/data
ENV PORT=8099
VOLUME ["/data"]

# Drop to the built-in non-root user for safety
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8099

# Reports SERVING, not merely running. `docker ps` shows (healthy) only once the
# HTTP layer actually answers — a container that booted but cannot read its data
# directory would otherwise look fine. Uses node itself: the image has no curl
# or wget, and adding one to get a healthcheck would be a poor trade.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8099)+'/api/data').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
