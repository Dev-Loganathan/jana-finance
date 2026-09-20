import "reflect-metadata";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { createApp } from "./app.factory";
import { env } from "./config/env";

async function bootstrap() {
  const app = await createApp({ prefix: "api" });
  serveWebApp(app);
  await app.listen(env().API_PORT, "0.0.0.0");
}

/** When WEB_DIST_DIR points at the built web app, serve it from the same address as the API (no CORS, cookies just work). */
function serveWebApp(app: Awaited<ReturnType<typeof createApp>>) {
  const dir = env().WEB_DIST_DIR && path.resolve(env().WEB_DIST_DIR!);
  if (!dir || !existsSync(path.join(dir, "index.html"))) return;
  const http = app.getHttpAdapter().getInstance() as express.Express;
  // Hashed asset files never change, so they can be cached for a year; index.html must always be re-fetched.
  http.use(express.static(dir, { index: false, maxAge: "1y", immutable: true, setHeaders: noCacheHtml }));
  http.get(/^(?!\/api(\/|$)).*/, (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(dir, "index.html"), (err) => err && next(err));
  });
}

function noCacheHtml(res: Response, file: string) {
  if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
}

void bootstrap();
