#!/usr/bin/env node
// Seals the private artifacts state into artifacts/data/*.enc for the public
// GitHub Pages repo. Only ciphertext is ever written under the repo.
import { readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STATE, THUMBS, SEALED, KEY, REPO } from "./lib/paths.mjs";
import { loadOrCreateKey, newKey, b64url, sealAll } from "./lib/seal.mjs";

const rotate = process.argv.includes("--rotate");
const outDir = join(REPO, "artifacts", "data");

async function main() {
  let key;
  if (rotate) {
    key = newKey();
    const { mkdir, chmod } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(KEY), { recursive: true, mode: 0o700 });
    await writeFile(KEY, b64url(key), { mode: 0o600 });
    await chmod(KEY, 0o600);
    if (existsSync(SEALED)) await rm(SEALED);
    console.log("rotated: new key written, sealed state cleared");
  } else {
    key = await loadOrCreateKey(KEY);
  }

  const state = JSON.parse(await readFile(STATE, "utf8"));
  const { written, unchanged, removed } = await sealAll({
    state, thumbsDir: THUMBS, outDir, sealedPath: SEALED, key,
  });
  console.log(`sealed: ${written} written, ${unchanged} unchanged, ${removed} removed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
