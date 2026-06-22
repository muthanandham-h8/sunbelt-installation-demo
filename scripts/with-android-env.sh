#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

export JAVA_HOME="$ROOT_DIR/.toolchains/jdk17"
export ANDROID_HOME="$ROOT_DIR/.toolchains/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="$ROOT_DIR/.toolchains/gradle"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

mkdir -p "$GRADLE_USER_HOME"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "Missing Java at $JAVA_HOME/bin/java" >&2
  exit 1
fi

if [ ! -d "$ANDROID_HOME/platforms" ]; then
  echo "Missing Android SDK platforms at $ANDROID_HOME/platforms" >&2
  exit 1
fi

exec "$@"
