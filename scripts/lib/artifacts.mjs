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
// Chronological, not lexicographic: ISO timestamps with and without milliseconds
// (e.g. list results vs publish results) don't compare correctly as raw strings.
const isNewer = (a, b) => !!a && (!b || Date.parse(a) > Date.parse(b));

export function reduceArtifacts(events, prev = {}) {
  const rows = {}, alias = {}, deleted = new Set();
  // Seed the alias map from prior state so an alias url seen again (e.g. via a
  // list event) resolves to its canonical row id even when that row's own
  // publish/list events have aged out of the current transcripts.
  for (const [pid, r] of Object.entries(prev)) {
    for (const a of r.aliases || []) {
      const aid = artifactId(a);
      if (aid !== pid) alias[aid] = pid;
    }
  }
  // If an event resolves (directly or via alias) to a prev row that hasn't been
  // rebuilt yet this run, start from that prev row instead of a blank one, so
  // it merges rather than creating a duplicate.
  const seeded = (id) => {
    if (!rows[id] && prev[id] && !deleted.has(id)) rows[id] = { ...prev[id], aliases: [...(prev[id].aliases || [])] };
    return rows[id];
  };
  // publishCount = max(prev's count, publish events seen this run) — see the final pass
  // below. It must never grow just because a run re-processes the same events (no
  // incremental +1 forever), and must not shrink just because old transcripts got pruned.
  const freshPublishCounts = new Map();
  const sorted = [...events].sort((a, b) => (a.ts || "").localeCompare(b.ts || "") || (a.type === "list") - (b.type === "list"));
  for (const e of sorted) {
    const id = alias[e.id] || e.id;
    if (e.type === "publish") {
      // firstSeen is recomputed fully from this run's events, so a fresh publish never
      // seeds it from prev (that would make it stick to a stale earliest-ever value in a
      // way rule 7 doesn't ask for). description/icon/aliases ARE seeded from prev (when
      // not deleted this run) so a publish that's missing them, or that's chronologically
      // first (before a later list event's seeded() call would otherwise supply them),
      // doesn't wipe out what's already known.
      const base = deleted.has(id) ? null : prev[id];
      const r = rows[id] || { id, url: e.url, aliases: [...(base?.aliases || [])],
        description: base?.description ?? null, icon: base?.icon ?? null, publishCount: 0, firstSeen: e.ts };
      Object.assign(r, { title: e.title || r.title, version: e.version, file: e.file, updatedAt: e.ts, cwd: e.cwd,
        project: e.project, description: e.description || r.description, icon: e.icon || r.icon });
      rows[id] = r;
      freshPublishCounts.set(id, (freshPublishCounts.get(id) || 0) + 1);
    } else if (e.type === "list") {
      seeded(id);
      if (rows[id]) { if (isNewer(e.updatedAt, rows[id].updatedAt)) rows[id].updatedAt = e.updatedAt; continue; }
      const twin = Object.values(rows).find((r) => r.title === e.title && near(r.updatedAt, e.updatedAt));
      if (twin) {
        alias[e.id] = twin.id;
        if (!twin.aliases.includes(e.url)) twin.aliases.push(e.url);
        // Match the "already known alias" branch above so a duplicate list snapshot
        // of the same event behaves the same whether or not its alias was already
        // known from a prior run — otherwise output depends on processing order.
        if (isNewer(e.updatedAt, twin.updatedAt)) twin.updatedAt = e.updatedAt;
        continue;
      }
      rows[id] = { id, url: e.url, aliases: [], title: e.title, description: null, icon: e.icon, project: e.project, cwd: null,
        file: null, version: null, updatedAt: e.updatedAt, firstSeen: e.ts, publishCount: 0 };
    } else if (e.type === "delete") {
      delete rows[id]; deleted.add(id);
    }
  }
  for (const [id, count] of freshPublishCounts) {
    if (!rows[id]) continue;
    const prevCount = deleted.has(id) ? 0 : (prev[id]?.publishCount || 0);
    rows[id].publishCount = Math.max(prevCount, count);
  }
  for (const [id, r] of Object.entries(prev)) {
    if (!rows[id] && !deleted.has(id) && !Object.values(rows).some((x) => x.aliases.includes(r.url))) rows[id] = r;
    else if (rows[id] && r.thumb) rows[id].thumb = r.thumb;
  }
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)));
}
