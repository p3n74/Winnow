/** POSIX single-quote for a remote bash argument. */
export function posixQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Remote path expression that still expands `~/` via `$HOME`.
 * Single-quoting `~/src` would look for a literal `~/src` directory.
 */
export function remotePathExpr(remotePath: string): string {
  const trimmed = String(remotePath);
  if (trimmed === "~") {
    return '"$HOME"';
  }
  if (trimmed.startsWith("~/")) {
    return `"$HOME/"${posixQuote(trimmed.slice(2))}`;
  }
  return posixQuote(trimmed);
}

export function joinRemoteCommand(argv: string[]): string {
  return argv.map(posixQuote).join(" ");
}

export function remoteCdAndExec(remotePath: string, argv: string[]): string {
  return `cd ${remotePathExpr(remotePath)} && exec ${joinRemoteCommand(argv)}`;
}

export function remoteGitAt(remotePath: string, gitArgs: string[]): string {
  return `git -C ${remotePathExpr(remotePath)} ${gitArgs.map(posixQuote).join(" ")}`;
}
