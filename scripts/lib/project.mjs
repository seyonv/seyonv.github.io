// Picks the display project label for an artifact row. Pure: no fs, no clock,
// no username baked in — callers pass the repos root (os.homedir() + "/Desktop/repos").
import { sep } from "node:path";

function repoNameUnder(reposRoot, p) {
  if (!p) return null;
  const prefix = reposRoot.endsWith(sep) ? reposRoot : reposRoot + sep;
  if (!p.startsWith(prefix)) return null;
  const rest = p.slice(prefix.length);
  const name = rest.split(sep)[0];
  return name || null;
}

// row: { file, cwd }. transcriptProject: the project derived from the
// publishing session's transcript directory (today's sole source, kept as
// the rule-3 fallback). reposRoot: absolute path to .../Desktop/repos (no
// trailing slash required).
export function projectFor(row, transcriptProject, reposRoot) {
  return repoNameUnder(reposRoot, row.file) || repoNameUnder(reposRoot, row.cwd) || transcriptProject;
}
