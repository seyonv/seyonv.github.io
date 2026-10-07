// Bundles a plan-page folder (index.html + _shell/ + local images) into one
// self-contained, read-only HTML string. Pure apart from the `read` callback.

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
const isLocal = (p) => !/^(?:[a-z]+:|\/\/|\/|#)/i.test(p) && !p.includes("..");

// Hides the chat drawer, versions and server status: on the static site there is
// no plan server to talk to, so those controls could only ever say "offline".
const READ_ONLY = `<style>.pp-chat,.pp-fab-chat,.pp-ask,.pp-selask,.pp-nav-foot,.pp-ver,.pp-rail-ver,.pp-banner{display:none!important}</style>
<script>addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k")e.stopImmediatePropagation()},true)</script>`;

const BACK = `<a href="/plans/" style="position:fixed;right:16px;bottom:16px;z-index:50;font:13px -apple-system,system-ui,sans-serif;padding:7px 12px;border-radius:999px;background:#fbfbf9;border:1px solid #dedcd6;color:#1c1f23;text-decoration:none">← Build plans</a>`;

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// read(relPath) -> Buffer | null
export function bundlePlan(html, read) {
  const deferred = [];
  let out = html
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
      const css = isLocal(href) && read(href);
      return css ? `<style>${css.toString("utf8")}</style>` : m;
    })
    .replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
      const js = isLocal(src) && read(src);
      if (!js) return m;
      const tag = `<script>${js.toString("utf8").replace(/<\/script/gi, "<\\/script")}</script>`;
      // Inline scripts ignore `defer`, so keep its meaning by moving them to the end of body.
      if (/\sdefer\b/.test(m)) { deferred.push(tag); return ""; }
      return tag;
    })
    .replace(/(<img\b[^>]*\ssrc=")([^"]+)"/g, (m, pre, src) => {
      const ext = src.split(".").pop().toLowerCase();
      const buf = isLocal(src) && MIME[ext] && read(src);
      return buf ? `${pre}data:${MIME[ext]};base64,${buf.toString("base64")}"` : m;
    });
  out = insertBefore(out, "</head>", READ_ONLY, false);
  return insertBefore(out, "</body>", `${BACK}\n${deferred.join("\n")}`, true);
}

// Plain splice rather than String.replace, whose "$&"-style patterns would mangle inlined JS.
function insertBefore(html, tag, add, last) {
  const i = last ? html.lastIndexOf(tag) : html.indexOf(tag);
  return i < 0 ? html + add : html.slice(0, i) + add + "\n" + html.slice(i);
}

export function planMeta(html) {
  return {
    title: text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "") || "Untitled plan",
    description: text(html.match(/<p class="lede[^"]*">([\s\S]*?)<\/p>/)?.[1] || ""),
    sections: (html.match(/<section\b[^>]*\sid="/g) || []).length,
  };
}
