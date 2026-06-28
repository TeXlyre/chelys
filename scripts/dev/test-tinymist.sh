#!/usr/bin/env bash
set -euo pipefail

WS_PORT="${WS_PORT:-7030}"
IMAGE="texlyre/tinymist:test"
CONTAINER="tinymist-test"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cat > "$workdir/Dockerfile" <<'DOCKERFILE'
FROM rust:1-slim AS build
RUN apt-get update && apt-get install -y git pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
RUN cargo install lsp-ws-proxy --locked --root /usr/local
RUN cargo install --git https://github.com/Myriad-Dreamin/tinymist --locked --root /usr/local tinymist-cli

FROM debian:stable-slim
RUN apt-get update && apt-get install -y fonts-dejavu fonts-liberation && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/lsp-ws-proxy /usr/local/bin/lsp-ws-proxy
COPY --from=build /usr/local/bin/tinymist /usr/local/bin/tinymist
RUN mkdir -p /workspace
WORKDIR /workspace
RUN cat > /usr/local/bin/entrypoint.sh <<'SCRIPT' && chmod +x /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e
WS_PORT="${WS_PORT:-7030}"
cd /workspace
exec env RUST_LOG=error lsp-ws-proxy -l "0.0.0.0:$WS_PORT" -- \
  tinymist lsp
SCRIPT
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
DOCKERFILE

echo ">> building $IMAGE (first build compiles tinymist from source, this takes a while)"
docker build -t "$IMAGE" "$workdir"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo ">> running on ws://localhost:$WS_PORT (Ctrl+C to stop)"
docker run --rm --name "$CONTAINER" \
  -e WS_PORT="$WS_PORT" \
  -p "$WS_PORT:$WS_PORT" \
  "$IMAGE"
