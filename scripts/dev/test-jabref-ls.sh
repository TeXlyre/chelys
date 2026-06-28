#!/usr/bin/env bash
set -euo pipefail

WS_PORT="${WS_PORT:-7021}"
IMAGE="chelys/jabls:test"
CONTAINER="jabref-ls-test"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cat > "$workdir/Dockerfile" <<'DOCKERFILE'
FROM rust:1-slim AS proxy
RUN cargo install lsp-ws-proxy --locked --root /usr/local

FROM eclipse-temurin:21-jdk
RUN apt-get update && apt-get install -y curl socat && rm -rf /var/lib/apt/lists/*
RUN curl -Ls https://sh.jbang.dev | bash -s - app setup
ENV PATH="/root/.jbang/bin:${PATH}"
RUN jbang trust add https://raw.githubusercontent.com/JabRef/jabref/main/.jbang/
RUN jbang https://raw.githubusercontent.com/JabRef/jabref/main/.jbang/JabLsLauncher.java --help
COPY --from=proxy /usr/local/bin/lsp-ws-proxy /usr/local/bin/lsp-ws-proxy
RUN cat > /usr/local/bin/entrypoint.sh <<'SCRIPT' && chmod +x /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e
JABLS_PORT=2087
WS_PORT="${WS_PORT:-7021}"
jbang https://raw.githubusercontent.com/JabRef/jabref/main/.jbang/JabLsLauncher.java -p "$JABLS_PORT" &
while ! socat -T1 - TCP:127.0.0.1:"$JABLS_PORT" </dev/null >/dev/null 2>&1; do
  sleep 0.5
done
exec lsp-ws-proxy -l "0.0.0.0:$WS_PORT" -- socat STDIO "TCP:127.0.0.1:$JABLS_PORT"
SCRIPT
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
DOCKERFILE

echo ">> building $IMAGE"
docker build -t "$IMAGE" "$workdir"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo ">> running on ws://localhost:$WS_PORT (Ctrl+C to stop)"
docker run --rm --name "$CONTAINER" \
  -e WS_PORT="$WS_PORT" \
  -p "$WS_PORT:$WS_PORT" \
  "$IMAGE"
