# MCP (manual setup)

Winnow does not install or host MCP servers. It uses the same Cursor Agent CLI config files and passes headless flags so MCP works in the companion UI.

## Configure servers

Edit one of:

| Path | Scope |
| --- | --- |
| `<workspace>/.cursor/mcp.json` | Project |
| `~/.cursor/mcp.json` | Global (all workspaces) |

Cursor discovers project → global → nested parents the same way in the IDE and CLI. Example stdio server:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

HTTP/SSE servers use `url` (and optional `type`: `"http"` or `"sse"`). See [Cursor MCP docs](https://cursor.com/docs/mcp) and [CLI MCP](https://cursor.com/docs/cli/mcp).

## How Winnow uses MCP

UI agent runs spawn `cursor-agent` with `--print`, `--trust`, and `--approve-mcps` so workspace trust and MCP approval cannot block piped stdio. The CLI pipeline adds the same flags whenever `--print` is in effect (session resume, translation, or interactive loop). Interactive TTY passthrough without `--print` is unchanged — Cursor prompts as usual.

Winnow never writes `mcp.json` for you in this pass.

## Verify

```bash
# Outside Winnow: Cursor CLI
cursor-agent mcp list
cursor-agent mcp list-tools <server-name>

# Inside Winnow
npm run doctor
# or: GET /api/mcp/status on the companion UI (auth-gated like other APIs)
```

`winnow doctor` reports configured server names from the files above (read-only). It does not start MCP processes.
