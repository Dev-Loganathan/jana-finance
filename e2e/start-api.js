// Prepares a fresh e2e database (drop, migrate, seed the Super Admin) and then starts the built API.
// Playwright starts webServers before globalSetup, so this must happen in the server command itself.
const { execSync } = require("node:child_process");
const path = require("node:path");

const api = path.resolve(__dirname, "../apps/api");
const run = (cmd) => execSync(cmd, { cwd: api, env: process.env, stdio: "inherit" });

run(`npx ts-node test/reset-db.ts ${process.env.E2E_DB}`);
run("npx prisma migrate deploy");
run("npx ts-node prisma/seed.ts");
run("npx ts-node prisma/seed-demo.ts"); // 30 demo customers (verified KYC etc.) so chit tests have members to enrol
require(path.join(api, "dist/main.js"));
