// Test-only credentials for a throwaway database that is dropped on every run.
export const E2E_DB = "jana_e2e";
export const ADMIN_DB_URL = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://jana:jana@localhost:5433/postgres";
export const E2E_DB_URL = ADMIN_DB_URL.replace(/\/[^/]+$/, `/${E2E_DB}`);
export const API_PORT = 3100;
export const WEB_PORT = 5174;
export const SUPER_EMAIL = "e2e-super@test.local";
export const SUPER_PASSWORD = "E2e!Initial#Pass1";
export const NEW_PASSWORD = "E2e!Changed#Pass2";
export const API_ENV = {
  E2E_DB,
  ADMIN_DATABASE_URL: ADMIN_DB_URL,
  SEED_SUPERADMIN_EMAIL: SUPER_EMAIL,
  SEED_SUPERADMIN_PASSWORD: SUPER_PASSWORD,
  NODE_ENV: "test",
  DATABASE_URL: E2E_DB_URL,
  API_PORT: String(API_PORT),
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  JWT_ACCESS_SECRET: "e2e-access-secret-0123456789",
  FIELD_ENCRYPTION_KEY: "e2e-encryption-key-0123456789",
  BLIND_INDEX_KEY: "e2e-blind-index-key-0123456789",
  STORAGE_LOCAL_DIR: "./storage-e2e",
};
