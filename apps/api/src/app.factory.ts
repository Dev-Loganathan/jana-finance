import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { env } from "./config/env";

/** `prefix` is "api" in the real server so the API and the web app can share one address; tests run unprefixed. */
export async function createApp(opts: { prefix?: string } = {}): Promise<INestApplication> {
  env(); // load .env before any Prisma client is constructed
  const app = await NestFactory.create(AppModule, {
    logger: env().NODE_ENV === "test" ? false : ["log", "warn", "error"],
  });
  if (opts.prefix) app.setGlobalPrefix(opts.prefix);
  (app as unknown as { set: (k: string, v: unknown) => void }).set("trust proxy", 1);
  // Swagger UI needs inline scripts, so the strict CSP is only relaxed outside production.
  app.use(helmet({ contentSecurityPolicy: env().NODE_ENV === "production" ? undefined : false }));
  app.use(cookieParser());
  // OpenAPI docs at /docs (JSON at /docs-json). Not exposed in production.
  if (env().NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("Jana Finance API")
      .setVersion("0.1.0")
      .addBearerAuth()
      .addCookieAuth("jana_rt")
      .build();
    SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config), { useGlobalPrefix: true });
  }
  app.enableCors({ origin: env().WEB_ORIGIN, credentials: true });
  return app;
}
