#!/bin/bash
# Installs dependencies when the lockfile changes, serves the checkout on port 7313 and
# rebuilds the bundles whenever src/ changes. Reload the browser to pick up a rebuild.
# Everything the container prints (installs, typecheck, builds, request lines with status
# codes and redirects) is also appended unmodified to output/all-as-it-is.bin, a local
# development log that git ignores and release packaging never includes.
set -euo pipefail

mkdir -p output
exec > >(tee -a output/all-as-it-is.bin) 2>&1
# Stop the server, watcher and log writer together when the container stops.
trap 'trap - TERM INT; kill 0' TERM INT

stamp=node_modules/.package-lock.sha256
current=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ "$(cat "$stamp" 2>/dev/null)" != "$current" ]; then
  npm ci --no-audit --no-fund
  echo "$current" > "$stamp"
fi

npm run typecheck
# -u: request lines reach the log as they happen.
python3 -u -m http.server 7313 --bind 0.0.0.0 &
echo "Serving the checkout on container port 7313; rebuilding on src/ changes."
# index.html is not watched: build.mjs rewrites it, which would retrigger the build.
node --watch-path=src scripts/build.mjs &
wait
