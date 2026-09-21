import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactId, extractEvents, reduceArtifacts } from "../scripts/lib/artifacts.mjs";

const ctx = { project: "widget-lab", session: "sess-1" };

function line(obj) {
  return JSON.stringify(obj);
}

function publishLine({ ts, toolId = "t1", filePath = "/r/p.html", description = "A test card", icon = "🃏",
  cwd = "/r/widget-lab", url = "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
  title = "Widget Overview", version = "v1", path = "/r/p.html", extra = {} }) {
  const assistant = line({ type: "assistant", timestamp: ts, cwd,
    message: { content: [{ type: "tool_use", id: toolId, name: "Artifact",
      input: { file_path: filePath, description, favicon: icon } }] } });
  const user = line({ type: "user", timestamp: ts,
    message: { content: [{ type: "tool_result", tool_use_id: toolId, content: "Published …" }] },
    toolUseResult: { url, artifact_id: artifactId(url), title, version, path, ...extra } });
  return [assistant, user];
}

test("artifactId: extracts uuid from /code/artifact/", () => {
  assert.equal(artifactId("https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a"),
    "2cd570bf-705b-4632-afb2-65d4c579a09a");
});

test("artifactId: extracts short id from /artifact/", () => {
  assert.equal(artifactId("https://claude.ai/artifact/abc123"), "abc123");
});

// Rule 1: publish detection
test("rule1: a valid publish tool_result produces a publish event", () => {
  const lines = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(lines, ctx);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "publish");
  assert.equal(events[0].id, "2cd570bf-705b-4632-afb2-65d4c579a09a");
});

test("rule1: is_error true is ignored", () => {
  const assistant = line({ type: "assistant", timestamp: "t", cwd: "/r/x",
    message: { content: [{ type: "tool_use", id: "t1", name: "Artifact",
      input: { file_path: "/r/p.html", description: "D", favicon: "x" } }] } });
  const user = line({ type: "user", timestamp: "t",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "err" }] },
    toolUseResult: { url: "https://claude.ai/artifact/zzz" } });
  const events = extractEvents([assistant, user], ctx);
  assert.equal(events.length, 0);
});

test("failed publish (is_error) is ignored — explicit duplicate of rule1 case", () => {
  const assistant = line({ type: "assistant", timestamp: "t", cwd: "/r/x",
    message: { content: [{ type: "tool_use", id: "t9", name: "Artifact",
      input: { file_path: "/r/p.html", description: "D", favicon: "x" } }] } });
  const user = line({ type: "user", timestamp: "t",
    message: { content: [{ type: "tool_result", tool_use_id: "t9", is_error: true, content: "boom" }] },
    toolUseResult: { url: "https://claude.ai/artifact/zzz" } });
  assert.equal(extractEvents([assistant, user], ctx).length, 0);
});

test("rule1: asset publish is ignored", () => {
  const assistant = line({ type: "assistant", timestamp: "t", cwd: "/r/x",
    message: { content: [{ type: "tool_use", id: "t2", name: "Artifact",
      input: { file_path: "/r/img.png", asset: true } }] } });
  const user = line({ type: "user", timestamp: "t",
    message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "uploaded" }] },
    toolUseResult: { url: "https://claude.ai/artifact/yyy" } });
  assert.equal(extractEvents([assistant, user], ctx).length, 0);
});

test("read action is ignored", () => {
  const assistant = line({ type: "assistant", timestamp: "t", cwd: "/r/x",
    message: { content: [{ type: "tool_use", id: "t3", name: "Artifact",
      input: { action: "read", url: "https://claude.ai/artifact/qqq" } }] } });
  const user = line({ type: "user", timestamp: "t",
    message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "…" }] },
    toolUseResult: { url: "https://claude.ai/artifact/qqq" } });
  assert.equal(extractEvents([assistant, user], ctx).length, 0);
});

test("malformed JSON line is skipped, not thrown", () => {
  const lines = ["{not json", ...publishLine({ ts: "2026-01-01T00:00:00Z" })];
  assert.doesNotThrow(() => extractEvents(lines, ctx));
  assert.equal(extractEvents(lines, ctx).length, 1);
});

// Rule 2: description/icon from tool_use input; latest publish wins for title/version/file/updatedAt/cwd
test("rule2: latest publish wins title/version/file/updatedAt/cwd; description/icon fall back to most recent with them", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z", toolId: "t1", title: "First Title", version: "v1",
    filePath: "/r/first.html", path: "/r/first.html", cwd: "/r/widget-lab", description: "First desc", icon: "🥇" });
  const p2 = publishLine({ ts: "2026-01-01T01:00:00Z", toolId: "t2", title: "Second Title", version: "v2",
    filePath: "/r/second.html", path: "/r/second.html", cwd: "/r/widget-lab-2", description: null, icon: null });
  const events = extractEvents([...p1, ...p2], ctx);
  const rows = reduceArtifacts(events, {});
  const row = rows["2cd570bf-705b-4632-afb2-65d4c579a09a"];
  assert.equal(row.title, "Second Title");
  assert.equal(row.version, "v2");
  assert.equal(row.file, "/r/second.html");
  assert.equal(row.updatedAt, "2026-01-01T01:00:00Z");
  assert.equal(row.cwd, "/r/widget-lab-2");
  assert.equal(row.description, "First desc");
  assert.equal(row.icon, "🥇");
  assert.equal(row.publishCount, 2);
});

// Rule 3: list rows add unknowns, only raise updatedAt for knowns
test("rule3: list adds unknown artifacts and only raises updatedAt for known ones", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-02T00:00:00Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a", title: "Widget Overview", icon: null,
    updatedAt: "2026-01-03T00:00:00Z", ...ctx });
  events.push({ type: "list", ts: "2026-01-02T00:00:00Z", url: "https://claude.ai/artifact/newid1",
    id: "newid1", title: "Brand New Card", icon: "🆕", updatedAt: "2026-01-02T00:00:00Z", ...ctx });
  const rows = reduceArtifacts(events, {});
  assert.equal(Object.keys(rows).length, 2);
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].updatedAt, "2026-01-03T00:00:00Z");
  assert.ok(rows["newid1"]);
  assert.equal(rows["newid1"].title, "Brand New Card");
});

test("rule3: list does not lower updatedAt for a known row", () => {
  const p1 = publishLine({ ts: "2026-01-05T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T00:00:00Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a", title: "Widget Overview", icon: null,
    updatedAt: "2026-01-01T00:00:00Z", ...ctx });
  const rows = reduceArtifacts(events, {});
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].updatedAt, "2026-01-05T00:00:00Z");
});

// Rule 4: aliasing via list with matching title + updatedAt within 15 min
test("rule4: list with matching title within 15 min of existing row becomes an alias", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T00:10:00Z", url: "https://claude.ai/artifact/shortid1",
    id: "shortid1", title: "Widget Overview", icon: null, updatedAt: "2026-01-01T00:10:00Z", ...ctx });
  const rows = reduceArtifacts(events, {});
  assert.equal(Object.keys(rows).length, 1);
  const row = rows["2cd570bf-705b-4632-afb2-65d4c579a09a"];
  assert.deepEqual(row.aliases, ["https://claude.ai/artifact/shortid1"]);
});

test("rule4: list with matching title but outside 15 min window is a separate row", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T01:00:00Z", url: "https://claude.ai/artifact/shortid2",
    id: "shortid2", title: "Widget Overview", icon: null, updatedAt: "2026-01-01T01:00:00Z", ...ctx });
  const rows = reduceArtifacts(events, {});
  assert.equal(Object.keys(rows).length, 2);
});

// Rule 5: delete removes row (also via alias); publish after delete recreates
test("rule5: delete removes the row", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "delete", ts: "2026-01-01T02:00:00Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a" });
  const rows = reduceArtifacts(events, {});
  assert.equal(Object.keys(rows).length, 0);
});

test("rule5: delete removes the row via an alias id", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T00:10:00Z", url: "https://claude.ai/artifact/shortid3",
    id: "shortid3", title: "Widget Overview", icon: null, updatedAt: "2026-01-01T00:10:00Z", ...ctx });
  events.push({ type: "delete", ts: "2026-01-01T00:20:00Z", url: "https://claude.ai/artifact/shortid3",
    id: "shortid3" });
  const rows = reduceArtifacts(events, {});
  assert.equal(Object.keys(rows).length, 0);
});

test("rule5: a publish after a delete recreates the row", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const p2 = publishLine({ ts: "2026-01-01T03:00:00Z", toolId: "t2", title: "Widget Overview Reborn" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "delete", ts: "2026-01-01T02:00:00Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a" });
  events.push(...extractEvents(p2, ctx));
  const rows = reduceArtifacts(events, {});
  assert.equal(Object.keys(rows).length, 1);
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].title, "Widget Overview Reborn");
});

// Rule 6: prev rows persist unless deleted; thumb always carried over
test("rule6: prev rows missing from current events are kept", () => {
  const prev = { "oldid1": { id: "oldid1", url: "https://claude.ai/artifact/oldid1", aliases: [],
    title: "Legacy Card", description: null, icon: null, project: "old-proj", cwd: null, file: null,
    version: null, updatedAt: "2025-01-01T00:00:00Z", firstSeen: "2025-01-01T00:00:00Z", publishCount: 1 } };
  const rows = reduceArtifacts([], prev);
  assert.ok(rows["oldid1"]);
  assert.equal(rows["oldid1"].title, "Legacy Card");
});

test("rule6: prev rows deleted in current events are not kept", () => {
  const prev = { "oldid2": { id: "oldid2", url: "https://claude.ai/artifact/oldid2", aliases: [],
    title: "Gone Card", description: null, icon: null, project: "old-proj", cwd: null, file: null,
    version: null, updatedAt: "2025-01-01T00:00:00Z", firstSeen: "2025-01-01T00:00:00Z", publishCount: 1 } };
  const events = [{ type: "delete", ts: "2026-01-01T00:00:00Z", url: "https://claude.ai/artifact/oldid2", id: "oldid2" }];
  const rows = reduceArtifacts(events, prev);
  assert.equal(rows["oldid2"], undefined);
});

test("rule6: prev[id].thumb is always carried over onto an updated row", () => {
  const prev = { "2cd570bf-705b-4632-afb2-65d4c579a09a": { id: "2cd570bf-705b-4632-afb2-65d4c579a09a",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a", aliases: [],
    title: "Widget Overview", description: null, icon: null, project: "widget-lab", cwd: null, file: null,
    version: "v0", updatedAt: "2025-12-01T00:00:00Z", firstSeen: "2025-12-01T00:00:00Z", publishCount: 1,
    thumb: "thumbs/2cd570bf.png" } };
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const rows = reduceArtifacts(extractEvents(p1, ctx), prev);
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].thumb, "thumbs/2cd570bf.png");
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].version, "v1");
});

// Rule 7: deterministic output
test("rule7: running the reduction twice on the same input gives equal JSON", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T00:10:00Z", url: "https://claude.ai/artifact/shortid4",
    id: "shortid4", title: "Widget Overview", icon: null, updatedAt: "2026-01-01T00:10:00Z", ...ctx });
  const a = JSON.stringify(reduceArtifacts(events, {}));
  const b = JSON.stringify(reduceArtifacts(events, {}));
  assert.equal(a, b);
});
