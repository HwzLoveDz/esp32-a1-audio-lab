#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
task_build=$(mktemp -d)
trap 'rm -rf -- "$task_build"' EXIT HUP INT TERM
compiler=${CC:-cc}
sanitizers=
if [ "${SANITIZE:-0}" = 1 ]; then sanitizers="-fsanitize=address,undefined -fno-omit-frame-pointer"; fi
"$compiler" $sanitizers -std=c11 -g -O1 -pthread -Wall -Wextra -Werror \
  -Itests/firmware-host -Ifirmware/bridge -Dfwrite=a1_test_fwrite \
  -c firmware/bridge/a1_recording.c -o "$task_build/recording.o"
"$compiler" $sanitizers -std=c11 -g -O1 -pthread -Wall -Wextra -Werror \
  -Itests/firmware-host -Ifirmware/bridge tests/firmware-host/recording_test.c \
  "$task_build/recording.o" -o "$task_build/recording-test"
"$task_build/recording-test"
