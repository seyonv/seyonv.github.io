#!/usr/bin/env node
// `builds`: starts each plan's local server (chat + versions) and opens a local
// Build Plans index, styled like the deployed one, that links to them.
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { REPO, STATE_DIR } from "./lib/paths.mjs";
import { findPlanDirs, planMeta } from "./lib/plans.mjs";

const REPOS = join(homedir(), "Desktop", "repos");
const PLAN_CLI = join(homedir(), ".claude", "skills", "plan-page", "plan.mjs");
const OUT = join(STATE_DIR, "builds.html");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (d) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

async function startServer(dir) {
  const { stdout } = await promisify(execFile)(process.execPath, [PLAN_CLI, "open", dir, "--no-browser"]);
  return stdout.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
}

async function main() {
  const plans = await Promise.all(findPlanDirs(REPOS).map(async ({ slug, dir }) => {
    const html = await readFile(join(dir, "index.html"), "utf8");
    const url = await startServer(dir).catch((e) => { console.error(`${slug}: ${e.message.trim()}`); return null; });
    return { slug, url, updated: (await stat(join(dir, "index.html"))).mtime, ...planMeta(html) };
  }));
  plans.sort((a, b) => b.updated - a.updated);

  const shared = await readFile(join(REPO, "plans", "index.html"), "utf8");
  const style = shared.match(/<style>[\s\S]*?<\/style>/)[0];
  const cards = plans.map((p) => `<a class="tile plan"${p.url ? ` href="${p.url}"` : ""}>
  <div class="thumb"><span class="k">Plan · ${p.sections} sections</span><span class="t">${esc(p.title)}</span></div>
  <div class="meta"><p>${esc(p.description)}</p><div class="tags"><span class="badge">${esc(p.slug)}</span><span>${fmt(p.updated)}</span>${p.url ? "" : "<span>server failed to start</span>"}</div></div>
</a>`).join("\n");

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(OUT, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Build Plans (local)</title>
${style}
</head>
<body>
<main class="wrap">
  <a class="back" href="https://seyonv.github.io/plans/">← Deployed version</a>
  <div class="head"><div><h1>Build Plans</h1><p class="sub">${plans.length} plan${plans.length === 1 ? "" : "s"} · local, with chat</p></div></div>
  <div class="grid">
${cards}
  </div>
  <p class="foot">Each plan runs on its own local server with Claude chat and versions, through your Claude subscription. Stop one with <code>node ~/.claude/skills/plan-page/plan.mjs stop &lt;dir&gt;</code>.</p>
</main>
</body>
</html>
`);
  for (const p of plans) console.log(`${p.url || "(not running)"}  ${p.title}`);
  spawn("open", [OUT], { stdio: "ignore", detached: true }).unref();
}

main().catch((err) => { console.error(err); process.exit(1); });
