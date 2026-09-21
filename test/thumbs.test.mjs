import { test } from "node:test";
import assert from "node:assert/strict";
import { thumbVer, needsCapture, pickSource } from "../scripts/lib/thumbs.mjs";

test("thumbVer prefers version, falls back to updatedAt", () => {
  assert.equal(thumbVer({ version: "v2", updatedAt: "2026-01-01" }), "v2");
  assert.equal(thumbVer({ updatedAt: "2026-01-01" }), "2026-01-01");
  assert.equal(thumbVer({}), null);
});

test("row without a thumb needs capture", () => {
  assert.equal(needsCapture({ version: "v1" }), true);
});

test("up-to-date local or remote thumb is kept", () => {
  assert.equal(needsCapture({ version: "v1", thumb: { ver: "v1", kind: "local" } }), false);
  assert.equal(needsCapture({ updatedAt: "t1", thumb: { ver: "t1", kind: "remote" } }), false);
});

test("version change forces recapture", () => {
  assert.equal(needsCapture({ version: "v2", thumb: { ver: "v1", kind: "local" } }), true);
});

test("placeholder is always retried", () => {
  assert.equal(needsCapture({ version: "v1", thumb: { ver: "v1", kind: "placeholder" } }), true);
});

test("--force recaptures even an up-to-date thumb", () => {
  assert.equal(needsCapture({ version: "v1", thumb: { ver: "v1", kind: "local" } }, { force: true }), true);
});

test("pickSource: local file wins, then saved page, then remote, else nothing", () => {
  const pagesDir = "/state/pages";
  const have = (...paths) => (p) => paths.includes(p);
  const row = { id: "a1", file: "/repo/card.html", url: "https://example.test/a1" };
  assert.deepEqual(pickSource(row, { pagesDir, exists: have("/repo/card.html", "/state/pages/a1/index.html") }),
    { kind: "local", file: "/repo/card.html" });
  assert.deepEqual(pickSource(row, { pagesDir, exists: have("/state/pages/a1/index.html") }),
    { kind: "snapshot", file: "/state/pages/a1/index.html" });
  assert.deepEqual(pickSource(row, { pagesDir, exists: have() }), { kind: "remote" });
  assert.equal(pickSource({ id: "a1" }, { pagesDir, exists: have() }), null);
});

test("pickSource: unsafe ids get no source, so nothing touches the fs", () => {
  let probed = false;
  const exists = () => { probed = true; return true; };
  for (const id of ["../x", "a/b"]) {
    assert.equal(pickSource({ id, file: "/repo/card.html", url: "https://example.test/x" }, { pagesDir: "/p", exists }), null);
  }
  assert.equal(probed, false);
});
