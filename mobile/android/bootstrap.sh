#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v gradle >/dev/null 2>&1 || { echo 'Install Gradle 9.5.0 and JDK 17, or generate the Gradle wrapper with Android Studio.'; exit 1; }
gradle wrapper --gradle-version 9.5.0 --distribution-type bin
./gradlew assembleDebug
