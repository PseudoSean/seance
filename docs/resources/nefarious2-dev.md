# Running nefarious2 locally for Seance development

Plan item 0.3a. Executed 2026-08-24: the Docker route below works and is what `tools/nefarious-dev/run.sh` automates.

## Which source to run

Seance needs the WebSocket + IRCv3.2 work, which is **not on `master`** — it is on the upstream branch `ircv3.2-upgrade` (see `nefarious2-websocket.md`). The local checkout at `/home/rubin/src/nefarious2` tracks `master` and has a small uncommitted typo-fix diff (`include/numeric.h`, `ircd/m_help.c`, `ircd/s_err.c`) plus an untracked `CLAUDE.md`; leave those alone. Fetch the branch into that checkout (or a separate worktree) when ready:

```sh
cd /home/rubin/src/nefarious2
git fetch origin ircv3.2-upgrade
git worktree add ../nefarious2-ircv3 origin/ircv3.2-upgrade
```

## Option A: Docker (recommended) — automated by `tools/nefarious-dev/run.sh`

The native build needs `librocksdb-dev` (a hard `configure` requirement on the branch) which is not installed here, so Docker is the path. The branch's `Dockerfile` is multi-stage, runs the cmocka unit tests during the build, and pulls a prebuilt `ghcr.io/evilnet/libkc:sha-10aa335` (the `latest` tag does not exist; the pinned one does).

```sh
# once (~5 min): the checkout in tmp/ is gitignored
git clone --branch ircv3.2-upgrade https://github.com/evilnet/nefarious2.git tmp/nefarious2
(cd tmp/nefarious2 && docker build -t nefarious2:ircv3 .)

# every time
tools/nefarious-dev/run.sh        # foreground, debug level 5, Ctrl-C to stop
tools/nefarious-dev/run.sh -d     # detached; docker logs -f nefarious-dev
```

What the script does:

- Bind-mounts `tools/nefarious-dev/ircd.conf` **over the image's own `ircd.conf`**. The image's file `include`s `linesync.conf` and `gitsync/gitsync.conf`; the latter is never created in a standalone container and a missing include is a fatal parse error (`ircd_lexer.l:366-371`). Ours includes only `base.conf` and `local.conf`.
- Bind-mounts `tools/nefarious-dev/local.conf` (test oper, plain WS port, features — see below).
- Generates `tmp/nefarious-dev/ircd.pem` once with a SAN for `localhost`/`127.0.0.1`/`irc.seance.test` so it can be trusted by a browser, and mounts it read-only.
- Publishes on 127.0.0.1 only: `6667` plain IRC, `6697` IRC/TLS, `8067` `ws://`, `8443` `wss://`. (`8080` was the original choice but another container on this host already owns it.)
- Sets `IRCD_GENERAL_NAME=irc.seance.test`, network name `SeanceDev`.

Gotchas found on first run:

- `Operator {}` blocks must carry `local = no;` (or `yes`) or the config fails with `... have no LOCAL setting`.
- **Plain `ws://` on 8067 does not work** — the ircd corrupts the HTTP handshake on non-TLS websocket ports (see `nefarious2-websocket.md`, "Prototype status"). Use `wss://localhost:8443/` and trust the cert, or `--insecure` from the probe.

How the container config is assembled (`tools/docker/dockerentrypoint.sh`, `tools/docker/ircd.conf`):

- `base.conf-dist` is templated with the `IRCD_*` env vars into `base.conf`. It already contains `General`, `Admin`, `Class` blocks (`Users` class has `usermode = "x"`, so everyone gets a cloaked host), an open `Client { ip = "*"; host = "*"; }` block, client ports `6667`, `7000`, `16667`, SSL `6697`, `9998`, server port `4497`, and a **WebSocket port `8443 ssl websocket`** (`tools/docker/base.conf-dist:122-127`). Its `Features {}` enables `CAP_draft_chathistory`, `CAP_draft_metadata_2`, `CHATHISTORY_PRIVATE`.
- The default `CMD` runs `ircd -n -x 5 -f ircd.conf` (foreground, debug level 5); every WebSocket frame shows up as `Debug((DEBUG_DEBUG, "WebSocket ..."))` lines, which is what we want while bringing up the client.

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
     local = no;
};

# Plain-text WebSocket for browser dev without cert hassle
Port {
     port = 8067;
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

- `websocket = yes` works on non-SSL ports as long as the ircd was **built** with OpenSSL (`websocket.c:438-441`). Use `ws://localhost:8067/` from `yarn dev` and skip certificate trust entirely. The path is ignored by the server.
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
| WS (plain)    | `ws://localhost:8067/` — **broken upstream**, see `nefarious2-websocket.md`                   |
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

Results 2026-08-24 (transcripts in `nefarious2-websocket.md`, "Prototype status"):

1. `node tools/irc-ws-probe.mjs ws://localhost:8067/ seance-probe` — **fails** (`Parse Error: Expected HTTP/`): ident/DNS notices precede the HTTP 101 on plain ports. Upstream bug.
2. `node tools/irc-ws-probe.mjs wss://localhost:8443/ seance-probe --insecure` — **works**: `CAP * LS` with the full cap set, then `001`.
3. `--binary` — not yet exercised on the TLS port.
4. 600-byte `PRIVMSG` in one frame over `wss://` — **disconnects** with `WebSocket frame error`; 400 bytes is fine. Confirms the 528-byte cap.
