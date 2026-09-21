# seyonv.github.io — Explainers + Artifacts

**Date:** 2026-09-21
**Status:** design, awaiting review

## Goal

`https://seyonv.github.io/` becomes a small landing page with two doors:

1. **Explainers** (public). This is the existing hub at `/explainers/`, extended so that every paper worked in
   `iterate_visuals_for_papers` shows up automatically as **one grouped tile per paper**, never as loose cards.
2. **Artifacts** (private to me). A gallery at `/artifacts/` of every claude.ai Artifact published from my Claude
   Code sessions, showing the latest version of each with a thumbnail, title, description, date and project.
   Clicking a tile opens the live artifact. Only my browsers can see the gallery.

## Decisions already made

| Question | Decision |
|---|---|
| Root site | Replace the 2016 Jekyll blog with a new static landing page. The blog is archived, not deleted. Drop the CNAME so github.io isn't redirected to the Vercel domain. |
| Artifacts privacy | Encrypted gallery plus a one-time unlock link. |
| Thumbnails | Screenshot every artifact through my logged-in browser session. Local HTML files are used where they still exist. |
| Scope | All artifacts, sensitive ones included, latest version of each. Deleted artifacts are excluded. |

## Where things live

```
seyonv/seyonv.github.io   (user site → https://seyonv.github.io/)
  index.html                 landing: two doors
  artifacts/index.html       locked gallery shell (public, contains no data)
  artifacts/data/*.enc       AES-GCM ciphertext: manifest + one blob per thumbnail
  scripts/
    sync-artifacts.mjs       transcripts → manifest (plaintext stays local)
    thumbs.mjs               screenshots → local thumbnails
    seal.mjs                 manifest + thumbs → artifacts/data/*.enc
    unlock.mjs               prints the unlock URL
  publish.sh                 sync → thumbs (new/changed only) → seal → commit → push

seyonv/explainers         (project site → https://seyonv.github.io/explainers/, unchanged URL)
  sync-papers.mjs            iterate_visuals_for_papers/data/papers → paper-<slug>/ course folders
  publish.sh                 now runs sync-papers first
  hub-template.html          adds a "Papers" filter chip and a paper badge, plus a link back to the root site
```

The user site must **not** get an `explainers/` folder, because that would shadow the project page. The landing
page only links to it.

## 1. Root site and archiving the blog

1. The repo has 357 uncommitted local changes left over from a local Jekyll rebuild in May. Commit them as they
   are to a new branch `archive/jekyll-blog-2026` (no data is lost), and tag the current `master` as
   `jekyll-blog-final`.
2. Create a new `main` with only the new static site and a `.nojekyll`. Leave out `CNAME`, `_config.yml`, `_posts`
   and `_site`.
3. Enable Pages with source `main /`.

**Private-repo catch.** The repo is private, and GitHub Pages only serves private repos on a paid plan.
- **If Pro:** enable Pages and leave the repo private. Done.
- **If Free:** move the blog branches and tag to a new **private** repo `seyonv/jekyll-blog-archive`, delete them
  from `seyonv.github.io`, keep only the fresh `main` with its new history, then make `seyonv.github.io` public.
  No old blog history or drafts become public. The artifact data is still safe because only ciphertext is
  committed.

Try Pro first. If GitHub refuses, stop and confirm with me before making anything public.

**Landing page:** two large cards. The Explainers card shows the live count, read from a small `hub.json` that
the explainers build writes. The Artifacts card shows a lock state: "Locked" or "N artifacts". It uses the same
design system as the current hub (warm neutrals, green accent, automatic dark mode) and works at phone width.

## 2. Explainers: paper pipeline

**Source:** `~/Desktop/repos/iterate_visuals_for_papers/data/papers/<id>/`. The pipeline only reads this
folder. The app's CLAUDE.md says `data/` must not be edited while a job runs.

**`sync-papers.mjs`**, for each paper folder:
- Read `paper.json` (title, authors, `source.value` → arXiv id, `addedAt` → date) and `cards.json` (card order
  and titles).
- Include only cards whose `status` is done, so a job still in progress never publishes half-written cards. Skip
  `*.v<N>.html` revisions.
- Write to `explainers/paper-<arxiv-id-or-slug>/`:
  - the card HTML files, copied byte for byte
  - an `index.html` course gallery with the same look and ← → behaviour as `llm-latency/index.html`, and
    `_overview.html` first
  - an `explainer.json` with `{title, description: "<authors> · arXiv <id>", date, kind: "paper", source}`
- Per-paper folders keep shared slugs (`humaneval`, `pass-at-k`, `sampling-temperature`) from colliding.
- If a paper is deleted upstream, delete its hub folder. Only folders with the `paper-` prefix are managed, so
  hand-made explainers are never touched.
- Idempotent: if nothing upstream has changed, nothing changes in the hub and publishing doesn't commit.

**Hub changes (`build-hub.mjs` / template):**
- `kind: "paper"` tiles get a "Paper" badge showing the card count and the arXiv id.
- Add a filter row: All · Courses · Papers · Cards.
- Add a "← seyonv.github.io" link in the header.
- Write `hub.json` (counts) for the landing page.

**Keeping it synced ("always checks"):** a launchd agent (`com.seyonv.explainers-sync`) runs
`sync-papers.mjs && publish.sh papers` every 30 minutes and at login. It only pushes when something actually
changed. I chose 30-minute polling over `WatchPaths` because card jobs write many files over several minutes,
and the `status: done` filter together with the interval avoids publishing mid-job.

## 3. Artifacts: private gallery

### 3a. Discovery (`sync-artifacts.mjs`)
- Scan `~/.claude/projects/**/*.jsonl`, including `subagents/`, for `tool_use` blocks named `Artifact` and join
  each one to its `toolUseResult`:
  - successful publish results → `{url, artifact_id, title, version, file_path, description, icon, timestamp, project, session}`
  - `list` results → `{title, url, favicon, updatedAt}`, which add artifacts whose publishing session is gone
  - `delete` results → mark the artifact deleted and exclude it
- Keep one row per artifact: the **latest** publish by timestamp. Description and icon fall back to earlier
  publishes if the latest one left them out.
- Alias short-id list URLs to UUID publish URLs when their title and update time match. Unmatched ones stay as
  their own rows.
- Merge into a local state file `~/.local/share/seyonv-site/artifacts.json`, never committed. The merge is
  additive: an artifact seen once is kept even after its transcript is pruned, unless it was deleted.
- Current yield: about 106 artifacts, 56 of them with publish metadata and 42 with local HTML still on disk.

### 3b. Thumbnails (`thumbs.mjs`)
- For each artifact whose `version` or `updatedAt` changed since its last capture:
  - If the local `file_path` exists, render it headlessly at 1280×800 and capture a 640×400 WebP. This is the
    fastest route and needs no login.
  - Otherwise, open the claude.ai artifact URL in the gstack `browse` headless browser, using claude.ai cookies
    imported once from my real browser via `/setup-browser-cookies`, and capture the artifact's content frame.
  - If that fails (logged out, or the artifact was removed), fall back to a styled tile showing the artifact's
    emoji and title, and flag it in the sync report.
- Thumbnails are saved locally under `~/.local/share/seyonv-site/thumbs/`.

### 3c. Encryption and unlock (`seal.mjs`, `unlock.mjs`)
- Generate a 256-bit key once and store it at `~/.config/seyonv-site/artifacts.key` (mode 600, never committed).
- Seal the manifest into `artifacts/data/manifest.enc` and each thumbnail into `artifacts/data/<hash>.enc` with
  AES-GCM and a fresh IV per blob. Blob names are hashes, so no titles leak.
- `node scripts/unlock.mjs` prints `https://seyonv.github.io/artifacts/#k=<base64 key>`. The fragment is never
  sent to any server.
- On first load, `artifacts/index.html` moves the key from the fragment into `localStorage`, clears the fragment
  from the URL, then decrypts with WebCrypto and renders the gallery.
- Without a key, the page shows a lock screen with a "paste key" field and nothing else.
- Opening the unlock link once per browser is my "native cookie". Running `unlock.mjs --open` opens it in my
  default browser automatically.
- To revoke: run `seal.mjs --rotate`, which generates a new key and re-encrypts everything. Old links stop working.

### 3d. The gallery page
- Tiles show the thumbnail, the emoji plus title, the description, the project (e.g. `game_aug16`), the last
  updated date and the publish count.
- Search, a project filter, and sort by newest.
- Clicking a tile opens the claude.ai artifact URL in a new tab. claude.ai's own login protects the content
  itself.
- Same design system as the landing page and hub.

### 3e. Keeping it synced
- A second launchd agent (`com.seyonv.artifacts-sync`) runs `seyonv.github.io/publish.sh` every 2 hours: sync,
  thumbnail new or changed artifacts, seal, and push only if something changed.
- Because every re-seal generates new IVs, `seal.mjs` only rewrites a blob when its plaintext hash changed.
  Otherwise every run would produce a commit.

## Error handling
- A malformed transcript line is skipped and counted in the report, and never aborts the run.
- A missing paper `cards.json` means that paper is skipped with a warning.
- A thumbnail failure falls back to the emoji tile and is listed in the run summary.
- Both publish scripts exit 0 with "nothing new" when there are no changes, and never force-push.
- launchd writes its logs to `~/Library/Logs/seyonv-site/*.log`.

## Testing and verification
- **Unit tests (node:test):**
  - transcript parsing, using fixture JSONL with publish, republish, list, delete and failed publish
  - latest-version selection and aliasing
  - paper sync: done-only filter, `.vN` skip, slug collision, upstream deletion
  - seal/open round-trip, and checking that no plaintext title substring appears in any `.enc` file
- **E2E with `/browse` against the live site after deploy:**
  - landing page renders both doors
  - `/explainers/` shows 2 paper tiles plus the existing ones, and a paper opens its gallery with ← →
  - `/artifacts/` without a key shows only the lock
  - after the unlock link, it shows about 106 tiles with thumbnails, and clicking one opens claude.ai
  - check light and dark mode at 390px and 1280px widths
- `grep` the committed tree for a few known artifact titles to confirm none appear in plaintext.

## Out of scope
- Real authentication (Cloudflare Access). Revisit if the site gets a custom domain.
- Local HTML pages that were never published as claude.ai artifacts. "Artifacts" here means things published
  through the Artifact tool, whether I asked for them or Claude published on its own.
- Mirroring artifact content onto GitHub. Tiles link to claude.ai. They don't copy the HTML.
