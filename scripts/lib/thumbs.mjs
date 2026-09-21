// Pure helpers for scripts/thumbs.mjs: which rows need a (re)capture.
import { join } from "node:path";

export const thumbVer = (row) => row.version || row.updatedAt || null;

export function needsCapture(row, { force = false } = {}) {
  if (force || !row.thumb) return true;
  if (row.thumb.kind === "placeholder") return true;
  return row.thumb.ver !== thumbVer(row);
}

// Where to capture a row from: its local file, else a saved copy of the
// published page (PAGES/<id>/index.html), else the hosted URL. `exists` is
// injected so this stays pure.
export function pickSource(row, { pagesDir, exists }) {
  if (row.file && exists(row.file)) return { kind: "local", file: row.file };
  const page = join(pagesDir, row.id, "index.html");
  if (exists(page)) return { kind: "snapshot", file: page };
  if (row.url) return { kind: "remote" };
  return null;
}
