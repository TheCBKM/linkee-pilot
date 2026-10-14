import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../config/env.js";
import { ensureDbSchema } from "../db/migrate.js";
import { getDashboardOverview } from "./queries.js";
import {
  approveDm,
  getDmById,
  rejectDm,
  setOpportunityStatus,
  type OpportunityStatus,
} from "../db/store.js";

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

function resolvePublicPath(urlPath: string): string {
  if (urlPath === "/" || urlPath === "") return "/index.html";
  if (urlPath === "/docs" || urlPath === "/docs/") return "/docs.html";
  return urlPath;
}

function serveStatic(urlPath: string, res: http.ServerResponse): void {
  const safePath = resolvePublicPath(urlPath);
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

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * SECURITY: this dashboard has no authentication, and approving a DM sends a
 * message as the account owner. Access control has to happen at the network
 * layer, so keep the published port bound to localhost (or behind a firewall)
 * and reach it over an SSH tunnel.
 *
 * A source-address check used to live here, but it cannot work: Docker NATs
 * inbound traffic, so the container sees the bridge gateway (172.x.x.1) for
 * every request, including ones from the host's own loopback. Allowing that
 * gateway would be worse than no check, because internet traffic arrives from
 * the same address once published on 0.0.0.0.
 */

async function readJsonBody(
  req: http.IncomingMessage
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {}
        );
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const OPPORTUNITY_STATUSES: OpportunityStatus[] = [
  "new",
  "filtered",
  "shortlisted",
  "applied",
  "dismissed",
];

async function handleMutation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): Promise<boolean> {
  const dmMatch = pathname.match(/^\/api\/dm\/(\d+)\/(approve|reject)$/);
  if (dmMatch) {
    const id = Number(dmMatch[1]);
    const action = dmMatch[2];

    if (action === "reject") {
      sendJson(res, 200, { ok: rejectDm(id) });
      return true;
    }

    const body = await readJsonBody(req);
    const edited =
      typeof body.text === "string" && body.text.trim()
        ? body.text.trim()
        : undefined;
    const ok = approveDm(id, edited);
    sendJson(res, ok ? 200 : 409, {
      ok,
      dm: ok ? getDmById(id) : null,
      ...(ok ? {} : { error: "DM not found or not awaiting approval" }),
    });
    return true;
  }

  const oppMatch = pathname.match(/^\/api\/opportunity\/(\d+)\/status$/);
  if (oppMatch) {
    const body = await readJsonBody(req);
    const status = body.status;
    if (
      typeof status !== "string" ||
      !OPPORTUNITY_STATUSES.includes(status as OpportunityStatus)
    ) {
      sendJson(res, 400, {
        error: `status must be one of: ${OPPORTUNITY_STATUSES.join(", ")}`,
      });
      return true;
    }
    setOpportunityStatus(Number(oppMatch[1]), status as OpportunityStatus);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

loadEnv({ requireApiKeys: false });
ensureDbSchema();

const port = getPort();
const host = getHost();

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const pathname = url.split("?")[0];

  if (req.method === "GET" && pathname === "/api/overview") {
    try {
      const overview = getDashboardOverview();
      sendJson(res, 200, overview);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      sendJson(res, 500, { error: message });
    }
    return;
  }

  if (req.method === "POST") {
    handleMutation(req, res, pathname)
      .then((handled) => {
        if (!handled) sendJson(res, 404, { error: "Not found" });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendJson(res, 400, { error: message });
      });
    return;
  }

  if (req.method === "GET") {
    serveStatic(pathname, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, host, () => {
  console.log(`Dashboard at http://${host}:${port}`);
});
