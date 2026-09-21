# seyonv.github.io: Explainers + Artifacts. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `seyonv.github.io` becomes a landing page with two doors. **Explainers** is public and gains a pipeline
that auto-syncs paper cards from `iterate_visuals_for_papers`, grouped per paper. **Artifacts** is an encrypted
gallery, private to me, of every claude.ai Artifact from my Claude Code sessions, each with a thumbnail.

**Architecture:** Two repos, both plain static sites, with no framework and no npm dependencies.
- `seyonv/explainers` keeps serving `/explainers/`. A new `sync-papers.mjs` turns each paper into a `paper-<arxiv>/`
  course folder, and `build-hub.mjs` learns the `paper` kind.
- `seyonv/seyonv.github.io` is rebuilt from an orphan `main` (the blog is archived first). It holds the landing
  page and `/artifacts/`, which is a shell page plus AES-GCM blobs. Every plaintext artifact record and thumbnail
  stays under `~/.local/share/seyonv-site/`.
- launchd timers run both publish scripts.

**Tech Stack:** Node 20+ ESM (`node:test`, `node:crypto`), vanilla HTML/CSS/JS with WebCrypto, gstack `browse`
for screenshots, macOS `sips` for resizing, launchd.

**Spec:** `docs/superpowers/specs/2026-09-21-site-two-paths-design.md` (in `seyonv.github.io`)

## Global Constraints

- No npm dependencies, no build step, and no `package.json` needed. Tests run with `node --test test/`.
- The explainers repo must never get an `.html` file in a non-dot folder unless it's an explainer, because
  `build-hub.mjs` turns every such folder into a tile. Test fixtures are created in `os.tmpdir()`.
- `iterate_visuals_for_papers/data/` is **read-only** for this work.
- Plaintext artifact data (titles, descriptions, thumbnails, the key) is **never** written inside either repo.
  The key lives at `~/.config/seyonv-site/artifacts.key` (mode 600) and state at `~/.local/share/seyonv-site/`.
- The user site must never contain an `explainers/` path, because it would shadow the project page.
- Design tokens are the same as `explainers/hub-template.html` (`--bg #fbfbf9`, `--accent #4a9d77`, and so on,
  plus the dark-mode block). Pages must work at 390px width.
- Git: no Claude/AI attribution in commits. **Pushing to `seyonv.github.io` and changing its Pages or visibility
  settings needs my confirmation**, one checkpoint in Task 1. Pushing the explainers repo through `publish.sh`
  is already allowed.
- Never force-push.

---

## Task 1: Archive the Jekyll blog and create the new `main` for the site repo

**Files (in `~/Desktop/repos/seyonv.github.io`):**
- Create: `.nojekyll`, `.gitignore`, `index.html` (a temporary landing page, finished in Task 8), `README.md`
- Create: `docs/superpowers/specs/2026-09-21-site-two-paths-design.md`, `docs/superpowers/plans/2026-09-21-site-two-paths-plan.md` (copied from the scratchpad)

**Interfaces:** Produces the branch `main` with the layout the later tasks write into.

- [ ] **Step 1: Save the dirty tree on an archive branch**

```bash
cd ~/Desktop/repos/seyonv.github.io
git switch -c archive/jekyll-blog-2026
printf 'vendor/\n.bundle/\n' >> .gitignore
git add -A && git commit -q -m "Archive: local Jekyll rebuild state from May 2026"
git tag jekyll-blog-final master
git status --short | wc -l   # expect 0
```

- [ ] **Step 2: Create an orphan `main` with the new skeleton**

```bash
git switch --orphan main
git rm -rq --cached . && git clean -fdxq -e vendor -e .bundle
touch .nojekyll
printf '.DS_Store\nvendor/\n.bundle/\n' > .gitignore
mkdir -p docs/superpowers/specs docs/superpowers/plans artifacts/data scripts/lib test launchd
cp <scratchpad>/2026-09-21-site-two-paths-design.md docs/superpowers/specs/
cp <scratchpad>/2026-09-21-site-two-paths-plan.md docs/superpowers/plans/
```

`index.html` (temporary) contains a minimal page with a single link to `/explainers/`, so the root is never a 404
between tasks. `README.md` gives a 10-line description of the layout, the scripts, and where the key and state
live.

- [ ] **Step 3: Commit, then CHECKPOINT with me before any push**

```bash
git add -A && git commit -q -m "New site: landing page skeleton"
```

Ask me to confirm pushing `archive/jekyll-blog-2026`, the tag and `main`, then enabling Pages and switching the
default branch.

- [ ] **Step 4: Push and enable Pages**

```bash
git push -q origin archive/jekyll-blog-2026 jekyll-blog-final
git push -q -u origin main
gh api -X PATCH repos/seyonv/seyonv.github.io -f default_branch=main
gh api -X POST repos/seyonv/seyonv.github.io/pages -f 'source[branch]=main' -f 'source[path]=/'
```

If the Pages POST fails with a plan or visibility error, **stop**. Tell me, and follow the Free-plan route from
the spec (archive repo, then make public) only after I say so.

- [ ] **Step 5: Verify.** Within about 2 minutes, `curl -sI https://seyonv.github.io/` returns 200 and
  `curl -sI https://seyonv.github.io/explainers/` still returns 200.

---

## Task 2: Paper library, pure functions (explainers repo)

**Files:**
- Create: `~/Desktop/repos/explainers/papers-lib.mjs`
- Test: `~/Desktop/repos/explainers/test/papers-lib.test.mjs`

**Interfaces, produces:**
- `arxivId(sourceValue: string): string|null`, e.g. `"https://arxiv.org/pdf/2305.01210.pdf"` → `"2305.01210"`
- `folderName(paper): string` → `"paper-2305-01210"`, or `"paper-" + paper.id` when there's no arXiv id
- `selectCards(cardsJson, fileNames: string[]): {slug, title, file}[]`: only cards with `status === "ready"`
  whose `<slug>.html` exists, in `cards.json` order, with the overview first
- `explainerJson(paper, cards): {title, description, date, kind: "paper", source, cards: n}`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { arxivId, folderName, selectCards, explainerJson } from "../papers-lib.mjs";

const paper = { id: "20260913-2305-01210-gp2n", title: "Is Your Code Generated by ChatGPT Really Correct?",
  authors: ["Jiawei Liu", "Chunqiu Steven Xia", "Yuyao Wang", "Lingming Zhang"],
  source: { kind: "url", value: "https://arxiv.org/pdf/2305.01210.pdf" }, addedAt: "2026-09-13T20:58:34.402Z" };

test("arxivId handles pdf, abs, versioned, and non-arxiv", () => {
  assert.equal(arxivId("https://arxiv.org/pdf/2305.01210.pdf"), "2305.01210");
  assert.equal(arxivId("https://arxiv.org/abs/2107.03374v2"), "2107.03374");
  assert.equal(arxivId("/Users/me/paper.pdf"), null);
});

test("folderName prefers arxiv id, falls back to paper id", () => {
  assert.equal(folderName(paper), "paper-2305-01210");
  assert.equal(folderName({ ...paper, source: { value: "x.pdf" } }), "paper-20260913-2305-01210-gp2n");
});

test("selectCards: ready only, file must exist, overview first, revisions ignored", () => {
  const cards = { cards: [
    { slug: "pass-at-k", title: "pass@k", kind: "concept", status: "ready" },
    { slug: "_overview", title: "Overview", kind: "overview", status: "ready" },
    { slug: "drafting", title: "Drafting", kind: "concept", status: "generating" },
    { slug: "ghost", title: "Ghost", kind: "concept", status: "ready" },
  ] };
  const files = ["_overview.html", "pass-at-k.html", "pass-at-k.v1.html", "drafting.html"];
  assert.deepEqual(selectCards(cards, files).map((c) => c.file), ["_overview.html", "pass-at-k.html"]);
});

test("explainerJson builds description from authors and arxiv", () => {
  const j = explainerJson(paper, [{}, {}, {}]);
  assert.equal(j.kind, "paper");
  assert.equal(j.date, "2026-09-13");
  assert.equal(j.description, "Jiawei Liu, Chunqiu Steven Xia, Yuyao Wang et al. · arXiv 2305.01210");
  assert.equal(j.source, "https://arxiv.org/abs/2305.01210");
  assert.equal(j.cards, 3);
});
```

- [ ] **Step 2:** Run `cd ~/Desktop/repos/explainers && node --test test/`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// Pure helpers for turning an iterate_visuals_for_papers paper into a hub course folder.
export function arxivId(src = "") {
  if (!/arxiv\.org/.test(src)) return null;
  return src.match(/(\d{4}\.\d{4,5})(v\d+)?/)?.[1] || null;
}

export function folderName(paper) {
  const id = arxivId(paper.source?.value);
  return "paper-" + (id ? id.replace(".", "-") : paper.id);
}

export function selectCards(cardsJson, fileNames) {
  const have = new Set(fileNames);
  const ready = (cardsJson.cards || []).filter((c) => c.status === "ready" && have.has(`${c.slug}.html`));
  ready.sort((a, b) => (b.kind === "overview") - (a.kind === "overview"));
  return ready.map((c) => ({ slug: c.slug, title: c.title, file: `${c.slug}.html` }));
}

export function explainerJson(paper, cards) {
  const id = arxivId(paper.source?.value);
  const a = paper.authors || [];
  const who = a.length > 3 ? a.slice(0, 3).join(", ") + " et al." : a.join(", ");
  return {
    title: paper.title,
    description: [who, id && `arXiv ${id}`].filter(Boolean).join(" · "),
    date: (paper.addedAt || "").slice(0, 10),
    kind: "paper",
    source: id ? `https://arxiv.org/abs/${id}` : paper.source?.value || null,
    cards: cards.length,
  };
}
```

- [ ] **Step 4:** Run `node --test test/`. Expected: 4 pass.
- [ ] **Step 5:** Commit with `git add papers-lib.mjs test && git commit -m "Paper helpers for syncing paper cards"`.

---

## Task 3: `sync-papers.mjs` and the paper gallery template (explainers repo)

**Files:**
- Create: `sync-papers.mjs`, `paper-template.html`
- Test: `test/sync-papers.test.mjs`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `syncPapers({ src, dest }): { written: string[], removed: string[] }`. Running the CLI with no
  arguments uses `src = ~/Desktop/repos/iterate_visuals_for_papers/data/papers` and `dest =` the repo root, then
  prints a summary.

**`paper-template.html`** is a copy of `llm-latency/index.html` with these changes:
- `<title>` and `<h1>` become `<!--TITLE-->`.
- The `.sub` paragraph becomes `<!--SUB-->`, which the script fills with: authors, then an arXiv link, then
  "N cards, click any card to read it here; use ← → to page through."
- `const GROUPS = /*GROUPS*/[];` is filled with the overview under "Start here" (big tile), followed by
  "Concepts" containing the rest, each as `[file, title, ""]`.
- A `<a class="back" href="../">← All explainers</a>` link sits above the `<h1>`.
- The meta `<span>` is hidden when the description is empty.

- [ ] **Step 1: Write the failing test.** It builds a fake `src` in `os.tmpdir()` with two papers that both have
  a `pass-at-k.html` card, one `.v1.html` revision, and one card with status `generating`. It then asserts:
  - `dest/paper-2305-01210/` contains exactly `_overview.html`, `pass-at-k.html`, `index.html` and `explainer.json`
  - the other paper's `pass-at-k.html` is written to its own folder
  - `index.html` contains the paper title and `"_overview.html"` before `"pass-at-k.html"`
  - a second run returns `written: []`, so it's idempotent
  - after deleting a paper from `src`, the next run removes its folder, and a hand-made `dest/llm-latency/`
    folder is untouched

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncPapers } from "../sync-papers.mjs";

function paperDir(src, id, arxiv, cards) {
  const d = join(src, id); mkdirSync(join(d, "cards"), { recursive: true });
  writeFileSync(join(d, "paper.json"), JSON.stringify({ id, title: `Paper ${arxiv}`, authors: ["A B"],
    source: { kind: "url", value: `https://arxiv.org/pdf/${arxiv}.pdf` }, addedAt: "2026-09-13T00:00:00Z" }));
  writeFileSync(join(d, "cards.json"), JSON.stringify({ cards }));
  for (const c of cards) writeFileSync(join(d, "cards", `${c.slug}.html`), `<h1>${c.title}</h1>`);
  return d;
}

test("syncPapers groups per paper, filters, is idempotent, and prunes", () => {
  const src = mkdtempSync(join(tmpdir(), "src-")), dest = mkdtempSync(join(tmpdir(), "dest-"));
  mkdirSync(join(dest, "llm-latency")); writeFileSync(join(dest, "llm-latency", "index.html"), "keep");
  const cards = [
    { slug: "pass-at-k", title: "pass@k", kind: "concept", status: "ready" },
    { slug: "_overview", title: "Overview", kind: "overview", status: "ready" },
    { slug: "wip", title: "WIP", kind: "concept", status: "generating" },
  ];
  const a = paperDir(src, "20260913-2305-01210-gp2n", "2305.01210", cards);
  writeFileSync(join(a, "cards", "pass-at-k.v1.html"), "old");
  paperDir(src, "20260911-2107-03374-9244", "2107.03374", cards.slice(0, 2));

  const r1 = syncPapers({ src, dest });
  assert.deepEqual(r1.written.sort(), ["paper-2107-03374", "paper-2305-01210"]);
  assert.deepEqual(readdirSync(join(dest, "paper-2305-01210")).sort(),
    ["_overview.html", "explainer.json", "index.html", "pass-at-k.html"]);
  const idx = readFileSync(join(dest, "paper-2305-01210", "index.html"), "utf8");
  assert.ok(idx.includes("Paper 2305.01210"));
  assert.ok(idx.indexOf('"_overview.html"') < idx.indexOf('"pass-at-k.html"'));

  assert.deepEqual(syncPapers({ src, dest }).written, []);

  rmSync(a, { recursive: true });
  assert.deepEqual(syncPapers({ src, dest }).removed, ["paper-2305-01210"]);
  assert.ok(!existsSync(join(dest, "paper-2305-01210")));
  assert.equal(readFileSync(join(dest, "llm-latency", "index.html"), "utf8"), "keep");
});
```

- [ ] **Step 2:** Run `node --test test/`. Expected: FAIL.
- [ ] **Step 3: Implement `sync-papers.mjs`**

```js
#!/usr/bin/env node
// Mirrors iterate_visuals_for_papers papers into paper-<arxiv>/ course folders. Reads the source, never writes it.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { folderName, selectCards, explainerJson } from "./papers-lib.mjs";

const here = new URL(".", import.meta.url).pathname;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderIndex(paper, meta, cards) {
  const [first, ...rest] = cards;
  const groups = [["Start here", true, first ? [[first.file, first.title, ""]] : []],
                  ["Concepts", false, rest.map((c) => [c.file, c.title, ""])]];
  const src = meta.source ? ` · <a href="${esc(meta.source)}">${esc(meta.description.split(" · ").pop())}</a>` : "";
  const sub = `${esc((paper.authors || []).join(", "))}${src}. ${cards.length} cards: click any card to read it here; use ← → to page through.`;
  return readFileSync(join(here, "paper-template.html"), "utf8")
    .replaceAll("<!--TITLE-->", esc(paper.title))
    .replace("<!--SUB-->", sub)
    .replace("/*GROUPS*/[]", JSON.stringify(groups));
}

// Writes only when bytes differ; returns true if anything changed.
function put(path, data) {
  if (existsSync(path) && readFileSync(path).equals(Buffer.from(data))) return false;
  writeFileSync(path, data); return true;
}

export function syncPapers({ src, dest }) {
  const written = [], removed = [], keep = new Set();
  for (const id of existsSync(src) ? readdirSync(src).sort() : []) {
    const dir = join(src, id);
    if (!existsSync(join(dir, "paper.json")) || !existsSync(join(dir, "cards.json"))) continue;
    const paper = JSON.parse(readFileSync(join(dir, "paper.json"), "utf8"));
    const cards = selectCards(JSON.parse(readFileSync(join(dir, "cards.json"), "utf8")), readdirSync(join(dir, "cards")));
    if (!cards.length) continue;
    const name = folderName(paper), out = join(dest, name), meta = explainerJson(paper, cards);
    keep.add(name); mkdirSync(out, { recursive: true });
    const want = new Set(["index.html", "explainer.json", ...cards.map((c) => c.file)]);
    let changed = false;
    for (const f of readdirSync(out)) if (!want.has(f)) { rmSync(join(out, f)); changed = true; }
    for (const c of cards) changed = put(join(out, c.file), readFileSync(join(dir, "cards", c.file))) || changed;
    changed = put(join(out, "explainer.json"), JSON.stringify(meta, null, 2) + "\n") || changed;
    changed = put(join(out, "index.html"), renderIndex(paper, meta, cards)) || changed;
    if (changed) written.push(name);
  }
  for (const f of readdirSync(dest)) {
    if (f.startsWith("paper-") && !keep.has(f)) { rmSync(join(dest, f), { recursive: true }); removed.push(f); }
  }
  return { written, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = syncPapers({ src: join(homedir(), "Desktop/repos/iterate_visuals_for_papers/data/papers"), dest: here });
  console.log(`papers: ${r.written.length} updated${r.written.length ? " (" + r.written.join(", ") + ")" : ""}, ${r.removed.length} removed`);
}
```

- [ ] **Step 4:** Create `paper-template.html` from `llm-latency/index.html` with the substitutions listed above.
  Add `.back{font-size:14px;color:var(--muted);text-decoration:none}`. Run `node --test test/`. Expected: all pass.
- [ ] **Step 5:** Run the real sync with `node sync-papers.mjs`. Expected output: `papers: 2 updated (paper-2107-03374, paper-2305-01210), 0 removed`.
  Open `paper-2305-01210/index.html` with `/browse`, check that 12 tiles render and that ← → pages through.
- [ ] **Step 6:** Commit with `git commit -m "Sync paper cards into per-paper course folders"`.

---

## Task 4: The hub learns about papers (explainers repo)

**Files:**
- Modify: `build-hub.mjs`: add kind `paper` and write `hub.json`
- Modify: `hub-template.html`: add the Papers chip, the paper badge and the back link
- Modify: `publish.sh`: run `node sync-papers.mjs` before `build-hub.mjs`
- Modify: `README.md`: document papers and sync
- Create: `launchd/com.seyonv.explainers-sync.plist`

**Interfaces:** Produces `hub.json` in the form `{"explainers": n, "papers": p, "cards": c}`, which the Task 8
landing page reads from `/explainers/hub.json`.

- [ ] **Step 1: Change `build-hub.mjs`.** The kind becomes
  `override.kind === "paper" ? "paper" : isCurriculum ? "curriculum" : "single"`. Keep the preview logic, which
  already picks `_overview.html`. After writing `index.html`:

```js
writeFileSync(join(root, "hub.json"), JSON.stringify({
  explainers: entries.length,
  papers: entries.filter((e) => e.kind === "paper").length,
  cards: entries.reduce((n, e) => n + e.cards, 0),
}) + "\n");
```

- [ ] **Step 2: Change `hub-template.html`.**
  - Add the chip `<button class="chip" data-kind="paper" aria-pressed="false">Papers</button>` after Courses.
  - Change the badge expression to `e.kind === "paper" ? "Paper · " + e.cards + " cards" : e.kind === "curriculum" ? e.cards + " cards" : "Single card"`,
    using class `cur` for both paper and curriculum.
  - Add `<a class="back" href="/">← seyonv.github.io</a>` above the `<h1>`.
  - Change the `.sub` copy to add "Papers group every card made from one paper."

- [ ] **Step 3: Change `publish.sh`.** Insert `node sync-papers.mjs` on the line before `node build-hub.mjs`.
  Change the commit message to `Publish ${1:-explainers}`, which stays the same.

- [ ] **Step 4: Add the launchd plist.** Label `com.seyonv.explainers-sync`. ProgramArguments are
  `/bin/bash -lc "cd ~/Desktop/repos/explainers && ./publish.sh papers"`, with `StartInterval 1800`,
  `RunAtLoad true`, and stdout/stderr going to `~/Library/Logs/seyonv-site/explainers-sync.log`. It is installed
  in Task 10.

- [ ] **Step 5: Verify.**
  - Run `node --test test/`, which should pass.
  - Run `node build-hub.mjs`. Expected: `index.html: 6 entries (…paper-2107-03374, paper-2305-01210…)`.
  - `cat hub.json` should show `papers: 2`.
  - Check `index.html` in `/browse`: the Papers chip should filter down to 2 tiles, and a paper tile should open
    its gallery.

- [ ] **Step 6: Publish** with `./publish.sh papers`. This is allowed without asking. Then check
  `https://seyonv.github.io/explainers/` live with `/browse`.

---

## Task 5: Transcript → artifact records, pure functions (site repo)

**Files:**
- Create: `scripts/lib/artifacts.mjs`
- Test: `test/artifacts.test.mjs`

**Interfaces, produces:**
- `extractEvents(lines: string[], ctx: {project, session}): Event[]`, where each event is one of:
  - `{type:"publish", key, ts, url, id, title, version, file, description, icon, cwd}`
  - `{type:"list", ts, url, id, title, icon, updatedAt}`
  - `{type:"delete", ts, url, id}`
- `artifactId(url): string`: the UUID for `/code/artifact/<uuid>`, or the short id for `/artifact/<id>`.
- `reduceArtifacts(events: Event[], prev: Record<id,Row>): Record<id,Row>`. A row is
  `{id, url, aliases[], title, description, icon, project, cwd, file, version, updatedAt, firstSeen, publishCount, thumb?}`.

Rules, all tested:
1. A publish is a `tool_use` named `Artifact` whose `input.action` is missing or `"publish"`, with no
   `input.asset`, and whose matching `tool_result` (joined by `tool_use_id`) has `is_error` false and a
   `toolUseResult.url`.
2. Description and icon come from the `tool_use` input (`icon ?? favicon`). The latest publish wins for title,
   version, file, updatedAt and cwd. Description and icon fall back to the most recent publish that had them.
   `publishCount` counts publish events.
3. List rows add artifacts that aren't known yet. For known ones they only raise `updatedAt`.
4. A list row with a short-id URL whose title equals an existing row's title, with `updatedAt` within 15 minutes
   of that row's `updatedAt`, becomes an alias of that row.
5. A delete removes the row, including when the row matches through an alias. A publish that comes after the
   delete brings it back.
6. `prev` rows missing from the current events are kept, so artifacts stay after their transcripts are pruned,
   unless they were deleted in the current events. `prev[id].thumb` is always carried over.
7. Output is the same for the same input, so running it twice gives equal JSON.

- [ ] **Step 1: Write the failing tests.** Fixture lines copy the real shapes, e.g.
  `{"type":"assistant","timestamp":"…","cwd":"/r/poker","message":{"content":[{"type":"tool_use","id":"t1","name":"Artifact","input":{"file_path":"/r/p.html","description":"D","favicon":"🃏"}}]}}` and
  `{"type":"user","timestamp":"…","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"Published …"}]},"toolUseResult":{"url":"https://claude.ai/code/artifact/2cd570bf-705b-4632-afb2-65d4c579a09a","artifact_id":"2cd5…","title":"Master Plan","version":"v1","path":"/r/p.html"}}`.
  Write one test per rule 1–7, plus:
  - a failed publish (`is_error: true`) is ignored
  - a `read` action is ignored
  - a malformed JSON line is skipped, not thrown

- [ ] **Step 2:** Run `node --test test/`. Expected: FAIL.

- [ ] **Step 3: Implement**

```js
// Turns Claude Code transcript lines into claude.ai artifact records. Pure: no fs, no clock.
export function artifactId(url) {
  return url.match(/\/artifact\/([^/?#]+)/)?.[1] || url;
}

export function extractEvents(lines, ctx) {
  const uses = new Map(), events = [];
  for (const line of lines) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    const content = d?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type === "tool_use" && c.name === "Artifact") uses.set(c.id, { input: c.input || {}, cwd: d.cwd });
      if (c.type !== "tool_result" || c.is_error || !uses.has(c.tool_use_id)) continue;
      const { input, cwd } = uses.get(c.tool_use_id), r = d.toolUseResult || {}, ts = d.timestamp;
      const action = input.action || "publish";
      if (action === "publish" && !input.asset && r.url) {
        events.push({ type: "publish", key: c.tool_use_id, ts, url: r.url, id: artifactId(r.url), title: r.title || input.title || null,
          version: r.version || null, file: r.path || input.file_path || null, description: input.description || null,
          icon: input.icon || input.favicon || null, cwd: cwd || null, ...ctx });
      } else if (action === "list" && Array.isArray(r.artifacts)) {
        for (const a of r.artifacts) events.push({ type: "list", ts, url: a.url, id: artifactId(a.url), title: a.title,
          icon: a.favicon || null, updatedAt: a.updatedAt, ...ctx });
      } else if (action === "delete" && r.artifact_delete?.url) {
        events.push({ type: "delete", ts, url: r.artifact_delete.url, id: artifactId(r.artifact_delete.url) });
      }
    }
  }
  return events;
}

const near = (a, b) => a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= 15 * 60e3;

export function reduceArtifacts(events, prev = {}) {
  const rows = {}, alias = {}, deleted = new Set();
  const sorted = [...events].sort((a, b) => (a.ts || "").localeCompare(b.ts || "") || (a.type === "list") - (b.type === "list"));
  for (const e of sorted) {
    const id = alias[e.id] || e.id;
    if (e.type === "publish") {
      const r = rows[id] || { id, url: e.url, aliases: [], description: null, icon: null, publishCount: 0, firstSeen: e.ts };
      Object.assign(r, { title: e.title || r.title, version: e.version, file: e.file, updatedAt: e.ts, cwd: e.cwd,
        project: e.project, description: e.description || r.description, icon: e.icon || r.icon });
      r.publishCount++; rows[id] = r;
    } else if (e.type === "list") {
      if (rows[id]) { if ((e.updatedAt || "") > (rows[id].updatedAt || "")) rows[id].updatedAt = e.updatedAt; continue; }
      const twin = Object.values(rows).find((r) => r.title === e.title && near(r.updatedAt, e.updatedAt));
      if (twin) { alias[e.id] = twin.id; if (!twin.aliases.includes(e.url)) twin.aliases.push(e.url); continue; }
      rows[id] = { id, url: e.url, aliases: [], title: e.title, description: null, icon: e.icon, project: e.project, cwd: null,
        file: null, version: null, updatedAt: e.updatedAt, firstSeen: e.ts, publishCount: 0 };
    } else if (e.type === "delete") {
      delete rows[id]; deleted.add(id);
    }
  }
  for (const [id, r] of Object.entries(prev)) {
    if (!rows[id] && !deleted.has(id) && !Object.values(rows).some((x) => x.aliases.includes(r.url))) rows[id] = r;
    else if (rows[id] && r.thumb) rows[id].thumb = r.thumb;
  }
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
}
```

(A publish that comes after a delete recreates the row because the loop processes events in order. The
`deleted` set only suppresses carrying the row over from `prev`.)

- [ ] **Step 4:** Run `node --test test/`. Expected: all pass.
- [ ] **Step 5:** Commit with `git commit -m "Parse artifact publishes from session transcripts"`.

---

## Task 6: `sync-artifacts.mjs` CLI (site repo)

**Files:** Create `scripts/sync-artifacts.mjs` and `scripts/lib/paths.mjs`.

**Interfaces:**
- `paths.mjs` exports `STATE_DIR = ~/.local/share/seyonv-site`, `STATE = STATE_DIR/artifacts.json`,
  `THUMBS = STATE_DIR/thumbs`, `SEALED = STATE_DIR/sealed.json`, `KEY = ~/.config/seyonv-site/artifacts.key`,
  and `REPO = the repo root`.
- The CLI reads every `~/.claude/projects/*/*.jsonl` and `*/*/subagents/*.jsonl`. `project` is the directory
  name with `-Users-seyonvasantharajan-Desktop-repos-` stripped (a leftover `-Users-seyonvasantharajan-Desktop-repos`
  becomes `repos`), and `session` is the file's basename. It calls `extractEvents` per file and `reduceArtifacts`
  over all events together with the previous state, then writes STATE atomically (tmp file, then rename). It
  prints `artifacts: N total (+A new, ~U updated, -D removed)`.
- Title fallback: if the row has a `file` that exists and its `<title>` is non-empty, set
  `row.localTitle = that title`. Show `localTitle || title`.

- [ ] **Step 1:** Implement it as described. Files are read with `readFileSync(...).split("\n")`, which is fine
  at the current transcript size.
- [ ] **Step 2: Verify against the real data.** Run `node scripts/sync-artifacts.mjs`.
  - Expected: roughly 95–106 total. The exact number depends on aliasing.
  - Cross-check against `<scratchpad>/artifacts-found.json` with a one-off `node -e`: every non-deleted URL there
    should be either a row id or an alias in STATE.
  - `"Asinus pokerensis — Story Plan"` should be absent.
  - Run a second time. Expected: `+0 new, ~0 updated`.
- [ ] **Step 3:** Commit. State is outside the repo, so only the scripts are committed.

---

## Task 7: Encryption: seal library, `seal.mjs`, `unlock.mjs` (site repo)

**Files:**
- Create: `scripts/lib/seal.mjs`, `scripts/seal.mjs`, `scripts/unlock.mjs`
- Test: `test/seal.test.mjs`

**Interfaces, produces:**
- `newKey(): Buffer` (32 random bytes)
- `sealBytes(key, plain: Buffer): Buffer`, laid out as `iv(12) || ciphertext || tag(16)`. This matches the
  WebCrypto AES-GCM `decrypt({iv}, key, ct||tag)`.
- `openBytes(key, blob): Buffer`
- `blobName(key, id): string` = hex HMAC-SHA256(key, id), first 24 chars
- `b64url(buf)`, `fromB64url(str)`
- Encrypted files on disk: `artifacts/data/manifest.enc` and `artifacts/data/<blobName>.enc`
- The decrypted manifest is JSON `{generatedAt, artifacts: [{id, url, title, description, icon, project, updatedAt, publishCount, thumb: "<blobName>"|null}]}`, sorted by `updatedAt` descending.

- [ ] **Step 1: Write the failing tests.**
  - seal then open round-trips.
  - A tampered byte makes `openBytes` throw.
  - `blobName` is stable for the same key and id, and differs across keys.
  - The Node-sealed blob decrypts with `globalThis.crypto.subtle` (the WebCrypto path the browser uses). This
    proves the byte layout.
  - A leak check: seal a manifest containing the title `"Blackbird / Flycar — Interview Reference"` and assert
    that no `.enc` output contains `"Blackbird"` as bytes.
- [ ] **Step 2:** Run `node --test test/`. Expected: FAIL.
- [ ] **Step 3: Implement `lib/seal.mjs`**

```js
import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
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
```

- [ ] **Step 4: `scripts/seal.mjs`.**
  - Load KEY, creating it with mode 600 if it's missing. `--rotate` replaces it and clears SEALED.
  - Build the manifest from STATE, keeping only public fields and using `localTitle || title`.
  - For each thumbnail in `THUMBS/<id>.jpg`, set `thumb = blobName(key, id)`.
  - For every output (manifest plus thumbnails), compute sha256 of the plaintext. Skip it when SEALED already
    has that hash and the `.enc` file exists. Otherwise seal, write, and record the hash.
  - Delete any `artifacts/data/*.enc` not produced in this run, and save SEALED.
  - Print `sealed: W written, S unchanged, R removed`.
  - The manifest's `generatedAt` is taken as the max `updatedAt`, not the current time, so an unchanged state
    gives an unchanged plaintext hash and nothing is rewritten.
- [ ] **Step 5: `scripts/unlock.mjs`.** It prints `https://seyonv.github.io/artifacts/#k=<b64url(key)>`. With
  `--open` it runs `open "<url>"`. With `--local` it uses `http://localhost:8080/artifacts/#k=…` for testing.
- [ ] **Step 6:** Run `node --test test/`. Expected: all pass. Run `node scripts/seal.mjs` twice; the second run
  should print `0 written`. Commit.

---

## Task 8: The gallery page and the landing page (site repo)

**Files:**
- Create: `artifacts/index.html`
- Modify: `index.html` (the final landing page)

**`artifacts/index.html` behaviour:**
1. On load:
   - If `location.hash` starts with `#k=`, store the value in `localStorage["seyonv-artifacts-key"]` (inside
     try/catch), then call `history.replaceState` to drop the fragment.
   - Read the key. If there isn't one, show the lock screen: a 🔒 icon, "Private gallery", a paste-key input and
     an Unlock button. Nothing else is fetched.
2. Import the key with `crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"])`, then
   `fetch("data/manifest.enc", {cache: "no-cache"})` and decrypt it:
   `crypto.subtle.decrypt({name: "AES-GCM", iv: buf.slice(0, 12)}, key, buf.slice(12))`.
   - If decrypting fails, the key is wrong. Clear it and show the lock screen with "That key didn't work."
3. Render a header: "Artifacts", "N artifacts · private", a "Lock this browser" button (which clears
   localStorage), and "← seyonv.github.io".
4. Controls: a search box covering title, description and project, project filter chips (the top 8 projects by
   count, plus All), and a sort select (Newest / Most edited).
5. Tiles use the hub's tile styles, with a 16:10 thumbnail area. The `<img>` src is a blob URL from the decrypted
   `data/<thumb>.enc`, loaded lazily through an IntersectionObserver that allows at most 6 concurrent fetches.
   When there's no thumbnail, show a placeholder with the emoji at 48px on `--surface2` and the title under it.
6. Tile meta: emoji plus title, a two-line clamped description, and a tags row with the project badge, date and
   "N edits" when there's more than one. Each tile is an `<a href=url target=_blank rel=noopener>`.
7. Set `<meta name="robots" content="noindex">`.

**`index.html` landing page:**
- Name "Seyon Vasantharajan" with a one-line subtitle, then two large door cards:
  - **Explainers:** "Visual notes cards on technical concepts and papers", followed by live counts from
    `fetch("/explainers/hub.json")`, e.g. "6 explainers · 2 papers · 53 cards". The counts are omitted if the
    fetch fails. Links to `/explainers/`.
  - **Artifacts:** "Pages Claude has built with me". It shows "🔓 Unlocked on this browser" or "🔒 Private",
    based on whether the localStorage key is set. Links to `/artifacts/`.
- Same tokens and dark mode as the hub, with the cards stacked at 390px wide.

- [ ] **Step 1:** Write both pages.
- [ ] **Step 2: Verify locally.** Run `python3 -m http.server 8080` in the repo root, then run
  `node scripts/unlock.mjs --local`. With `/browse`:
  - Without a key, `/artifacts/` shows only the lock screen, and the network log shows no fetch of
    `manifest.enc`.
  - After the unlock URL, tiles render with the correct count, search filters them, and the fragment has been
    removed from the URL.
  - Lock, then reload: the lock screen comes back.
  - A wrong pasted key shows the error.
  - Take screenshots at 390px and 1280px in light and dark mode. This works without thumbnails for now: the
    tiles show placeholders.
- [ ] **Step 3:** Commit.

---

## Task 9: Thumbnails (site repo)

**Files:** Create `scripts/thumbs.mjs`.

**Interfaces:**
- Reads STATE and writes `THUMBS/<id>.jpg` (640px wide).
- Sets `row.thumb = {ver, kind: "local"|"remote"|"placeholder", at}` in STATE, where `ver = version || updatedAt`.
- Flags: `--only <id>`, `--force`, `--no-remote`.

Behaviour:
- `B=~/.claude/skills/gstack/browse/dist/browse`. Check the exact binary path in Step 1.
- A row needs a capture when it has no thumbnail, `thumb.ver !== ver`, `thumb.kind === "placeholder"`, or
  `--force` is set.
- **Local:** used when `row.file` exists. Serve `dirname(file)` with a throwaway `python3 -m http.server` on a
  free port (file:// can be blocked, and relative assets need a server). Then
  `$B viewport 1280x800 && $B goto http://127.0.0.1:<port>/<basename> && $B wait 1500 && $B screenshot <tmp>.png`,
  followed by `sips -s format jpeg -s formatOptions 80 -Z 640 <tmp>.png --out THUMBS/<id>.jpg`.
- **Remote:** `$B goto <url>`, then wait up to 8s for an `iframe`, then `$B screenshot <tmp>.png --selector iframe`.
  - If the final URL contains `/login`, or there's no iframe, record `placeholder`, print
    `needs claude.ai login: run the cookie import`, and stop trying remote captures for the rest of the run.
- Commands run sequentially with `execFileSync` and a 30s timeout each. A failure marks that row `placeholder`
  and the run continues.
- Prints `thumbs: L local, R remote, P placeholder, K kept`.

- [ ] **Step 1:** Probe the tools: `$B goto https://example.com && $B screenshot /tmp/x.png`, then `sips` on the
  result. Fix the binary path if it differs.
- [ ] **Step 2:** Implement, then run `node scripts/thumbs.mjs --no-remote`. Expected: about 42 local captures.
  Look at 3 of the JPEGs.
- [ ] **Step 3: Remote captures.** Run `/setup-browser-cookies claude.ai`. This is interactive: I click
  "Always Allow" in Keychain. Then run `node scripts/thumbs.mjs`. Expected: most of the remaining rows are
  captured remotely. Look at 3 remote JPEGs to confirm they show the artifact and not claude.ai's page chrome. If
  they include chrome, switch the selector to the artifact iframe's specific attribute found with `$B snapshot`.
- [ ] **Step 4:** Run `node scripts/seal.mjs`, reload the local gallery, and confirm the thumbnails render.
  Commit (scripts only).

---

## Task 10: `publish.sh`, the launchd jobs, and going live (site repo + explainers repo)

**Files:**
- Create: `seyonv.github.io/publish.sh`, `seyonv.github.io/launchd/com.seyonv.artifacts-sync.plist`, and
  `seyonv.github.io/scripts/install-launchd.sh`, which installs both plists (this one and the one from the
  explainers repo).

`publish.sh`:

```bash
#!/usr/bin/env bash
# Sync artifacts from transcripts, refresh thumbnails, seal, commit and push.
set -euo pipefail
cd "$(dirname "$0")"
node scripts/sync-artifacts.mjs
node scripts/thumbs.mjs || echo "thumbs: failed, keeping previous thumbnails"
node scripts/seal.mjs
git add -A artifacts index.html
if git diff --cached --quiet; then echo "Nothing new to publish."; exit 0; fi
git commit -q -m "Update artifacts"
git push -q
echo "Pushed. Live in about a minute at https://seyonv.github.io/artifacts/"
```

- The artifacts plist runs `/bin/bash -lc "cd ~/Desktop/repos/seyonv.github.io && ./publish.sh"` with
  `StartInterval 7200`, `RunAtLoad true`, and logs in `~/Library/Logs/seyonv-site/artifacts-sync.log`.
- `install-launchd.sh`:
  - creates the log directory
  - copies both plists to `~/Library/LaunchAgents/`
  - runs `launchctl bootout gui/$UID/<label> 2>/dev/null; launchctl bootstrap gui/$UID <plist>` for each
  - runs `launchctl print gui/$UID/<label> | grep -E "state|last exit"`

- [ ] **Step 1:** Write the files and run `./publish.sh` manually. This is the first artifacts push to the site
  repo, and pushing there was confirmed in Task 1.
- [ ] **Step 2: Plaintext leak check on the pushed tree.** Take 5 real titles from STATE and run
  `git grep -I -l -F "<title>"` for each across the repo (skipping `docs/`). Expected: no matches. Also confirm
  that `git ls-files` doesn't list `*.jpg` or `artifacts.json`.
- [ ] **Step 3:** Run `scripts/install-launchd.sh`, then `launchctl kickstart gui/$UID/com.seyonv.artifacts-sync`.
  Check the log for `Nothing new to publish.`
- [ ] **Step 4:** Commit and push the plists, the installer and the README update.

---

## Task 11: End-to-end verification on the live site

- [ ] With `/browse` on the live site:
  - `https://seyonv.github.io/` shows both doors, with the Explainers counts filled in.
  - `/explainers/` has the Papers chip showing 2 tiles. The EvalPlus paper opens a gallery with 12 cards, and
    ← → works.
  - `/artifacts/` in a fresh browse session shows the lock screen and fetches no manifest.
  - Open the `unlock.mjs` URL: the gallery renders about 100 tiles with thumbnails, search works, and a tile's
    href is its claude.ai URL.
  - Take screenshots at 390px and 1280px, in light and dark mode, for the landing page, a paper gallery and the
    artifacts gallery.
- [ ] Pipeline check:
  - Add no data, run `explainers/publish.sh papers`, and expect "Nothing new to publish."
  - Temporarily copy a paper into a scratch `src`, run the sync test variant there, and confirm the upstream
    `data/` was never modified: `git -C iterate_visuals_for_papers status --short data/` should be empty
    before and after.
- [ ] Run `node scripts/unlock.mjs --open` so my real browser gets the key.
- [ ] Write a review section in `seyonv.github.io/tasks/todo.md` covering what shipped, the counts, the
  placeholders left, and how to rotate the key.
