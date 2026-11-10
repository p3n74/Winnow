# SSH workspaces

Winnow can open a **folder on another machine** over OpenSSH while keeping **`cursor-agent` on the machine that launched the UI** (the SSH client). This is **not** the same as [`--remote`](./remote-access.md), which only binds the companion UI on the LAN for a reverse proxy.

Cursor IDE Remote-SSH runs the language tools on the remote host. Winnow instead mounts the remote tree with **sshfs** and spawns local `cursor-agent` with `--workspace` pointed at that mount. Shells in the main grid still use `ssh -t`.

## Open a remote folder

CLI:

```bash
winnow ui --ssh user@host:/var/www/app
winnow ui --ssh ssh://user@host:2222/var/www/app --ssh-identity ~/.ssh/id_ed25519
```

In the dashboard **Recent Projects** panel, use **Connect SSH** (host, user, port, optional password, remote path). If key/agent login fails, Winnow pops up a password prompt. The password stays in memory for that UI session only and is not written to disk. The Agent workspace has the same control. You can still paste `user@host:/abs/path` or `ssh://…` into the working-directory field.

Keys in `ssh-agent` are tried first. There is no identity-file picker in the UI.

Probe without starting the UI:

```bash
winnow doctor --ssh user@host:/var/www/app
```

`--ssh` uses your OpenSSH client (`~/.ssh/config`, keys, `ProxyJump`, `ssh-agent`). BatchMode is on unless a session password is supplied: unknown hosts and password prompts fail. Load keys into `ssh-agent` first.

## What runs where

| Surface | SSH workspace |
| --- | --- |
| Agent (`cursor-agent`) | **Local** (this machine’s CLI, logged in here). Workspace is the sshfs mount under `~/.winnow/ssh-mounts/…` |
| Git status / stage | Local `git` against the mount |
| Main-grid terminals | Remote (`ssh -t`) |
| Graph, docs, plans, file browser, process manager, host web preview | Gated with an explicit error until a later phase |

Winnow session JSON stays on the **laptop** (under the last local project / launch root). Cursor transcripts for agent runs land under this machine’s `~/.cursor/projects/…` for the mount path.

Home-relative remote paths (`user@host:~/src/app`) expand `$HOME` on the remote; they are not sent as a quoted literal `~/`.

## Requirements

On **this machine** (SSH client / Winnow host):

- `cursor-agent` on `PATH` and Cursor auth (`agent login` or `CURSOR_API_KEY`).
- `sshfs` (macOS: macFUSE + sshfs; Linux: `sshfs`).

On the **remote host**:

- The remote path is a directory.
- SSH login (keys in `ssh-agent`, or a one-shot password in the UI).
- `cursor-agent` is **not** required on the destination.

## Naming

| Flag | Meaning |
| --- | --- |
| `--remote` | Bind the UI on `0.0.0.0` + access token (LAN / reverse proxy). |
| `--ssh` | Open a folder on another host via SSH + sshfs; run local `cursor-agent`. |
