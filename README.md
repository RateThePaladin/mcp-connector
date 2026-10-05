# MCP SSH Server

A production-grade TypeScript MCP server that securely executes arbitrary commands on remote hosts via SSH.

## Security Architecture
This project is designed to operate securely on a local network (LAN) behind an Nginx TLS reverse proxy.
Authentication is handled natively through Google Identity Services (GSI) via a sleek authentication portal.

### Generating an API Key
When the container is running, navigate to its exposed web UI (e.g., `http://localhost:3000/login` or your reverse proxy domain) in your browser. 
Log in securely with your Google Account. If your email matches the `ALLOWED_GOOGLE_EMAILS` whitelist defined in Doppler, the server will instantly mint a long-lived JWT API Key. 

Your MCP clients must then pass this exact string in their `Authorization: Bearer <key>` headers.

### Secure SSH Execution
SSH private keys are managed dynamically via Doppler. Instead of loading keys into Node.js, this app blindly executes a wrapper script (`scripts/ssh-host.sh`). The wrapper starts an isolated `ssh-agent`, securely fetches the required key from Doppler into RAM, and automatically cleans up upon exit using bash traps.

## Setup
1. `npm install`
2. `npm run build`
3. Configure your local Doppler project: `doppler setup`

### Doppler Secret Configuration
This server strictly relies on a file-less runtime. Private keys and connection details are never saved to disk. To enable connections to a host, you must define the following three variables in your Doppler dashboard, matching your `host` identifier. 

To connect to an SSH host (for example, with the identifier `app-server`), define:
- `APP-SERVER_USER`: The SSH username (e.g., `root`)
- `APP-SERVER_HOST`: The IP Address or Hostname (e.g., `10.0.0.50`)
- `APP-SERVER_KEY`: The raw RSA/ED25519 private key contents

To prevent unauthorized execution, you must define the `ALLOWED_SSH_HOSTS` variable in Doppler as a comma-separated whitelist of host identifiers (e.g., `app-server,db-server,backup`).

### Application API Proxy
The MCP Server also natively supports the `application_api_request` tool, which acts as a secure reverse-proxy for making API requests to internal services without exposing credentials directly to the AI agent.

Variables must follow the strict naming convention: `<HOST>_<APP>_<SECRET_TYPE>`

For static API key authentication (e.g., typical media stacks), set:
- `HOST_APP_URL`: Base URL (e.g., `http://10.0.0.60:8080`) -> **Note: Do NOT include a trailing slash!**
- `HOST_APP_API_KEY`: The static API Key

For stateful applications requiring session logins (e.g., download clients, Nginx proxies), set:
- `HOST_APP_URL`: Base URL (e.g., `http://10.0.0.60:8181`) -> **Note: Do NOT include a trailing slash!**
- `HOST_APP_USERNAME`: The web UI username
- `HOST_APP_PASSWORD`: The web UI password

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
