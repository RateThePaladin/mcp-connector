#!/usr/bin/env bash
set -e

# Create unprivileged user if not exists
PUID=${PUID:-99}
PGID=${PGID:-100}

if ! getent group "$PGID" >/dev/null; then
    groupadd -g "$PGID" abc
fi

if ! getent passwd abc >/dev/null; then
    useradd -o -u "$PUID" -g "$PGID" -d /config -s /bin/bash abc
fi

# Set permissions
mkdir -p /config
chown -R abc:"$PGID" /config /app

# Setup default known_hosts if needed
gosu abc bash -c '
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  touch ~/.ssh/known_hosts && chmod 600 ~/.ssh/known_hosts
'

# Execute the main process as the unprivileged user
exec gosu abc doppler run -- node dist/index.js
