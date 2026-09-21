import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactId, extractEvents, isSafeId, reduceArtifacts } from "../scripts/lib/artifacts.mjs";

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

test("artifactId: null for URLs that aren't /artifact/<id>, or whose id isn't a plain token", () => {
  assert.equal(artifactId("https://example.test/some/page"), null);
  assert.equal(artifactId("https://claude.ai/artifact/..%2Fx"), null);
  assert.equal(artifactId(undefined), null);
});

test("isSafeId: accepts uuids and short ids, rejects path-like ids", () => {
  assert.equal(isSafeId("2cd570bf-705b-4632-afb2-65d4c579a09a"), true);
  assert.equal(isSafeId("Mn2R64kNMUfmeFjBJHv1nz"), true);
  assert.equal(isSafeId("../x"), false);
  assert.equal(isSafeId("a/b"), false);
  assert.equal(isSafeId(""), false);
  assert.equal(isSafeId(null), false);
});

test("extractEvents skips a publish whose url has no artifact id", () => {
  const lines = publishLine({ ts: "2026-01-01T00:00:00Z", url: "https://example.test/not-an-artifact" });
  assert.deepEqual(extractEvents(lines, ctx), []);
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

// Rule 6 + rule 4 interaction: a list event for a URL that is only known as an
// alias from a *previous* run's state must resolve to the canonical prev row,
// not become its own row (which would also re-restore the stale canonical row
// via the prev carry-over, producing a duplicate).
test("rule6/4: list on a prior-run alias url merges into the canonical prev row, not a duplicate", () => {
  const prev = {
    "uuid1": { id: "uuid1", url: "https://claude.ai/code/artifact/uuid1", aliases: ["https://claude.ai/artifact/short1"],
      title: "Widget Overview", description: "Old desc", icon: "🃏", project: "widget-lab", cwd: "/r/widget-lab",
      file: "/r/p.html", version: "v1", updatedAt: "2026-01-01T00:00:00Z", firstSeen: "2026-01-01T00:00:00Z", publishCount: 1 },
  };
  const events = [{ type: "list", ts: "2026-01-05T00:00:00Z", url: "https://claude.ai/artifact/short1", id: "short1",
    title: "Widget Overview", icon: null, updatedAt: "2026-01-05T00:00:00Z", ...ctx }];
  const rows = reduceArtifacts(events, prev);
  assert.equal(Object.keys(rows).length, 1);
  assert.ok(rows["uuid1"]);
  assert.equal(rows["uuid1"].updatedAt, "2026-01-05T00:00:00Z");
  assert.deepEqual(rows["uuid1"].aliases, ["https://claude.ai/artifact/short1"]);
});

test("rule6/5: delete via a prior-run alias url removes the canonical prev row", () => {
  const prev = {
    "uuid2": { id: "uuid2", url: "https://claude.ai/code/artifact/uuid2", aliases: ["https://claude.ai/artifact/short2"],
      title: "Widget Overview 2", description: null, icon: null, project: "widget-lab", cwd: null,
      file: null, version: "v1", updatedAt: "2026-01-01T00:00:00Z", firstSeen: "2026-01-01T00:00:00Z", publishCount: 1 },
  };
  const events = [{ type: "delete", ts: "2026-01-05T00:00:00Z", url: "https://claude.ai/artifact/short2", id: "short2" }];
  const rows = reduceArtifacts(events, prev);
  assert.equal(Object.keys(rows).length, 0);
});

// Fix round 2, finding 1: a fresh publish row must not wipe description/icon that were
// already known from prev when this run's publish event doesn't carry them.
test("fix2/1: a publish event with no description/icon falls back to prev's values", () => {
  const prev = {
    "id1": { id: "id1", url: "https://claude.ai/code/artifact/id1", aliases: [], title: "Widget Overview",
      description: "Desc A", icon: "🎨", project: "widget-lab", cwd: "/r/widget-lab", file: "/r/p.html",
      version: "v1", updatedAt: "2026-01-01T00:00:00Z", firstSeen: "2026-01-01T00:00:00Z", publishCount: 3 },
  };
  const p1 = publishLine({ ts: "2026-01-05T00:00:00Z", url: "https://claude.ai/code/artifact/id1",
    description: null, icon: null });
  const events = extractEvents(p1, ctx);
  const rows = reduceArtifacts(events, prev);
  assert.equal(rows["id1"].description, "Desc A");
  assert.equal(rows["id1"].icon, "🎨");
});

// Fix round 2, finding 2 (controller ruling): publishCount = max(prev's count, publish
// events seen this run). Must not grow across repeated runs, and must not shrink just
// because a transcript with older publishes got pruned.
test("fix2/2: publishCount does not grow when reduceArtifacts is run twice on the same events", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z", toolId: "t1" });
  const p2 = publishLine({ ts: "2026-01-01T01:00:00Z", toolId: "t2" });
  const events = extractEvents([...p1, ...p2], ctx);
  const rowsA = reduceArtifacts(events, {});
  assert.equal(rowsA["2cd570bf-705b-4632-afb2-65d4c579a09a"].publishCount, 2);
  const rowsB = reduceArtifacts(events, rowsA);
  assert.equal(rowsB["2cd570bf-705b-4632-afb2-65d4c579a09a"].publishCount, 2);
});

test("fix2/2: publishCount keeps prev's higher count when this run only has fewer publish events (pruned transcript)", () => {
  const prev = {
    "id1": { id: "id1", url: "https://claude.ai/code/artifact/id1", aliases: [], title: "Widget Overview",
      description: null, icon: null, project: "widget-lab", cwd: null, file: null, version: "v1",
      updatedAt: "2026-01-01T00:00:00Z", firstSeen: "2026-01-01T00:00:00Z", publishCount: 3 },
  };
  const p1 = publishLine({ ts: "2026-01-05T00:00:00Z", url: "https://claude.ai/code/artifact/id1" });
  const events = extractEvents(p1, ctx);
  const rows = reduceArtifacts(events, prev);
  assert.equal(rows["id1"].publishCount, 3);
});

// Fix round 2, finding 3(b): isNewer compares chronologically, not lexicographically, so
// a millisecond-precision timestamp correctly wins over a whole-second one that reads as
// "later" as a raw string, and the reverse never downgrades a more precise value.
test("fix2/3b: a list event's ms-precision updatedAt is recognized as newer than a whole-second row updatedAt", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T00:00:20Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a", title: "Widget Overview", icon: null,
    updatedAt: "2026-01-01T00:00:11.413Z", ...ctx });
  const rows = reduceArtifacts(events, {});
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].updatedAt, "2026-01-01T00:00:11.413Z");
});

test("fix2/3b: a whole-second updatedAt never downgrades a more precise, later ms-precision one", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:11.413Z" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "list", ts: "2026-01-01T00:00:20Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a", title: "Widget Overview", icon: null,
    updatedAt: "2026-01-01T00:00:11Z", ...ctx });
  const rows = reduceArtifacts(events, {});
  assert.equal(rows["2cd570bf-705b-4632-afb2-65d4c579a09a"].updatedAt, "2026-01-01T00:00:11.413Z");
});

// Fix round 3: publish(t1) -> delete -> publish(t2) in one run must not count the
// pre-delete publish toward publishCount, since the delete->publish sequence is a fresh
// recreation (matching how aliases/description/icon already reset on delete).
test("fix3: publish, then delete, then publish again in one run gives publishCount 1 from the post-delete publish only", () => {
  const p1 = publishLine({ ts: "2026-01-01T00:00:00Z", toolId: "t1", description: "Desc before delete", icon: "🕰️" });
  const p2 = publishLine({ ts: "2026-01-01T02:00:00Z", toolId: "t2", description: "Desc after delete", icon: "🌱" });
  const events = extractEvents(p1, ctx);
  events.push({ type: "delete", ts: "2026-01-01T01:00:00Z",
    url: "https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a",
    id: "2cd570bf-705b-4632-afb2-65d4c579a09a" });
  events.push(...extractEvents(p2, ctx));
  const rows = reduceArtifacts(events, {});
  const row = rows["2cd570bf-705b-4632-afb2-65d4c579a09a"];
  assert.equal(row.publishCount, 1);
  assert.equal(row.description, "Desc after delete");
  assert.equal(row.icon, "🌱");
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
