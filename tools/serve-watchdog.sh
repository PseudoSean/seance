#!/bin/sh
# Keep the HTTPS+WSS host (tools/serve.py) alive. One instance only: the
# pidfile guard makes a second launch a no-op, which matters because the
# container's process hygiene has repeatedly respawned or reaped these.
PIDFILE=/tmp/serve-8000.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
	exit 0
fi
echo $$ > "$PIDFILE"
while true; do
	python3 -X faulthandler /seance/tools/serve.py \
		--port 8000 --san 10.0.0.41 --verbose >> /tmp/serve-8000.log 2>&1
	echo "$(date -u +%H:%M:%S) server exited rc=$? — restarting" >> /tmp/serve-8000.log
	sleep 1
done
