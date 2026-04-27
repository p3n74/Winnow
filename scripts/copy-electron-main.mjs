import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "cli", "electronAppMain.cjs");
const destDir = join(root, "dist", "cli");
const dest = join(destDir, "electronAppMain.cjs");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
