#!/usr/bin/env sh
set -e

echo "🔍 Checking prerequisites..."

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

# 1. Check if ADB is available and Device is connected
echo "📱 Checking connected devices..."

# Using the existing environment wrapper to ensure adb is in PATH
ADB_OUTPUT=$(sh scripts/with-android-env.sh adb devices 2>/dev/null)
CONNECTED_DEVICES=$(echo "$ADB_OUTPUT" | grep -w "device")

if [ -z "$CONNECTED_DEVICES" ]; then
    echo "❌ ERROR: No authorized Android device or emulator is connected."
    echo "Please ensure:"
    echo "  1. Your device is plugged in via USB"
    echo "  2. USB Debugging is enabled in Developer Options"
    echo "  3. You have tapped 'Allow' on the USB debugging prompt on the device"
    exit 1
fi

echo "✅ Device connected:"
echo "$CONNECTED_DEVICES"

# 2. Check for .env file for Okta configurations
if [ ! -f ".env" ]; then
    echo "⚠️ WARNING: .env file not found. Authentication (Okta) might fail."
    echo "Please create a .env file from .env.example"
else
    echo "✅ .env file found."
fi

# 3. Check node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 node_modules not found. Please run 'npm install' first."
    exit 1
else
    echo "✅ node_modules found."
fi

echo "✨ All pre-requisite checks passed!"
