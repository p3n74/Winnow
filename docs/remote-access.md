# Remote access and reverse proxies

Winnow’s companion UI (`winnow ui`) runs on the machine that has your files, terminals, and `cursor-agent`. Bind it on the loopback interface for local use. Bind it on the network when a later reverse proxy (for example a Coolify service on a VPS) will expose the same UI at a public URL.

This document is the operator and integrator contract. It does **not** ship a Coolify app, an outbound tunnel, or TLS inside Winnow.

## Threat model

The UI can:

- spawn shells (PTY panes),
- read and write workspace files,
- start and stop Cursor agent runs,
- manage processes.

Treat the access token as a password for that machine. Anyone who has it can drive the IDE.

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
npm run ui -- --remote --cors-origin https://winnow.example.com
```

`--remote` does three things:

1. Binds `0.0.0.0` unless `--host` is already a non-loopback address.
2. Requires an access token (generates one if you do not pass `--token`).
3. Does not auto-open a browser (`--no-open` equivalent). `--shell` still opens the embedded Electron window if you pass it.

Startup prints bind URLs, the token, LAN IPs when bound to `0.0.0.0`, and a reminder that a reverse proxy must forward WebSocket upgrades and SSE.

| Flag | Role |
| --- | --- |
| `--host` | Bind address. Default `127.0.0.1`. Use `0.0.0.0` for LAN. |
| `--remote` | Network mode: non-loopback bind, required token, no auto-open. |
| `--token` | Access secret. Query, `Authorization: Bearer`, or cookie. |
| `--port` | Listen port. Default `3210`. |
| `--cors-origin` | Optional CORS allowlist for a **different** browser origin. Off by default. |
| `--no-open` | Print the URL only. Implied by `--remote`. |

`--host 0.0.0.0` without `--remote` still auto-generates a long token and still auto-opens a local browser unless you also pass `--no-open`.

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
- Forward WebSocket `Upgrade` for `/ws/main/*` (terminal PTYs).
- Forward Server-Sent Events for `/api/agent/:id/stream` (agent timeline). Do not buffer the stream.
- Pass `Host` and `X-Forwarded-Proto` (so the UI cookie can be `Secure` behind HTTPS).
- Probe `GET /api/health` without the UI token.
- Keep the browser origin the same as the API (proxy the existing HTML). Then you do **not** need `--cors-origin`.

The UI already uses relative `fetch` / `EventSource` paths and WebSocket URLs from `location.host` / `wss:`, so a same-origin proxy does not need to rewrite page JavaScript.

If a **separate origin** will call the Winnow API from the browser, start Winnow with `--cors-origin https://that-origin` (credentials + `Authorization`). Same-origin proxying does not need this.

## What this repo does not do

- No Coolify / VPS website. That is a separate project that should reverse-proxy this UI.
- No outbound connector or NAT tunnel from Winnow to the VPS.
- No TLS listener inside Winnow. Terminate HTTPS at the proxy.
