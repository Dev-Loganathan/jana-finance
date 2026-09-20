import { passwordSchema } from "@jana/shared";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  JWT_ACCESS_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(14),
  FIELD_ENCRYPTION_KEY: z.string().min(16),
  BLIND_INDEX_KEY: z.string().min(16),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  // S3-compatible storage (Cloudflare R2, MinIO, AWS S3). Only read when STORAGE_DRIVER=s3.
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  // Folder holding the built web app. When it exists the API serves it, so one address serves everything.
  WEB_DIST_DIR: z.string().optional(),
  FILE_URL_TTL_SECONDS: z.coerce.number().default(60),
  SEED_SUPERADMIN_EMAIL: z.string().email().default("superadmin@janafinance.local"),
  // Same policy as user passwords. Quote it in .env: an unquoted # starts a comment.
  SEED_SUPERADMIN_PASSWORD: passwordSchema.default("ChangeMe#12345"),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().default(15),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Load the repo-root .env for local runs (real environment variables always win). */
function loadDotenv() {
  for (const f of [".env", "../../.env"]) {
    try {
      process.loadEnvFile(f);
      return;
    } catch {
      /* not found: try next */
    }
  }
}
export function env(): Env {
  if (!cached) {
    loadDotenv();
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
