# WebDAV litmus — base WebDAV (RFC 4918) protocol tester.
# Installed from Debian's packaged build (no compiling neon ourselves).
FROM debian:bookworm-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends litmus diffutils \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /suite
# run.sh is provided via the bind mount (see docker-compose.yml).
CMD ["sh", "/suite/run.sh"]
