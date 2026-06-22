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

echo "🚀 Starting the application on the connected device..."
echo "ℹ️ Note: Gradle builds in Expo already bypass tests (-x test -x lint) by default for debug builds."

# We use the existing with-android-env.sh to ensure the correct Java and Android SDK are used
# Using npx so it correctly locates the local expo binary in node_modules
sh scripts/with-android-env.sh npx expo run:android --port 8084
