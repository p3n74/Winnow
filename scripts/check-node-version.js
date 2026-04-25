#!/usr/bin/env node

const [major] = process.versions.node.split(".").map((value) => Number(value));

if (Number.isFinite(major) && major >= 20 && major < 23) {
  process.exit(0);
}

const message = [
  "",
  "[winnow] Unsupported Node.js version detected.",
  `[winnow] Current: v${process.versions.node}`,
  "[winnow] Required: >=20 and <23 (Node 22 LTS recommended).",
  "",
  "Fix with nvm:",
  "  nvm install 22",
  "  nvm use 22",
  "  npm install",
  "",
  "Or use the automated setup script:",
  "  npm run setup",
  "",
].join("\n");

process.stderr.write(message);
process.exit(1);
