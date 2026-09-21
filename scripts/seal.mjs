#!/usr/bin/env node
// Seals the private artifacts state into artifacts/data/*.enc for the public
// GitHub Pages repo. Only ciphertext is ever written under the repo.
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STATE, THUMBS, SEALED, KEY, REPO } from "./lib/paths.mjs";
import { loadOrCreateKey, newKey, writeKey, sealAll } from "./lib/seal.mjs";

const rotate = process.argv.includes("--rotate");
const outDir = join(REPO, "artifacts", "data");

async function main() {
  let key;
  if (rotate) {
    key = newKey();
    await writeKey(KEY, key);
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
