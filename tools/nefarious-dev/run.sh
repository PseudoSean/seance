#!/bin/sh
# Run a nefarious2 (ircv3.2-upgrade branch) dev server in Docker for Seance.
#
#   tools/nefarious-dev/run.sh            # foreground, debug level 5
#   tools/nefarious-dev/run.sh -d         # detached (docker logs -f nefarious-dev)
#
# Image: one build of stock ircv3.2-upgrade, no patch needed — the WebSocket
# fixes (#97/#98/#99) and the client-cert/ALPN follow-up were merged upstream on
# 2026-08-28 (PR #101).  nefarious2:ircv3-fixed is only an alias tag for that
# same image, kept so older instructions and NEFARIOUS_IMAGE settings keep
# working.  Override with NEFARIOUS_IMAGE=<tag>.
#
# Build it first:
#   git clone --branch ircv3.2-upgrade https://github.com/evilnet/nefarious2.git tmp/nefarious2
#   (cd tmp/nefarious2 && docker build -t nefarious2:ircv3 .)
#   docker tag nefarious2:ircv3 nefarious2:ircv3-fixed
#
# Ports: 6667 plain IRC, 6697 IRC over TLS, 8067 ws://, 8443 wss://
set -e
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
STATE="$ROOT/tmp/nefarious-dev"
mkdir -p "$STATE"

# Self-signed cert with a SAN so browsers can be told to trust wss://localhost:8443
if [ ! -f "$STATE/ircd.pem" ]; then
	openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
		-keyout "$STATE/ircd.key" -out "$STATE/ircd.crt" \
		-subj "/CN=irc.seance.test" \
		-addext "subjectAltName=DNS:localhost,DNS:irc.seance.test,IP:127.0.0.1,IP:::1" \
		>/dev/null 2>&1
	cat "$STATE/ircd.crt" "$STATE/ircd.key" >"$STATE/ircd.pem"
	rm "$STATE/ircd.key"
	chmod 644 "$STATE/ircd.pem"
fi

DETACH=""
[ "$1" = "-d" ] && DETACH="-d"

docker rm -f nefarious-dev >/dev/null 2>&1 || true
exec docker run --rm $DETACH --name nefarious-dev \
	-p 127.0.0.1:6667:6667 -p 127.0.0.1:6697:6697 \
	-p 127.0.0.1:8067:8067 -p 127.0.0.1:8443:8443 -p 127.0.0.1:8444:8444 \
	-e IRCD_GENERAL_NAME=irc.seance.test \
	-e IRCD_GENERAL_DESCRIPTION="Seance dev" \
	-e IRCD_GENERAL_NUMERIC=1 \
	-e IRCD_ADMIN_LOCATION="localhost" \
	-e IRCD_ADMIN_CONTACT="rubin@afternet.org" \
	-v "$ROOT/tools/nefarious-dev/ircd.conf:/home/nefarious/ircd/ircd.conf:ro" \
	-v "$ROOT/tools/nefarious-dev/local.conf:/home/nefarious/ircd/local.conf:ro" \
	-v "$STATE/ircd.pem:/home/nefarious/ircd/ircd.pem:ro" \
	"${NEFARIOUS_IMAGE:-nefarious2:ircv3-fixed}"
