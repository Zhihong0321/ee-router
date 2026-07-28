#!/bin/sh
set -eu

storage_root="${AGY_HOME:-/storage}"
scratch_root="${AGY_SCRATCH_ROOT:-/tmp/agyproxy}"
diagnostics_root="${AGY_DIAGNOSTICS_ROOT:-$storage_root/agy-diagnostics}"

install -d -o node -g node -m 0700 \
  "$storage_root" \
  "$storage_root/.gemini" \
  "$storage_root/.gemini/antigravity-cli" \
  "$scratch_root" \
  "$diagnostics_root"

# Railway mounts volumes as root. Restore only the AGY profile ownership;
# provider and client-key configuration remains in PostgreSQL.
chown -R node:node "$storage_root/.gemini" "$diagnostics_root"

exec gosu node env HOME="$storage_root" "$@"
