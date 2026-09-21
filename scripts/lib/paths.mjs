import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const STATE_DIR = join(homedir(), ".local", "share", "seyonv-site");
export const STATE = join(STATE_DIR, "artifacts.json");
export const THUMBS = join(STATE_DIR, "thumbs");
export const SEALED = join(STATE_DIR, "sealed.json");
export const KEY = join(homedir(), ".config", "seyonv-site", "artifacts.key");

// scripts/lib/paths.mjs -> repo root is two directories up.
export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
