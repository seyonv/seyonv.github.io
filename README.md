# seyonv.github.io

Static site for https://seyonv.github.io/. No build step; GitHub Pages serves the
`main` branch directly.

This repo was recreated fresh and is public. The old Jekyll blog's history lives
in the private repo `seyonv/jekyll-blog-archive`, on branch
`archive/jekyll-blog-2026` and tag `jekyll-blog-final`.

## Layout

- `index.html` - landing page
- `artifacts/` - encrypted gallery (data lives in `artifacts/data/`)
- `scripts/` - site and gallery tooling (`scripts/lib/` for shared code)
- `docs/` - specs, plans, and other project docs

Plaintext artifact state lives at `~/.local/share/seyonv-site/` and the
encryption key at `~/.config/seyonv-site/artifacts.key` - neither is ever
committed to this repo.

## Artifacts pipeline

`./publish.sh` (only runs from `main`) does, in order:

1. `scripts/sync-artifacts.mjs` - scans local Claude Code transcripts for
   published artifacts and updates the plaintext state file.
2. `scripts/thumbs.mjs` - captures a thumbnail per artifact. Source priority:
   the local file, else a saved published page under
   `~/.local/share/seyonv-site/pages/<id>/`, else a placeholder. Capturing a
   fresh screenshot from the hosted claude.ai page is opt-in
   (`scripts/thumbs.mjs --remote`, since claude.ai blocks headless Chromium
   without cookies) and is not run by `publish.sh`.
3. `scripts/seal.mjs` - encrypts the state and thumbnails into
   `artifacts/data/*.enc`. Only ciphertext is ever written under this repo.
4. Stages, commits, and pushes `artifacts/` and `index.html`.

### Unlocking the gallery

The gallery is encrypted; visiting it directly shows nothing. Get the one-time
unlock URL with:

```
node scripts/unlock.mjs --open
```

This opens `https://seyonv.github.io/artifacts/#k=<key>` in the browser. The
key never leaves this URL fragment and the local key file.

### Rotating the key

```
node scripts/seal.mjs --rotate
./publish.sh
node scripts/unlock.mjs --open
```

Rotating clears the sealed cache and re-encrypts everything under a new key,
so you'll need a fresh unlock URL afterward.

### Known limitation

A remote-only artifact (no local file, no saved page) that gets republished
later keeps its old saved-page thumbnail until that page is re-fetched with
the Artifact tool's `read` action - the thumbnail pipeline itself doesn't
re-fetch remote pages.

## launchd

`scripts/install-launchd.sh` installs both sync jobs (this repo's
`artifacts-sync` and the explainers repo's `explainers-sync`) into
`~/Library/LaunchAgents` and (re)bootstraps them. Logs land in
`~/Library/Logs/seyonv-site/`.
