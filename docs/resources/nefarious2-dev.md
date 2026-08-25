# Running nefarious2 locally for Seance development

Plan item 0.3a. Practical notes only; nothing here has been executed yet (no ircd was built as part of phase 0).

## Which source to run

Seance needs the WebSocket + IRCv3.2 work, which is **not on `master`** — it is on the upstream branch `ircv3.2-upgrade` (see `nefarious2-websocket.md`). The local checkout at `/home/rubin/src/nefarious2` tracks `master` and has a small uncommitted typo-fix diff (`include/numeric.h`, `ircd/m_help.c`, `ircd/s_err.c`) plus an untracked `CLAUDE.md`; leave those alone. Fetch the branch into that checkout (or a separate worktree) when ready:

```sh
cd /home/rubin/src/nefarious2
git fetch origin ircv3.2-upgrade
git worktree add ../nefarious2-ircv3 origin/ircv3.2-upgrade
```

## Option A: Docker (recommended)

Both branches ship a `Dockerfile` and `tools/docker/`. The `ircv3.2-upgrade` one is multi-stage, runs the unit tests during build, and needs `librocksdb-dev`, `libzstd-dev`, `libcmocka-dev` and a prebuilt `ghcr.io/evilnet/libkc` image (all handled inside the Dockerfile; override with `--build-arg LIBKC_IMAGE=...` if GHCR is unreachable). A published image `ghcr.io/evilnet/nefarious2:latest` is referenced by `docker-compose.yml-example` on the branch; check which ref it was built from before trusting it to have WebSocket support.

```sh
cd /home/rubin/src/nefarious2-ircv3          # branch worktree
docker build -t nefarious2:ircv3 .
docker run --rm -it \
  -p 6667:6667 -p 6697:6697 -p 8443:8443 \
  -e IRCD_GENERAL_NAME=irc.seance.test \
  -e IRCD_GENERAL_DESCRIPTION="Seance dev" \
  -e IRCD_GENERAL_NUMERIC=1 \
  -v "$PWD/dev/local.conf:/home/nefarious/ircd/local.conf" \
  -v "$PWD/dev/ircd.pem:/home/nefarious/ircd/ircd.pem" \
  nefarious2:ircv3
```

How the container config is assembled (`tools/docker/dockerentrypoint.sh`, `tools/docker/ircd.conf`):

- `base.conf-dist` is templated with the `IRCD_*` env vars into `base.conf`. It already contains `General`, `Admin`, `Class` blocks (`Users` class has `usermode = "x"`, so everyone gets a cloaked host), an open `Client { ip = "*"; host = "*"; }` block, client ports `6667`, `7000`, `16667`, SSL `6697`, `9998`, server port `4497`, and on the branch a **WebSocket port `8443 ssl websocket`** (`tools/docker/base.conf-dist:122-127`). The branch's `Features {}` enables `CAP_draft_chathistory`, `CAP_draft_metadata_2`, `CHATHISTORY_PRIVATE`.
- `ircd.conf` just `include`s `base.conf`, `local.conf` and `linesync.conf` (the branch also includes `gitsync/gitsync.conf` and ships an alternative `ircd-docker.conf`). **Put your additions in `local.conf`** and bind-mount it.
- If `ircd.pem` is missing the entrypoint generates a self-signed cert with `openssl req -x509 -days 365 -newkey rsa:4096 -subj /CN=$IRCD_GENERAL_NAME/`. Bind-mount a file so it persists across container restarts.
- The default `CMD` runs `ircd -n -x 9` on master and `ircd -n -x 5 -f ircd.conf` on the branch (foreground, debug level 9/5) — noisy but shows every WebSocket frame (`Debug((DEBUG_DEBUG, "WebSocket ..."))` lines in `s_bsd.c`), which is exactly what we want while bringing up the client.

## Option B: native build

Prereqs (Debian/Ubuntu): `build-essential libssl-dev autoconf automake flex byacc gawk`, and for the branch also `librocksdb-dev libzstd-dev libcmocka-dev libmaxminddb-dev pkg-config` plus libkc (Keycloak SASL; `--enable-keycloak` is optional, skip it locally).

```sh
cd /home/rubin/src/nefarious2-ircv3
autoreconf -fi
./configure --prefix=$HOME/nefarious-dev --enable-debug --with-maxcon=1024 \
            --with-rocksdb=/usr --with-zstd=/usr
make -j"$(nproc)"
make install                      # binaries to ~/nefarious-dev/bin, lib dir ~/nefarious-dev/lib
cp doc/example.conf ~/nefarious-dev/lib/ircd.conf   # then trim; see below
tools/makepem/makepem ~/nefarious-dev/lib            # or the openssl one-liner above -> ircd.pem
~/nefarious-dev/bin/ircd -n -x 9 -f ~/nefarious-dev/lib/ircd.conf
```

`ircd` must not run as root; `-n` keeps it in the foreground. `doc/example.conf` is 1000+ lines; the docker `base.conf-dist` is a much better starting point for a single-server dev box.

## Minimal `local.conf` additions for Seance

```
# Test operator (password "seance"). $PLAIN$ is the unhashed form used in doc/example.conf;
# for a hashed one run `ircd/umkpasswd -m native seance` (`-l` lists mechanisms).
Operator {
     name = "seanceop";
     host = "*@*";
     password = "$PLAIN$seance";
     class = "Opers";
};

# Plain-text WebSocket for browser dev without cert hassle
Port {
     port = 8080;
     websocket = yes;
};

Features {
     "NETWORK" = "SeanceDev";
     "HIDDEN_HOST" = "users.seance.test";
     # Allow any Origin while developing (the default); tighten later:
     # "WEBSOCKET_ORIGIN" = "http://localhost:9000 https://app.seance.test";
     "CAP_draft_event_playback" = "TRUE";      # off by default on the branch
     "CHATHISTORY_REQUIRE_AUTH" = "FALSE";     # let unauthenticated dev clients pull history
};
```

Notes:

- `websocket = yes` works on non-SSL ports as long as the ircd was **built** with OpenSSL (`websocket.c:438-441`). Use `ws://localhost:8080/` from `yarn dev` and skip certificate trust entirely. The path is ignored by the server.
- `Port { ... ssl = yes; websocket = yes; }` is what production looks like; test it too, see TLS below.
- Password hashing: `ircd/umkpasswd` builds alongside `ircd` (`umkpasswd -l` lists mechanisms, `-m native <password>` produces the default hashed form). `$PLAIN$<password>` is accepted as-is, per `doc/example.conf:846`.
- No services (X3) means no SASL, no account login, no `+r`. That is acceptable for phase 0/C; `~/src/x3` exists locally if account-tag/chathistory-auth paths need exercising later.

## Suggested test identities

| Thing         | Value                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| Server name   | `irc.seance.test`                                                                             |
| Network (005) | `SeanceDev`                                                                                   |
| Test nick     | `seance1` (`seance2` for a second tab; the probe defaults to `seance-probe`)                  |
| Test channel  | `#seance`                                                                                     |
| Oper          | `seanceop` / `seance`                                                                         |
| WS (plain)    | `ws://localhost:8080/`                                                                        |
| WS (TLS)      | `wss://localhost:8443/`                                                                       |
| Legacy TCP    | `localhost:6667` (for cross-checking with a normal client such as hexchat in `~/src/hexchat`) |

## TLS expectations for `wss://`

- The ircd's `ircd.pem` is a self-signed cert with `CN=<IRCD_GENERAL_NAME>` and no SAN. Modern browsers reject certs without a SAN outright, so for `wss://localhost:8443/` generate a proper dev cert instead of relying on the entrypoint's one-liner:

  ```sh
  mkcert -install                       # once; installs a local CA in the browser trust store
  mkcert -cert-file ircd.crt -key-file ircd.key localhost 127.0.0.1 ::1 irc.seance.test
  cat ircd.crt ircd.key > ircd.pem      # nefarious reads cert+key from one PEM via SSL_CERTFILE
  ```

  or with plain openssl, add `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"` and import the cert into the browser/OS trust store manually.

- A browser will not show a cert-error interstitial for a WebSocket; a rejected cert just surfaces as a generic `close` (code 1006) with nothing useful in the console. Open `https://localhost:8443/` in a tab first: the ircd will answer with a WebSocket-handshake failure and drop the connection, but the browser will have shown (and let you accept) the certificate along the way.
- `node tools/irc-ws-probe.mjs wss://localhost:8443/ seance-probe --insecure` skips verification for CLI testing.
- In production the cert is a real one (`tools/letsencrypt/` in the ircd repo has a renewal hook) and `WEBSOCKET_ORIGIN` should list the web app's origin.

## Sanity checklist once it is running

1. `node tools/irc-ws-probe.mjs ws://localhost:8080/ seance-probe` — expect `CAP * LS` lines listing `message-tags server-time batch labeled-response draft/chathistory=...`, then `001`. Paste the transcript into `nefarious2-websocket.md`.
2. Same over `wss://localhost:8443/` with `--insecure`.
3. `--binary` variant: server should echo `Sec-WebSocket-Protocol: binary.ircv3.net` (visible as `-- open (subprotocol: binary.ircv3.net)`).
4. Send a 600-byte PRIVMSG from the probe and confirm the 527-byte inbound frame issue described in `nefarious2-websocket.md` (expect disconnect `WebSocket frame error`) so the bug report to upstream is reproducible.
