#!/bin/sh
set -eu

if [ "$(uname -s)" != Darwin ] || [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || true)" != 1 ]; then
  printf '%s\n' 'Для этого стенда нужен Mac с Apple Silicon.' >&2
  exit 1
fi
if ! command -v tart >/dev/null 2>&1; then
  printf '%s\n' 'Установите Tart командой brew install openai/tools/tart.' >&2
  exit 1
fi

source_dir="$(cd "$(dirname "$0")/.." && pwd -P)"
vm='CA-Control-Lab'
if ! tart get "$vm" >/dev/null 2>&1; then
  tart create "$vm" --from-ipsw latest --disk-size 80
fi

exec tart run "$vm" --dir="ca-control:$source_dir:ro"
