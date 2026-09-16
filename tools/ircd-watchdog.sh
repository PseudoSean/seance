#!/bin/sh
# Keep the native nefarious2 ircd alive (SASL via tools/iauth-agent.py,
# WebSocket on 8067 behind tools/serve.py's TLS proxy). One instance only.
PIDFILE=/tmp/ircd-6667.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
	exit 0
fi
echo $$ > "$PIDFILE"
WORKDIR=/seance/tmp/nefarious-dev
while true; do
	cd /seance/tmp/nefarious2/ircd
	./ircd -n -x 5 -f "$WORKDIR/ircd.conf" -d "$WORKDIR" >> /tmp/ircd.log 2>&1
	echo "$(date -u +%H:%M:%S) ircd exited rc=$? — restarting" >> /tmp/ircd.log
	sleep 1
done
