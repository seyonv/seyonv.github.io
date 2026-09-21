#!/usr/bin/env node
// Prints the one-time unlock URL for the private artifacts gallery. The key
// never gets written anywhere but this URL's fragment and the local key file.
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { KEY } from "./lib/paths.mjs";
import { fromB64url, b64url } from "./lib/seal.mjs";

const local = process.argv.includes("--local");
const open = process.argv.includes("--open");

async function main() {
  const keyText = (await readFile(KEY, "utf8")).trim();
  // Round-trip to normalize/validate the key is well-formed base64url.
  const key = b64url(fromB64url(keyText));
  const base = local ? "http://localhost:8080/artifacts/" : "https://seyonv.github.io/artifacts/";
  const url = `${base}#k=${key}`;
  console.log(url);
  if (open) {
    execFile("open", [url], (err) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
