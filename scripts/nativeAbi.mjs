export const NATIVE_PACKAGES = ["better-sqlite3", "node-pty"];

export function isNativeAbiMismatch(output) {
  const text = String(output || "");
  return /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|compiled against a different Node\.js version/i.test(
    text,
  );
}

export function pathWithRunningNode(envPath, execPath, pathDelimiter) {
  const lastSep = Math.max(String(execPath).lastIndexOf("/"), String(execPath).lastIndexOf("\\"));
  const nodeBin = lastSep >= 0 ? String(execPath).slice(0, lastSep) : ".";
  const rest = envPath ? String(envPath) : "";
  return rest ? `${nodeBin}${pathDelimiter}${rest}` : nodeBin;
}
