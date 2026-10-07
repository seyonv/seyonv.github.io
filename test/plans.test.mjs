import { test } from "node:test";
import assert from "node:assert/strict";
import { bundlePlan, planMeta } from "../scripts/lib/plans.mjs";

const files = {
  "_shell/shell.css": Buffer.from(".pp-nav{color:red}"),
  "_shell/shell.js": Buffer.from("const a = '$&'; document.title = '</script>';"),
  "avatar.png": Buffer.from([1, 2, 3]),
};
const read = (p) => files[p] || null;
const page = `<html><head><title>Robot  Plan</title>
<link rel="stylesheet" href="_shell/shell.css">
<script src="_shell/shell.js" defer></script>
<link rel="stylesheet" href="https://fonts.example/x.css">
</head><body><p class="lede prose">Arm <span>plays</span> poker.</p>
<section id="a"><h2>A</h2></section><section id="b"><h2>B</h2></section>
<img src="avatar.png"><img src="../secret.png"><img src="missing.png">
</body></html>`;

test("inlines local css, js and images; leaves remote and unknown refs alone", () => {
  const out = bundlePlan(page, read);
  assert.match(out, /<style>\.pp-nav\{color:red\}<\/style>/);
  assert.match(out, /data:image\/png;base64,AQID/);
  assert.match(out, /href="https:\/\/fonts\.example\/x\.css"/);
  assert.match(out, /src="\.\.\/secret\.png"/);
  assert.match(out, /src="missing\.png"/);
  assert.doesNotMatch(out, /src="_shell\/shell\.js"/);
});

test("deferred script moves to the end of body, unmangled and escaped", () => {
  const out = bundlePlan(page, read);
  const i = out.indexOf("const a = '$&'");
  assert.ok(i > out.indexOf("<section id=\"b\"") && i < out.lastIndexOf("</body>"));
  assert.ok(out.includes("'<\\/script>'"));
});

test("adds the read-only overrides and a back link", () => {
  const out = bundlePlan(page, read);
  assert.ok(out.indexOf(".pp-chat,") < out.indexOf("</head>"));
  assert.match(out, /href="\/plans\/"/);
});

test("planMeta reads title, lede and section count", () => {
  assert.deepEqual(planMeta(page), { title: "Robot Plan", description: "Arm plays poker.", sections: 2 });
});
