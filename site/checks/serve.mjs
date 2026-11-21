// SPDX-License-Identifier: Apache-2.0
// A loopback server for the built site, as GitHub Pages serves it: directory addresses to index.html, the not-found page
// with status 404, gzip when the client accepts it. Used by the browser pass and the Lighthouse run.
//
//   node site/checks/serve.mjs [_site] [port]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".xml", ".txt", ".svg"]);

/** Serves `directory` on 127.0.0.1; resolves to { origin, close, requests } where `requests` lists every path asked for. */
export function serve(directory, port = 0) {
  const base = resolve(directory);
  const requests = [];
  const cache = new Map();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    let path = normalize(join(base, decodeURIComponent(url.pathname)));
    if (path !== base && !path.startsWith(base + sep)) {
      response.writeHead(400).end();
      return;
    }
    if (existsSync(path) && statSync(path).isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        response.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      path = join(path, "index.html");
    }
    let status = 200;
    if (!existsSync(path)) {
      status = 404;
      path = join(base, "404.html");
    }
    const extension = extname(path);
    const headers = { "content-type": TYPES[extension] ?? "application/octet-stream", "cache-control": "max-age=600" };
    let body = readFileSync(path);
    if (COMPRESSIBLE.has(extension) && /\bgzip\b/u.test(request.headers["accept-encoding"] ?? "")) {
      const key = `${path}:${statSync(path).mtimeMs}`;
      if (!cache.has(key)) cache.set(key, gzipSync(body, { level: 9 }));
      body = cache.get(key);
      headers["content-encoding"] = "gzip";
      headers.vary = "Accept-Encoding";
    }
    headers["content-length"] = body.length;
    response.writeHead(status, headers).end(request.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    resolveServer({ origin: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise((done) => server.close(done)) });
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = await serve(process.argv[2] ?? "_site", Number(process.argv[3] ?? 4173));
  process.stdout.write(`Serving on ${site.origin}\n`);
}
