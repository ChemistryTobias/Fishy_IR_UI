#!/usr/bin/env sh
# -- serve the UI for local development (no build step, no backend needed)
PORT="${1:-8400}"
cd "$(dirname "$0")/ui"
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT"; fi
if command -v python  >/dev/null 2>&1; then exec python  -m http.server "$PORT"; fi
echo "need python (python3/python) or use: npx -y serve -l $PORT ." >&2
exit 1
