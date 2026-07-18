#!/usr/bin/env bash
set -e
source ~/.nvm/nvm.sh
nvm use 22
node scripts/memory-profile.mjs "$@"
