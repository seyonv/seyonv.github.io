import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export const newKey = () => randomBytes(32);
export const b64url = (b) => Buffer.from(b).toString("base64url");
export const fromB64url = (s) => Buffer.from(s, "base64url");

export function sealBytes(key, plain) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}

export function openBytes(key, blob) {
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
}

export const blobName = (key, id) => createHmac("sha256", key).update(id).digest("hex").slice(0, 24);

const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

// Load the key from `keyPath`, creating a fresh one (mode 600, parent dir mode 700)
// if missing. Returns the raw 32-byte key Buffer.
export async function loadOrCreateKey(keyPath) {
  if (existsSync(keyPath)) {
    return fromB64url((await readFile(keyPath, "utf8")).trim());
  }
  const key = newKey();
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  await writeFile(keyPath, b64url(key), { mode: 0o600 });
  await chmod(dirname(keyPath), 0o700);
  await chmod(keyPath, 0o600);
  return key;
}

// Build the public manifest object (unsealed, in memory only) from STATE rows.
// `thumbsDir` is scanned for `<id>.jpg` files to decide which rows get a thumb.
export async function buildManifest({ state, thumbsDir, key }) {
  const hasThumb = new Set();
  if (thumbsDir && existsSync(thumbsDir)) {
    for (const f of await readdir(thumbsDir)) {
      const m = f.match(/^(.+)\.jpg$/);
      if (m) hasThumb.add(m[1]);
    }
  }
  const rows = Object.values(state).map((r) => ({
    id: r.id,
    url: r.url,
    title: r.localTitle || r.title,
    description: r.description,
    icon: r.icon,
    project: r.project,
    updatedAt: r.updatedAt,
    publishCount: r.publishCount,
    thumb: hasThumb.has(r.id) ? blobName(key, r.id) : null,
  }));
  rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const generatedAt = rows.reduce((max, r) => (r.updatedAt && r.updatedAt > max ? r.updatedAt : max), "");
  return { generatedAt, artifacts: rows };
}

// Seals everything (manifest + thumbnails) into `outDir`, using `sealedPath` to
// track plaintext hashes for idempotence, and removing stale .enc files.
// Returns { written, unchanged, removed }.
export async function sealAll({ state, thumbsDir, outDir, sealedPath, key }) {
  await mkdir(outDir, { recursive: true });

  let sealed = {};
  if (existsSync(sealedPath)) {
    try { sealed = JSON.parse(await readFile(sealedPath, "utf8")); } catch { sealed = {}; }
  }
  const nextSealed = {};
  const produced = new Set();
  let written = 0, unchanged = 0;

  const sealOne = async (name, plain) => {
    const hash = sha256hex(plain);
    const outPath = join(outDir, name);
    produced.add(name);
    if (sealed[name] === hash && existsSync(outPath)) {
      nextSealed[name] = hash;
      unchanged++;
      return;
    }
    await writeFile(outPath, sealBytes(key, plain));
    nextSealed[name] = hash;
    written++;
  };

  const manifest = await buildManifest({ state, thumbsDir, key });
  await sealOne("manifest.enc", Buffer.from(JSON.stringify(manifest)));

  if (thumbsDir && existsSync(thumbsDir)) {
    for (const f of await readdir(thumbsDir)) {
      const m = f.match(/^(.+)\.jpg$/);
      if (!m) continue;
      const id = m[1];
      const plain = await readFile(join(thumbsDir, f));
      await sealOne(`${blobName(key, id)}.enc`, plain);
    }
  }

  let removed = 0;
  if (existsSync(outDir)) {
    for (const f of await readdir(outDir)) {
      if (!f.endsWith(".enc")) continue;
      if (!produced.has(f)) {
        await rm(join(outDir, f));
        removed++;
      }
    }
  }

  await writeFile(sealedPath, JSON.stringify(nextSealed, null, 2));

  return { written, unchanged, removed };
}
