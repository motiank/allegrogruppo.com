/**
 * Script to create the analytics_events table in the database
 * Run with: node scripts/create_analytics_table.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { executeSql } from '../../order_sys/server/sources/dbpool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
let envFileName = '.env';
if (process.argv.includes('qa')) {
  envFileName = '.env_qa';
} else if (process.env.NODE_ENV === 'test') {
  envFileName = '.envtest';
}

dotenv.config({ path: join(__dirname, '..', envFileName) });

async function createAnalyticsTable() {
  try {
    console.log('Creating analytics_events table...');
    
    // Read the SQL file
    const sqlPath = join(__dirname, 'create_analytics_events_table.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL (it uses CREATE TABLE IF NOT EXISTS, so it's safe to run multiple times)
    await executeSql(sql);
    
    console.log('✓ analytics_events table created successfully!');
    
    // Verify the table exists by checking its structure
    const checkQuery = `
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'analytics_events'
    `;
    
    const [result] = await executeSql(checkQuery);
    if (result[0]?.count > 0) {
      console.log('✓ Table verification: analytics_events table exists');
      
      // Show table structure
      const structureQuery = `DESCRIBE analytics_events`;
      const [structure] = await executeSql(structureQuery);
      console.log('\nTable structure:');
      console.table(structure);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating analytics_events table:', error);
    process.exit(1);
  }
}

createAnalyticsTable();
