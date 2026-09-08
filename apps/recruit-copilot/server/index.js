// Recruit Copilot server — zero dependencies (Node >= 20, native fetch).
// Serves the web app and the JSON API; boots seed data on first run.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, readBody, json } from "./router.js";
import { registerRoutes } from "./api.js";
import { raw, reset } from "./store.js";
import { SEED } from "./seed.js";
import { activeProvider } from "./llm/provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "..", "web");
const EXT_DIR = path.join(__dirname, "..", "extension");
const PORT = process.env.PORT || 5178;

// auto-seed if the store is empty
if (raw().candidates.length === 0 && raw().jobs.length === 0) reset(SEED);

const router = createRouter();
registerRoutes(router);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(WEB_DIR, path.normalize(rel));
  if (!filePath.startsWith(WEB_DIR)) return json(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(WEB_DIR, "index.html"), (e2, html) => {
        if (e2) return json(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": MIME[".html"] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS: the Boss content script calls this API from https://www.zhipin.com
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // serve the extension folder (so the mock-boss harness can load content.js)
  if (pathname.startsWith("/ext/")) {
    const f = path.join(EXT_DIR, path.normalize(pathname.slice(5)));
    if (!f.startsWith(EXT_DIR)) return json(res, 403, { error: "forbidden" });
    return fs.readFile(f, (err, data) => {
      if (err) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "text/plain; charset=utf-8" });
      res.end(data);
    });
  }

  if (pathname.startsWith("/api/")) {
    const m = router.match(req.method, pathname);
    if (!m) return json(res, 404, { error: "no route" });
    const body = req.method === "POST" || req.method === "PATCH" ? await readBody(req) : {};
    try {
      await m.handler(req, res, { params: m.params, body, query: Object.fromEntries(url.searchParams) });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Recruit Copilot  →  http://localhost:${PORT}`);
  console.log(`  LLM provider: ${activeProvider()}${activeProvider() === "mock" ? "  (set OPENAI_API_KEY for live AI)" : ""}\n`);
});
