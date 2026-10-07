#!/usr/bin/env node
// Seals every plan-page folder (~/Desktop/repos/*/ with a .plan/ dir) into
// plans/data/*.enc, using the same key as the artifacts gallery.
import { readFile, readdir, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KEY, SEALED, REPO } from "./lib/paths.mjs";
import { loadKeySafely, sealBytes, openBytes, blobName } from "./lib/seal.mjs";
import { bundlePlan, planMeta, findPlanDirs } from "./lib/plans.mjs";

const REPOS = join(homedir(), "Desktop", "repos");
const outDir = join(REPO, "plans", "data");

async function main() {
  const key = await loadKeySafely(KEY, [SEALED, join(REPO, "artifacts", "data", "manifest.enc")]);
  await mkdir(outDir, { recursive: true });
  const produced = new Set();
  let written = 0, unchanged = 0;

  // Re-encrypting identical plaintext would still change the bytes (random IV),
  // so only rewrite a blob when its decrypted contents actually differ.
  const sealOne = async (name, plain) => {
    const path = join(outDir, name);
    produced.add(name);
    if (existsSync(path)) {
      try { if (openBytes(key, await readFile(path)).equals(plain)) { unchanged++; return; } } catch {}
    }
    await writeFile(path, sealBytes(key, plain));
    written++;
  };

  const plans = [];
  for (const { slug, dir } of findPlanDirs(REPOS)) {
    const html = await readFile(join(dir, "index.html"), "utf8");
    const read = (rel) => { try { return readFileSync(join(dir, rel)); } catch { return null; } };
    const blob = blobName(key, "plan:" + slug);
    await sealOne(`${blob}.enc`, Buffer.from(bundlePlan(html, read)));
    plans.push({ blob, project: slug, updatedAt: (await stat(join(dir, "index.html"))).mtime.toISOString(), ...planMeta(html) });
  }
  plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await sealOne("manifest.enc", Buffer.from(JSON.stringify({ plans })));

  let removed = 0;
  for (const f of await readdir(outDir)) {
    if (f.endsWith(".enc") && !produced.has(f)) { await rm(join(outDir, f)); removed++; }
  }
  console.log(`plans: ${plans.length} found; ${written} written, ${unchanged} unchanged, ${removed} removed`);
}

main().catch((err) => {
  console.error(err.message?.startsWith("key missing") ? err.message : err);
  process.exit(1);
});
