#!/usr/bin/env sh
set -e

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

# 1. Run the pre-requisite checks first
echo "▶️ Running pre-requisite checks..."
sh scripts/check-device.sh
echo ""

# 2. Set environment variables to bypass tests and strict checks
export CI=false
export SKIP_PREFLIGHT_CHECK=true

# 3. Start the mock backend API (devices + jobs) in the background.
BACKEND_PORT=${BACKEND_PORT:-4000}
BACKEND_PID=""

stop_backend() {
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo ""
    echo "🛑 Stopping mock backend API (pid $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap stop_backend EXIT INT TERM

if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  node not found — skipping mock backend. Devices/jobs will use App.js fallbacks."
elif curl -s -o /dev/null "http://localhost:$BACKEND_PORT/health" 2>/dev/null; then
  echo "ℹ️ Mock backend already running on port $BACKEND_PORT — reusing it."
else
  echo "🗄️  Starting mock backend API on port $BACKEND_PORT..."
  PORT="$BACKEND_PORT" node server/index.js &
  BACKEND_PID=$!
fi

# Map the device's localhost:<port> to this machine so the app (which reads
# http://localhost:<port> from .env) can reach the backend over USB.
echo "🔁 Forwarding device localhost:$BACKEND_PORT → host (adb reverse)..."
sh scripts/with-android-env.sh adb reverse "tcp:$BACKEND_PORT" "tcp:$BACKEND_PORT" 2>/dev/null \
  || echo "⚠️  adb reverse failed — on a physical device, set the API URLs in .env to your LAN IP instead."
echo ""

echo "🚀 Starting the application on the connected device..."
echo "ℹ️ Note: Gradle builds in Expo already bypass tests (-x test -x lint) by default for debug builds."

# We use the existing with-android-env.sh to ensure the correct Java and Android SDK are used
# Using npx so it correctly locates the local expo binary in node_modules
sh scripts/with-android-env.sh npx expo run:android --port 8084
