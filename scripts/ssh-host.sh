#!/usr/bin/env bash
set -e

HOST_IDENTIFIER="$1"
# Read command from stdin to hide it from process lists (ps aux)
COMMAND=$(cat)

if [[ ! "$HOST_IDENTIFIER" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Invalid host identifier" >&2
  exit 1
fi

# Convert to uppercase prefix
HOST_PREFIX=$(echo "$HOST_IDENTIFIER" | tr '[:lower:]' '[:upper:]')

# Fetch connection details directly from Doppler
# Using || true so that set -e doesn't kill the script if Doppler fails
TARGET_USER=$(doppler secrets get "${HOST_PREFIX}_USER" --plain 2>/dev/null || true)
TARGET_HOST=$(doppler secrets get "${HOST_PREFIX}_HOST" --plain 2>/dev/null || true)

if [ -z "$TARGET_USER" ] || [ -z "$TARGET_HOST" ]; then
  echo "ERROR: Missing Doppler Configuration" >&2
  echo "The connection details for the requested host identifier could not be found." >&2
  echo "INSTRUCTIONS: Please tell the user to create the required secrets in their Doppler dashboard. They must follow the format <HOST>_USER and <HOST>_HOST (e.g., if the host identifier is 'node', the secrets must be 'NODE_USER' and 'NODE_HOST')." >&2
  exit 1
fi

# Start isolated ssh-agent
eval $(ssh-agent -s) > /dev/null
trap 'kill $SSH_AGENT_PID >/dev/null 2>&1 || true; rm -f /tmp/ssh_err_$$' EXIT

# Securely load the key into ssh-agent from Doppler with a 60-second lifetime
if ! doppler secrets get "${HOST_PREFIX}_KEY" --plain 2>/dev/null | ssh-add -t 60 - > /dev/null 2>&1; then
  echo "ERROR: Missing or Invalid SSH Key" >&2
  echo "Could not load the private key for the requested host from Doppler." >&2
  echo "INSTRUCTIONS: Please tell the user to verify the raw private key exists in Doppler under the format <HOST>_KEY." >&2
  exit 1
fi

# Execute command using the resolved user and host
# We disable set -e temporarily to manually handle and parse SSH failures
set +e
ssh -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile=~/.ssh/known_hosts \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    "${TARGET_USER}@${TARGET_HOST}" "$COMMAND" 2> /tmp/ssh_err_$$
EXIT_CODE=$?
set -e

# Parse custom error messages if SSH fails
if [ $EXIT_CODE -ne 0 ]; then
  ERR_OUTPUT=$(cat /tmp/ssh_err_$$)
  
  # Scrub sensitive data from raw SSH output before returning to agent/logs
  SAFE_ERR_OUTPUT=$(echo "$ERR_OUTPUT" | sed -e "s/${TARGET_HOST}/<REDACTED_HOST>/g" -e "s/${TARGET_USER}/<REDACTED_USER>/g")

  if echo "$ERR_OUTPUT" | grep -qi "Host key verification failed"; then
    echo "ERROR: Host Key Verification Failed." >&2
    echo "The host's fingerprint is missing or has changed." >&2
    echo "INSTRUCTIONS: Please tell the user they must add the host's public key fingerprint to the 'KNOWN_HOSTS' secret in Doppler." >&2
  elif echo "$ERR_OUTPUT" | grep -qi "Permission denied"; then
    echo "ERROR: Permission Denied." >&2
    echo "The private key was rejected by the server." >&2
    echo "INSTRUCTIONS: Please tell the user to verify the <HOST>_KEY and <HOST>_USER values in Doppler." >&2
  elif echo "$ERR_OUTPUT" | grep -qi "Connection timed out"; then
    echo "ERROR: Connection Timed Out." >&2
    echo "Could not reach the target host within 10 seconds." >&2
  else
    echo "ERROR: SSH Command Failed (Exit Code $EXIT_CODE)" >&2
    echo "$SAFE_ERR_OUTPUT" >&2
  fi
  exit $EXIT_CODE
fi
