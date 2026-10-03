# MCP SSH Server

A production-grade TypeScript MCP server that securely executes arbitrary commands on remote hosts via SSH.

## Security Architecture
This project is designed to operate securely on a local network (LAN) behind an Nginx TLS reverse proxy.
Authentication is handled via Google OIDC tokens, and strictly verified against an `ALLOWED_EMAILS` allowlist.

SSH private keys are managed dynamically via Doppler. Instead of loading keys into Node.js, this app blindly executes a wrapper script (`scripts/ssh-host.sh`). The wrapper starts an isolated `ssh-agent`, securely fetches the required key from Doppler into RAM, and automatically cleans up upon exit using bash traps.

## Setup
1. `npm install`
2. `npm run build`
3. Configure your local Doppler project: `doppler setup`

### Doppler Secret Configuration
This server strictly relies on a file-less runtime. Private keys and connection details are never saved to disk. To enable connections to a host, you must define the following three variables in your Doppler dashboard, matching your `host` identifier. 

For example, to connect to the identifier `node`, define:
- `NODE_USER`: The SSH username (e.g., `root`)
- `NODE_HOST`: The IP Address or Hostname (e.g., `192.168.1.50`)
- `NODE_KEY`: The raw RSA/ED25519 private key contents

To prevent Man-in-the-Middle (MITM) attacks, you must also define a `KNOWN_HOSTS` secret containing the public key fingerprints of all your target servers.

## Deployment
Use the provided `unraid-template.xml` to deploy via Docker to your Unraid host.
Ensure the container runs behind an Nginx reverse proxy providing HTTPS to encrypt the SSE MCP traffic.

## AI Use Disclaimer
> **Notice**: This project, its architecture, and its source code were generated with the assistance of an AI coding agent. While the architecture is designed with security best practices in mind (such as file-less SSH key injection and strict OIDC validation), you should independently review and verify all security-critical components before using this in a production environment.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
