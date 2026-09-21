#!/usr/bin/env node
// Captures a 640px JPEG thumbnail per artifact into THUMBS (outside the repo)
// and records row.thumb = {ver, kind, at} in STATE. Source: the local file,
// else a saved published page in PAGES/<id>/index.html, else the hosted URL.
// Flags: --only <id>, --force, --no-remote.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { STATE, STATE_DIR, THUMBS, PAGES, REPO } from "./lib/paths.mjs";
import { needsCapture, pickSource, thumbVer } from "./lib/thumbs.mjs";

const B = join(homedir(), ".claude", "skills", "gstack", "browse", "dist", "browse");
const args = process.argv.slice(2);
const force = args.includes("--force");
const noRemote = args.includes("--no-remote");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The browse daemon is scoped per project, so always run it from the repo root.
const b = (...cmd) => execFileSync(B, cmd, { cwd: REPO, timeout: 30_000, encoding: "utf8" }).trim();

function jpeg(png, id) {
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "640", png, "--out", join(THUMBS, `${id}.jpg`)],
    { timeout: 30_000, stdio: "ignore" });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function captureFile(file, png) {
  const port = await freePort();
  // Plain `python3 -m http.server` sends no charset, so pages without a <meta charset> render as mojibake.
  const py = "import http.server as h,sys;H=h.SimpleHTTPRequestHandler;"
    + "H.extensions_map['.html']='text/html; charset=utf-8';h.test(HandlerClass=H,port=int(sys.argv[1]),bind='127.0.0.1')";
  const server = spawn("python3", ["-c", py, String(port)], { cwd: dirname(file), stdio: "ignore" });
  try {
    const url = `http://127.0.0.1:${port}/${encodeURIComponent(basename(file))}`;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(url)).ok) break; } catch {}
      await sleep(100);
    }
    b("viewport", "1280x800");
    b("goto", url);
    await sleep(1500);
    b("screenshot", "--viewport", png);
  } finally {
    server.kill();
  }
}

// Returns true on success, false when claude.ai isn't showing an artifact
// (login page, bot check, not found) — the caller then stops remote captures.
async function captureRemote(row, png) {
  b("viewport", "1280x800");
  b("goto", row.url);
  // Tag the largest visible iframe (the artifact) and return its top 16:10 box.
  const probe = `(() => {
    if (location.pathname.includes('/login')) return 'login';
    const f = [...document.querySelectorAll('iframe')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width >= 200 && r.height >= 150)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
    if (!f) return 'none';
    const { x, y, width } = f.r;
    const h = Math.min(f.r.height, Math.round(width * 10 / 16), innerHeight - y);
    return [x, y, width, h].map(Math.round).join(',');
  })()`;
  let box = "none";
  for (let waited = 0; waited <= 8000; waited += 500) {
    box = b("js", probe);
    if (box === "login" || /^\d/.test(box)) break;
    await sleep(500);
  }
  if (!/^\d/.test(box)) return false;
  await sleep(1500); // let the artifact paint inside the frame
  b("screenshot", "--clip", box, png);
  return true;
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE);
}

async function main() {
  const state = JSON.parse(readFileSync(STATE, "utf8"));
  mkdirSync(THUMBS, { recursive: true });
  // browse only writes screenshots under /private/tmp or the repo; never the repo.
  const tmp = mkdtempSync("/private/tmp/seyonv-thumbs-");
  const counts = { local: 0, snapshot: 0, remote: 0, placeholder: 0, kept: 0 };
  let remoteOk = !noRemote;

  try {
    for (const row of Object.values(state)) {
      if (only && row.id !== only) continue;
      if (!needsCapture(row, { force })) { counts.kept++; continue; }

      const png = join(tmp, `${row.id}.png`);
      let kind = "placeholder";
      try {
        const src = pickSource(row, { pagesDir: PAGES, exists: existsSync });
        if (src?.file) {
          await captureFile(src.file, png);
          jpeg(png, row.id);
          kind = src.kind;
        } else if (src?.kind === "remote" && remoteOk) {
          if (await captureRemote(row, png)) {
            jpeg(png, row.id);
            kind = "remote";
          } else {
            console.log("needs claude.ai login: run the cookie import (claude.ai showed a login, bot check or no artifact frame)");
            remoteOk = false;
          }
        }
      } catch (err) {
        console.error(`thumb ${row.id}: ${String(err.message || err).split("\n")[0]}`);
      }
      counts[kind]++;
      row.thumb = { ver: thumbVer(row), kind, at: new Date().toISOString() };
      writeState(state);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`thumbs: ${counts.local} local, ${counts.snapshot} snapshot, ${counts.remote} remote, ${counts.placeholder} placeholder, ${counts.kept} kept`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
