#!/bin/bash
# AikTube launcher
# Usage:
#   ./aiktube.sh        - start server and open browser
#   ./aiktube.sh stop   - stop the server

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=51847

if [ "$1" = "stop" ]; then
  PID=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PID" ]; then
    kill "$PID"
    echo "AikTube server stopped (port $PORT)"
  else
    echo "No active server on port $PORT"
  fi
  exit 0
fi

# Start
cd "$SCRIPT_DIR"

if /usr/sbin/lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Server already running on :$PORT"
else
  echo "Starting AikTube server..."
  /opt/homebrew/bin/node server.js &
  sleep 1
fi

echo "Opening Brave..."
open -a "Brave Browser" "http://localhost:$PORT/AikTube.html"
