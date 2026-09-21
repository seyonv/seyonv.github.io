import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newKey, sealBytes, openBytes, blobName, b64url, fromB64url, sealAll,
} from "../scripts/lib/seal.mjs";

test("sealBytes then openBytes round-trips", () => {
  const key = newKey();
  const plain = Buffer.from("hello world");
  const blob = sealBytes(key, plain);
  assert.deepEqual(openBytes(key, blob), plain);
});

test("a tampered byte makes openBytes throw", () => {
  const key = newKey();
  const blob = sealBytes(key, Buffer.from("hello world"));
  blob[blob.length - 1] ^= 0xff; // flip a bit in the auth tag
  assert.throws(() => openBytes(key, blob));
});

test("blobName is stable for the same key+id, differs across keys", () => {
  const key1 = newKey(), key2 = newKey();
  const a = blobName(key1, "abc");
  const b = blobName(key1, "abc");
  const c = blobName(key2, "abc");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 24);
});

test("b64url/fromB64url round-trip a key", () => {
  const key = newKey();
  assert.deepEqual(fromB64url(b64url(key)), key);
});

test("a Node-sealed blob decrypts with globalThis.crypto.subtle (WebCrypto path)", async () => {
  const key = newKey();
  const plain = Buffer.from(JSON.stringify({ hello: "world" }));
  const blob = sealBytes(key, plain);
  const iv = blob.subarray(0, 12);
  const ctAndTag = blob.subarray(12); // WebCrypto wants ciphertext||tag together

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw", key, { name: "AES-GCM" }, false, ["decrypt"],
  );
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, cryptoKey, ctAndTag,
  );
  assert.deepEqual(Buffer.from(decrypted), plain);
});

test("leak check: sealed manifest bytes never contain the plaintext title", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seal-leak-"));
  try {
    const key = newKey();
    const secretTitle = "Blackbird / Flycar — Interview Reference";
    const state = {
      x1: {
        id: "x1", url: "https://claude.ai/code/artifact/x1", title: secretTitle,
        description: "A description", icon: "🕊️", project: "p", updatedAt: "2026-01-01T00:00:00Z",
        publishCount: 1,
      },
    };
    const outDir = join(dir, "data");
    const sealedPath = join(dir, "sealed.json");
    await sealAll({ state, thumbsDir: join(dir, "thumbs-missing"), outDir, sealedPath, key });

    const files = await readdir(outDir);
    assert.ok(files.length > 0);
    for (const f of files) {
      const bytes = await readFile(join(outDir, f));
      assert.ok(!bytes.includes(Buffer.from("Blackbird")), `${f} leaked plaintext`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sealAll is idempotent: a second run with unchanged state writes 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seal-idem-"));
  try {
    const key = newKey();
    const state = {
      a: { id: "a", url: "u", title: "T", description: "D", icon: "x", project: "p",
        updatedAt: "2026-01-01T00:00:00Z", publishCount: 1 },
    };
    const outDir = join(dir, "data");
    const sealedPath = join(dir, "sealed.json");

    const first = await sealAll({ state, thumbsDir: join(dir, "nope"), outDir, sealedPath, key });
    assert.equal(first.written, 1); // manifest only, no thumbs dir
    assert.equal(first.unchanged, 0);

    const second = await sealAll({ state, thumbsDir: join(dir, "nope"), outDir, sealedPath, key });
    assert.equal(second.written, 0);
    assert.equal(second.unchanged, 1);
    assert.equal(second.removed, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sealAll removes stale .enc files no longer produced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seal-stale-"));
  try {
    const key = newKey();
    const outDir = join(dir, "data");
    const sealedPath = join(dir, "sealed.json");
    const thumbsDir = join(dir, "thumbs");
    await mkdir(thumbsDir, { recursive: true });
    await writeFile(join(thumbsDir, "a.jpg"), Buffer.from("fake jpg bytes"));

    const state = {
      a: { id: "a", url: "u", title: "T", description: "D", icon: "x", project: "p",
        updatedAt: "2026-01-01T00:00:00Z", publishCount: 1 },
    };

    const first = await sealAll({ state, thumbsDir, outDir, sealedPath, key });
    assert.equal(first.written, 2); // manifest + 1 thumb
    const filesAfterFirst = await readdir(outDir);
    assert.equal(filesAfterFirst.length, 2);

    // Remove the thumb from state entirely — its .enc should be pruned next run.
    await rm(join(thumbsDir, "a.jpg"));
    const second = await sealAll({ state, thumbsDir, outDir, sealedPath, key });
    assert.equal(second.removed, 1);
    const filesAfterSecond = await readdir(outDir);
    assert.equal(filesAfterSecond.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
