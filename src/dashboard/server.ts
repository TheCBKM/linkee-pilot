import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { ensureDbSchema } from "../db/migrate.js";
import { getDashboardOverview } from "./queries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function getPort(): number {
  const raw = process.env.DASHBOARD_PORT ?? "3847";
  const port = parseInt(raw, 10);
  return isNaN(port) ? 3847 : port;
}

function getHost(): string {
  return process.env.DASHBOARD_HOST ?? "127.0.0.1";
}

function serveStatic(urlPath: string, res: http.ServerResponse): void {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(data);
  });
}

loadEnv({ requireApiKeys: false });
ensureDbSchema();

const port = getPort();
const host = getHost();

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/api/overview") {
    try {
      const overview = getDashboardOverview();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(overview));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(url.split("?")[0], res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, host, () => {
  console.log(`Dashboard at http://${host}:${port}`);
});
