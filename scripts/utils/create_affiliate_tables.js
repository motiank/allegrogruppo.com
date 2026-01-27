/**
 * Script to create the affiliate and affiliate_orders tables in the database
 * Run with: node scripts/utils/create_affiliate_tables.js
 * Optional: append 'qa' for .env_qa, or use NODE_ENV=test for .envtest
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { executeSql } from '../../order_sys/server/sources/dbpool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let envFileName = '.env';
if (process.argv.includes('qa')) {
  envFileName = '.env_qa';
} else if (process.env.NODE_ENV === 'test') {
  envFileName = '.envtest';
}

dotenv.config({ path: join(__dirname, '..', '..', envFileName) });

async function createAffiliateTables() {
  try {
    console.log('Creating affiliate tables...');

    const sqlPath = join(__dirname, 'create_affiliate_tables.sql');
    const raw = readFileSync(sqlPath, 'utf8');
    const stmts = raw
      .split(/;\s*\n/)
      .map((s) => s.replace(/--[^\n]*/g, '').trim())
      .filter(Boolean);

    for (const sql of stmts) {
      if (sql) await executeSql(sql + ';');
    }

    console.log('✓ affiliate and affiliate_orders tables created successfully!');

    for (const table of ['affiliate', 'affiliate_orders']) {
      const checkQuery = `
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        AND table_name = :tableName
      `;
      const [result] = await executeSql(checkQuery, { tableName: table });
      if (result[0]?.count > 0) {
        const [structure] = await executeSql(`DESCRIBE \`${table}\``);
        console.log(`\n${table} structure:`);
        console.table(structure);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Error creating affiliate tables:', error);
    process.exit(1);
  }
}

createAffiliateTables();
