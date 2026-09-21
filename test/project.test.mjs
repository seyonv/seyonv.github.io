import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFor } from "../scripts/lib/project.mjs";

const REPOS = "/Users/testuser/Desktop/repos";

test("rule 1: file under repos/<name>/... wins", () => {
  const row = { file: "/Users/testuser/Desktop/repos/widget-lab/card.html", cwd: "/somewhere/else" };
  assert.equal(projectFor(row, "transcript-proj", REPOS), "widget-lab");
});

test("rule 2: cwd under repos/<name>(/...) wins when file doesn't match", () => {
  const row = { file: "/private/tmp/scratch/card.html", cwd: "/Users/testuser/Desktop/repos/widget-lab/sub" };
  assert.equal(projectFor(row, "transcript-proj", REPOS), "widget-lab");
});

test("rule 2: cwd exactly at repos/<name> (no trailing path) still matches", () => {
  const row = { file: null, cwd: "/Users/testuser/Desktop/repos/widget-lab" };
  assert.equal(projectFor(row, "transcript-proj", REPOS), "widget-lab");
});

test("rule 3: falls back to transcript-derived project when neither file nor cwd match", () => {
  const row = { file: "/Users/other/elsewhere/card.html", cwd: "/Users/other/elsewhere" };
  assert.equal(projectFor(row, "transcript-proj", REPOS), "transcript-proj");
});

test("scratchpad file path (/private/tmp/...) falls through to rule 2 (cwd)", () => {
  const row = { file: "/private/tmp/claude-501/scratch/out.html", cwd: "/Users/testuser/Desktop/repos/widget-lab" };
  assert.equal(projectFor(row, "transcript-proj", REPOS), "widget-lab");
});

test("cwd exactly equal to ~/Desktop/repos (no subdir) falls to rule 3", () => {
  const row = { file: null, cwd: REPOS };
  assert.equal(projectFor(row, "transcript-proj", REPOS), "transcript-proj");
});
