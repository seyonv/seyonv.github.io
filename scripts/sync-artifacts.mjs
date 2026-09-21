#!/usr/bin/env node
// Scans local Claude Code transcripts for claude.ai Artifact publishes, and
// writes the reduced state to STATE (outside the repo). Prints a summary.
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extractEvents, reduceArtifacts } from "./lib/artifacts.mjs";
import { STATE, STATE_DIR } from "./lib/paths.mjs";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PROJECT_PREFIX = "-Users-seyonvasantharajan-Desktop-repos-";
const PROJECT_PREFIX_EXACT = "-Users-seyonvasantharajan-Desktop-repos";

function deriveProject(dirName) {
  if (dirName === PROJECT_PREFIX_EXACT) return "repos";
  if (dirName.startsWith(PROJECT_PREFIX)) return dirName.slice(PROJECT_PREFIX.length);
  return dirName;
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function findTranscriptFiles() {
  const files = [];
  if (!isDir(PROJECTS_DIR)) return files;
  for (const projectDirName of readdirSync(PROJECTS_DIR).sort()) {
    const projectDir = join(PROJECTS_DIR, projectDirName);
    if (!isDir(projectDir)) continue;
    const project = deriveProject(projectDirName);
    for (const entry of readdirSync(projectDir).sort()) {
      const entryPath = join(projectDir, entry);
      if (entry.endsWith(".jsonl") && !isDir(entryPath)) {
        files.push({ path: entryPath, project, session: entry.slice(0, -".jsonl".length) });
      } else if (isDir(entryPath)) {
        const subagentsDir = join(entryPath, "subagents");
        if (!isDir(subagentsDir)) continue;
        for (const subFile of readdirSync(subagentsDir).sort()) {
          if (!subFile.endsWith(".jsonl")) continue;
          files.push({ path: join(subagentsDir, subFile), project, session: subFile.slice(0, -".jsonl".length) });
        }
      }
    }
  }
  return files;
}

function readPrevState() {
  if (!existsSync(STATE)) return {};
  try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; }
}

function localTitleFor(row) {
  if (!row.file || !existsSync(row.file)) return null;
  let html;
  try { html = readFileSync(row.file, "utf8"); } catch { return null; }
  const m = html.match(/<title>([^<]*)<\/title>/i);
  const title = m?.[1]?.trim();
  return title || null;
}

function writeStateAtomic(rows) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(rows, null, 2));
  renameSync(tmp, STATE);
}

function main() {
  const prev = readPrevState();
  const allEvents = [];
  for (const { path, project, session } of findTranscriptFiles()) {
    let content;
    try { content = readFileSync(path, "utf8"); } catch { continue; }
    const lines = content.split("\n").filter(Boolean);
    allEvents.push(...extractEvents(lines, { project, session }));
  }

  const rows = reduceArtifacts(allEvents, prev);
  for (const row of Object.values(rows)) {
    const title = localTitleFor(row);
    if (title) row.localTitle = title;
  }

  const prevIds = new Set(Object.keys(prev));
  const nextIds = new Set(Object.keys(rows));
  let added = 0, updated = 0, removed = 0;
  for (const id of nextIds) {
    if (!prevIds.has(id)) added++;
    else if (JSON.stringify(prev[id]) !== JSON.stringify(rows[id])) updated++;
  }
  for (const id of prevIds) if (!nextIds.has(id)) removed++;

  writeStateAtomic(rows);

  console.log(`artifacts: ${nextIds.size} total (+${added} new, ~${updated} updated, -${removed} removed)`);
}

main();
