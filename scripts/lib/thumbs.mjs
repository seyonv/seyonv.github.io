// Pure helpers for scripts/thumbs.mjs: which rows need a (re)capture.

export const thumbVer = (row) => row.version || row.updatedAt || null;

export function needsCapture(row, { force = false } = {}) {
  if (force || !row.thumb) return true;
  if (row.thumb.kind === "placeholder") return true;
  return row.thumb.ver !== thumbVer(row);
}
