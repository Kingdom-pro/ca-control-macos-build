#!/bin/sh
set -eu

project="$(cd "$(dirname "$0")/.." && pwd -P)"
work="$(mktemp -d)"
test_binary="$work/filter-policy-test"
trap 'rm -f "$test_binary"; rmdir "$work"' EXIT

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror \
  "$project/native/filter/policy.c" "$project/tests/filter-policy.test.c" -o "$test_binary"
"$test_binary"

if [ "$(uname -s)" = Darwin ]; then
  for arch in arm64 x86_64; do
    /usr/bin/xcrun clang -arch "$arch" -mmacosx-version-min=12.0 -fobjc-arc -fblocks \
      -Werror=unguarded-availability -fsyntax-only "$project/native/filter/CAFilterProvider.m"
    printf 'PASS Network Extension source (%s)\n' "$arch"
  done
fi
