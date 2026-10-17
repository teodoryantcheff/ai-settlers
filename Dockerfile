# Local development environment: Node 22.18 (as CI) plus python3 for `npm run dev`.
# compose.yaml mounts the checkout; dependencies live in a Linux-only volume.
FROM node:22.18
WORKDIR /app
# Pre-create the volume mount point so the node_modules volume is writable by `node`.
RUN mkdir -p /app/node_modules && chown -R node:node /app
USER node
