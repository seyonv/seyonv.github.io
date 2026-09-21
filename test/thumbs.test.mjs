import { test } from "node:test";
import assert from "node:assert/strict";
import { thumbVer, needsCapture } from "../scripts/lib/thumbs.mjs";

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
