FROM node:22-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    openssh-client \
    gosu \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Doppler CLI
RUN curl -Ls https://cli.doppler.com/install.sh | sh

# Copy package files for production install
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled files and scripts
COPY --from=builder /app/dist ./dist
COPY scripts/ ./scripts/
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh scripts/ssh-host.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
