#!/usr/bin/env bash

set -u

for attempt in 1 2 3; do
  if npm ci \
    --fetch-retries=5 \
    --fetch-retry-factor=2 \
    --fetch-retry-mintimeout=1000 \
    --fetch-retry-maxtimeout=120000; then
    exit 0
  fi

  if [ "$attempt" -lt 3 ]; then
    echo "npm ci failed; retrying (attempt $((attempt + 1))/3)" >&2
    sleep $((attempt * 10))
  fi
done

echo "npm ci failed after 3 attempts" >&2
exit 1
