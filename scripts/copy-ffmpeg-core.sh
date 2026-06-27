#!/usr/bin/env bash
set -euo pipefail

SRC="node_modules/@ffmpeg/core/dist/esm"
DST="public/ffmpeg-core"

mkdir -p "$DST"
cp "$SRC/ffmpeg-core.js" "$DST/"
cp "$SRC/ffmpeg-core.wasm" "$DST/"

echo "Copied ffmpeg-core files to $DST/"
