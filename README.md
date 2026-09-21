# seyonv.github.io

Static site for https://seyonv.github.io/. No build step; GitHub Pages serves this
branch directly.

## Layout

- `index.html` - landing page
- `artifacts/` - encrypted gallery (data lives in `artifacts/data/`)
- `scripts/` - site and gallery tooling (`scripts/lib/` for shared code)
- `docs/` - specs, plans, and other project docs

Plaintext artifact state lives at `~/.local/share/seyonv-site/` and the
encryption key at `~/.config/seyonv-site/artifacts.key` - neither is ever
committed to this repo.

The old Jekyll blog lives on branch `archive/jekyll-blog-2026` and tag
`jekyll-blog-final`.
