# MCP SSH Server

A production-grade TypeScript MCP server that securely executes arbitrary commands on remote hosts via SSH.

## Security Architecture
This project is designed to operate securely on a local network (LAN) behind an Nginx TLS reverse proxy.
Authentication is handled via a static API key passed as a Bearer token (`MCP_API_KEY`).

### Generating an API Key
To generate a secure API key on your terminal (Mac/Linux), run:
```bash
openssl rand -hex 32
```
Save this key as the `MCP_API_KEY` secret in your Doppler dashboard. Your MCP clients must then pass this exact string in their `Authorization: Bearer <key>` headers.

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

To prevent Man-in-the-Middle (MITM) attacks, you must also define a `KNOWN_HOSTS_B64` secret containing the base64-encoded public key fingerprints of all your target servers.

### Generating KNOWN_HOSTS_B64
Here is how to generate this safely on your local machine (Linux/Mac):

1. **Scan your target hosts** and save their fingerprints to a file:
   ```bash
   ssh-keyscan -H 192.168.1.50 > my_known_hosts
   ssh-keyscan -H 192.168.1.51 >> my_known_hosts # use >> to append additional hosts
   ```
2. **Convert the file to a single Base64 string**:
   ```bash
   cat my_known_hosts | base64 | tr -d '\n'
   ```
3. Copy the exact output string and paste it into your Doppler dashboard as the `KNOWN_HOSTS_B64` secret.

## Deployment

Ensure the container runs behind an Nginx reverse proxy providing HTTPS to encrypt the SSE MCP traffic.

### Unraid
Use the provided `unraid-template.xml` to deploy via Docker to your Unraid host. The template configures the necessary volume mounts and prompts for the `DOPPLER_TOKEN`.

### Linux (Ubuntu)
For a standard Linux host, use Docker Compose. First, copy the example environment file:
```bash
cp .env.example .env
```
Edit the `.env` file to include your `DOPPLER_TOKEN`. Then, start the container:
```bash
docker compose up -d
```

## AI Use Disclaimer
> **Notice**: This project, its architecture, and its source code were generated with the assistance of an AI coding agent. While the architecture is designed with security best practices in mind (such as file-less SSH key injection and strict API key validation), you should independently review and verify all security-critical components before using this in a production environment.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
