# Install

## From a checkout

```bash
cd app.web
node server.js        # → http://localhost:8099
```

Needs Node 18 or newer. A local `data/` directory is created next to `server.js` on first run; it
is git-ignored and is a real ledger once you use it.

## With Docker

```bash
docker run -d --name rental-tracker \
  -p 127.0.0.1:8099:8099 \
  -v /path/to/data:/data \
  -e TZ=Europe/London \
  --restart unless-stopped \
  ghcr.io/horia-delicoti/rental-tracker:1
```

Images are published to `ghcr.io/horia-delicoti/rental-tracker` for `linux/amd64` and `linux/arm64`
when a `v*` tag is pushed, tagged `1.2.3`, `1.2` and `1`. There is deliberately no `latest` tag:
pin the exact version you mean to run, so an upgrade is a decision and a rollback is the same
decision in reverse.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8099` | the port the server listens on |
| `DATA_DIR` | `./data` (`/data` in the image) | where `data.json` and `backups/` live |
| `TZ` | container default | affects "current month" and backup timestamps |
| `APP_VERSION` | `dev` | stamped in at build time from the git tag |

The data directory is the only state. Back it up and you have backed up everything.

## Outbound traffic

The app reaches the internet in exactly one case: you press **↻ Rates**, and the server requests
`https://api.frankfurter.app` for the day's USD→GBP figure. If your host blocks outbound traffic,
that button reports a failure and everything else — including typing the rate by hand — works
unchanged. Nothing else in the app ever leaves the machine.

## Exposing it

The app has **no authentication of its own**, by design. Anyone who can reach the port can read and
change the ledger. Bind it to loopback and put a reverse proxy with an auth layer in front of it —
forward-auth from something like Authelia, or whatever your proxy already does for the rest of your
services.

This is a deliberate choice rather than a gap. A login page here would be a second set of
credentials to manage and security-critical code to keep right, duplicating what the thing already
guarding your other self-hosted apps does better. The app trusts its network and nothing else: it
reads no request headers to decide who you are, so it cannot be fooled by a spoofed one.

Note that Docker publishes ports by inserting its own firewall rules, which most host firewalls do
not filter — so publishing on `127.0.0.1` rather than `0.0.0.0` is what actually keeps it off the
network, not the firewall.

## Health

The image declares a `HEALTHCHECK` that requests `/api/data`, so `docker ps` reports `(healthy)`
only once the app is actually serving — not merely once the process has started.
