#!/usr/bin/env node

const [major] = process.versions.node.split(".").map((value) => Number(value));

if (Number.isFinite(major) && major >= 20) {
  process.exit(0);
}

const message = [
  "",
  "[winnow] Unsupported Node.js version detected.",
  `[winnow] Current: v${process.versions.node}`,
  "[winnow] Required: Node.js 20 or newer (LTS recommended).",
  "",
  "Fix with nvm:",
  "  nvm install --lts",
  "  nvm use --lts",
  "  npm install",
  "",
  "Or use the automated setup script:",
  "  npm run setup",
  "",
].join("\n");

process.stderr.write(message);
process.exit(1);
