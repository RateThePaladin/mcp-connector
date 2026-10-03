#!/usr/bin/env bash
set -e

# Create unprivileged user if not exists
PUID=${PUID:-99}
PGID=${PGID:-100}

if ! getent group abc >/dev/null; then
    groupadd -g "$PGID" abc
fi

if ! getent passwd abc >/dev/null; then
    useradd -u "$PUID" -g abc -d /config -s /bin/bash abc
fi

# Set permissions
mkdir -p /config
chown -R abc:abc /config /app

# Setup KNOWN_HOSTS
gosu abc bash -c '
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  if doppler secrets get KNOWN_HOSTS_B64 --plain | base64 -d > ~/.ssh/known_hosts 2>/dev/null; then
    chmod 600 ~/.ssh/known_hosts
  else
    echo "Warning: KNOWN_HOSTS_B64 secret not found or could not be written. SSH connections may fail."
  fi
'

# Execute the main process as the unprivileged user
exec gosu abc node dist/index.js
