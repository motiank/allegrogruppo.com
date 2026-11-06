// Creates the target database, tables and views. Safe to run again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, connectTarget } from './lib.js';

const { db, database } = await connectTarget({ multipleStatements: true });
await db.query('CREATE DATABASE IF NOT EXISTS `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
await db.query('USE `' + database + '`');
try { await db.query('SET SESSION sql_require_primary_key = 1'); } catch { /* needs extra rights on some servers */ }
await db.query(readFileSync(join(ROOT, 'sql/schema.sql'), 'utf8'));
await db.query(readFileSync(join(ROOT, 'sql/views.sql'), 'utf8'));
const [tables] = await db.query('SELECT TABLE_TYPE, COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? GROUP BY TABLE_TYPE', [database]);
console.log(database, tables);
await db.end();
