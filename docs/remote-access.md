# Remote access and reverse proxies

Winnow’s companion UI (`winnow ui`) runs on the machine that has your files, terminals, and `cursor-agent`. Bind it on the loopback interface for local use. Bind it on the network when a later reverse proxy (for example a Coolify service on a VPS) will expose the same UI at a public URL.

This document is the operator and integrator contract. It does **not** ship a Coolify app, an outbound tunnel, or TLS inside Winnow.

## Threat model

The UI can:

- spawn shells (PTY panes),
- read and write workspace files,
- start and stop Cursor agent runs,
- manage processes.

Treat the access token as a password for that machine. Anyone who has it can drive the IDE. `--no-token` removes that gate; only use it on a path you already trust (private network, or a proxy that authenticates).

TLS belongs at the reverse proxy (Coolify / Caddy / nginx), not in Winnow. Winnow serves plain HTTP. Put the PC and the proxy on a path you trust, or terminate HTTPS at the proxy and forward to Winnow on the LAN.

## Run on the PC

Local only (default):

```bash
npm run ui
# or
npm run dev -- ui
```

Listens on `127.0.0.1:3210`. No token unless you pass `--token`.

LAN bind (auto-generates a 32-hex token if you omit `--token`):

```bash
npm run ui -- --host 0.0.0.0
```

Network-facing / proxy-ready:

```bash
npm run ui -- --remote
# optional:
npm run ui -- --remote --token YOUR_LONG_SECRET --port 3210
npm run ui -- --remote --no-token
npm run ui -- --remote --cors-origin https://winnow.example.com
```

`--remote` does three things:

1. Binds `0.0.0.0` unless `--host` is already a non-loopback address.
2. Requires an access token (generates one if you do not pass `--token`), unless you pass `--no-token`.
3. Does not auto-open a browser (`--no-open` equivalent). `--shell` still opens the embedded Electron window if you pass it.

Startup prints bind URLs, the token, LAN IPs when bound to `0.0.0.0`, and a reminder that a reverse proxy must forward WebSocket upgrades and SSE.

| Flag | Role |
| --- | --- |
| `--host` | Bind address. Default `127.0.0.1`. Use `0.0.0.0` for LAN. |
| `--remote` | Network mode: non-loopback bind, token unless `--no-token`, no auto-open. |
| `--token` | Access secret. Query, `Authorization: Bearer`, or cookie. |
| `--no-token` | Do not require or generate a token. Anyone who can reach the bind can use the UI. |
| `--port` | Listen port. Default `3210`. |
| `--cors-origin` | Optional CORS allowlist for a **different** browser origin. Off by default. |
| `--no-open` | Print the URL only. Implied by `--remote`. |

`--host 0.0.0.0` without `--remote` still auto-generates a long token (unless `--no-token`) and still auto-opens a local browser unless you also pass `--no-open`.

## Auth contract

When a token is configured, every route except `GET`/`HEAD` `/api/health` requires it. Present the token in **any** of:

1. Query: `?token=...` (needed for `EventSource` and WebSocket URLs, which cannot set `Authorization` easily).
2. Header: `Authorization: Bearer ...` (the in-page `apiJson` helper sends this).
3. Cookie: `winnow_ui` (HttpOnly, `Path=/`, `SameSite=Lax`). `Secure` is added only when `X-Forwarded-Proto` is `https`.

A successful HTML or API request that authenticated via query or Bearer sets the cookie so later navigations do not need the token in the URL. Cookie-only requests do not re-set the cookie.

WebSocket upgrades on `/ws/main/*` use the same query / Bearer / cookie check.

`GET` / `HEAD` `/api/health` is unauthenticated and returns:

```json
{ "ok": true, "service": "winnow-ui" }
```

It does not include cwd, system stats, or the token. Use it as the Coolify (or other) health probe.

## Reverse-proxy checklist

For a later same-origin reverse proxy in front of Winnow:

- Forward HTTP to the PC bind (`host:port`).
- Forward WebSocket `Upgrade` for `/ws/main/*` (terminal PTYs), `/ws/preview/chrome` (host Chromium screencast), and host-web preview (`/__preview/:port/*` plus HMR sockets).
- Forward Server-Sent Events for `/api/agent/:id/stream` (agent timeline). Do not buffer the stream.
- Pass `Host` and `X-Forwarded-Proto` (so the UI cookie can be `Secure` behind HTTPS).
- Probe `GET /api/health` without the UI token.
- Keep the browser origin the same as the API (proxy the existing HTML). Then you do **not** need `--cors-origin`.

The UI already uses relative `fetch` / `EventSource` paths and WebSocket URLs from `location.host` / `wss:`, so a same-origin proxy does not need to rewrite page JavaScript.

If a **separate origin** will call the Winnow API from the browser, start Winnow with `--cors-origin https://that-origin` (credentials + `Authorization`). Same-origin proxying does not need this.

## Host web preview

The main-grid companion **Web** tab previews loopback on the **PC that runs Winnow** (Vite, Next, Expo, etc.).

Cursor’s Simple Browser is Chromium in the desktop app: it navigates to `http://localhost:3001` because it is not a page inside another website. Winnow’s UI *is* a website, so the Web tab uses **host Chromium** when Google Chrome/Chromium/Edge is installed on that PC. Headless Chrome opens the loopback URL (HMR and JS run on the host, like Cursor) and streams JPEG frames to the tab over `WebSocket /ws/preview/chrome`. Clicks and keys go back through CDP.

If Chrome is missing, it falls back to same-origin `/__preview/<port>/…` HTTP reverse-proxy (`localhost` DNS, `127.0.0.1`, and `::1`, `Host: localhost:<port>`).

- Only loopback URLs are allowed. The later Coolify proxy must forward `/ws/preview/chrome`, `/__preview/*`, and WebSocket upgrades the same way as the rest of the UI.
- `GET /api/preview/chrome` reports whether a Chrome binary was found. `GET /api/preview/probe?port=` reports which loopback addresses accepted a TCP/HTTP connection.

A two-letter body such as `OK` is the **document from that port**, not a blank renderer. Expo web is often `:8081`, not `:3000`.

## What this repo does not do

- No Coolify / VPS website. That is a separate project that should reverse-proxy this UI.
- No outbound connector or NAT tunnel from Winnow to the VPS.
- No TLS listener inside Winnow. Terminate HTTPS at the proxy.
