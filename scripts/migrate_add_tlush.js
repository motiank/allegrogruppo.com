#!/usr/bin/env node
// One-time migration: add the `tlush` JSON column to the `payroll` table.
// Holds the converted payroll-software data (the source of truth for the
// export file). Idempotent — safe to run more than once.
//
//   node scripts/migrate_add_tlush.js

import "dotenv/config";
import { executeSql } from "../admin/server/sources/dbpool.js";

const [cols] = await executeSql(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c",
  { t: "payroll", c: "tlush" },
);

if (cols.length) {
  console.log("payroll.tlush already exists — nothing to do.");
} else {
  await executeSql("ALTER TABLE payroll ADD COLUMN tlush JSON NULL", {});
  console.log("Added payroll.tlush (JSON, nullable).");
}
process.exit(0);
