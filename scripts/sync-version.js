#!/usr/bin/env node

/**
 * Reads the version from package.json and patches it into manifest.json.
 * Run before `mcpb pack` to keep the two files in sync.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "package.json");
const manifestPath = resolve(root, "manifest.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

if (manifest.version === pkg.version) {
  console.log(`Version already in sync: ${pkg.version}`);
} else {
  console.log(`Syncing version: ${manifest.version} → ${pkg.version}`);
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
