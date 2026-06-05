// Apply the events schema (and optionally seed data) to the configured DB.
//
//   node events/scripts/apply-schema.js          # schema only
//   node events/scripts/apply-schema.js --seed   # schema + sample data
//
// Reads DB credentials from the repo .env (same as the rest of the monorepo).

import dotenv from "dotenv";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let envFileName = ".env";
if (process.argv.includes("qa")) envFileName = ".env_qa";
else if (process.env.NODE_ENV === "test") envFileName = ".envtest";
dotenv.config({ path: path.join(__dirname, "../..", envFileName) });

const run = async () => {
  const schemaDir = path.join(__dirname, "../schema");
  const files = ["events.sql"];
  if (process.argv.includes("--seed")) files.push("seed.sql");

  const caPath = process.env.DB_SSL_CA
    ? path.resolve(process.env.DB_SSL_CA.replace("~", process.env.HOME))
    : null;

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: caPath ? { ca: fs.readFileSync(caPath) } : null,
    multipleStatements: true,
  });

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(schemaDir, file), "utf-8");
      console.log(`[events] applying ${file} ...`);
      await conn.query(sql);
      console.log(`[events] ✅ ${file} applied`);
    }
  } finally {
    await conn.end();
  }
};

run().catch((e) => {
  console.error("[events] schema apply failed:", e);
  process.exit(1);
});
