# server/Dockerfile
FROM rust:1.90-bookworm AS credentials-build
WORKDIR /build
COPY native/credentials ./native/credentials
RUN cargo build --release --manifest-path native/credentials/Cargo.toml

FROM node:22-bookworm-slim
WORKDIR /opt/chelys
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/package.json ./server/package.json
RUN npm install --prefix server --omit=dev --no-audit --no-fund
COPY . .
RUN npm run build:server:runtime
COPY --from=credentials-build /build/native/credentials/target/release/chelys-credentials /opt/chelys/server/bin/chelys-credentials
RUN chmod 0755 /opt/chelys/server/bin/chelys-credentials
ENV CHELYS_DATA_DIR=/var/lib/chelys
RUN mkdir -p /var/lib/chelys && chown -R node:node /var/lib/chelys /opt/chelys
USER node
VOLUME ["/var/lib/chelys"]
STOPSIGNAL SIGTERM
CMD ["node", "server/cli.mjs", "serve"]
