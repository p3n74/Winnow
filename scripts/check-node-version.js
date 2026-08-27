#!/usr/bin/env node

const [major] = process.versions.node.split(".").map((value) => Number(value));

if (Number.isFinite(major) && major >= 22) {
  process.exit(0);
}

const message = [
  "",
  "[winnow] Unsupported Node.js version detected.",
  `[winnow] Current: v${process.versions.node}`,
  "[winnow] Required: Node.js 22 or newer.",
  "",
  "Install or switch to Node 22+, then run: npm install",
  "Or: npm run setup",
  "",
].join("\n");

process.stderr.write(message);
process.exit(1);
