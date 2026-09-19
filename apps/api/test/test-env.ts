export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://jana:jana@localhost:5433/jana_test";
/** Maintenance database used only to CREATE the test database. */
export const ADMIN_DB_URL = TEST_DB_URL.replace(/\/[^/]+$/, "/postgres");

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DB_URL,
  JWT_ACCESS_SECRET: "test-access-secret-0123456789",
  FIELD_ENCRYPTION_KEY: "test-encryption-key-0123456789",
  BLIND_INDEX_KEY: "test-blind-index-key-0123456789",
  STORAGE_LOCAL_DIR: "./storage-test",
  LOGIN_MAX_ATTEMPTS: "5",
  LOGIN_LOCK_MINUTES: "15",
};
