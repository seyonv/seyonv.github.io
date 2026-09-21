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
