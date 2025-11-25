#!/usr/bin/env node
/**
 * Convert XML-based Excel (.xls) files to CSV format
 * 
 * Usage:
 *   node convert_xls_to_csv.js [input_file] [output_file]
 * 
 * Examples:
 *   node convert_xls_to_csv.js trans.xls trans.csv
 *   node convert_xls_to_csv.js trans.xls  (outputs to trans.csv)
 *   node convert_xls_to_csv.js           (uses trans.xls -> trans.csv)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get command line arguments
const args = process.argv.slice(2);
const inputFile = args[0] || 'trans.xls';
const outputFile = args[1] || inputFile.replace(/\.xls$/i, '.csv');

// Resolve file paths
const inputPath = path.isAbsolute(inputFile) 
  ? inputFile 
  : path.join(__dirname, inputFile);
const outputPath = path.isAbsolute(outputFile)
  ? outputFile
  : path.join(__dirname, outputFile);

// Check if input file exists
if (!fs.existsSync(inputPath)) {
  console.error(`Error: Input file not found: ${inputPath}`);
  process.exit(1);
}

try {
  // Read the XML file
  const xmlContent = fs.readFileSync(inputPath, 'utf-8');

  // Extract all Data elements from the XML
  const dataRegex = /<Data[^>]*>(.*?)<\/Data>/g;
  const matches = [];
  let match;

  while ((match = dataRegex.exec(xmlContent)) !== null) {
    matches.push(match[1]);
  }

  if (matches.length === 0) {
    console.error('Error: No data found in the XML file');
    process.exit(1);
  }

  // Find the header row - look for "מספר נייר" which is the first column header
  let headerIndex = -1;
  const targetHeader = 'מספר נייר';
  
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].trim() === targetHeader) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    console.error('Error: Could not find header row (looking for "מספר נייר")');
    process.exit(1);
  }

  // The header row has exactly 11 columns
  const columnCount = 11;

  const headers = [];
  for (let i = headerIndex; i < headerIndex + columnCount && i < matches.length; i++) {
    headers.push(matches[i].trim());
  }

  // Extract data rows - start from the row immediately after the header
  const dataRows = [];
  const dataStartIndex = headerIndex + columnCount;
  
  // Process all remaining data in groups of columnCount
  for (let i = dataStartIndex; i < matches.length; i += columnCount) {
    const row = [];
    for (let j = 0; j < columnCount && (i + j) < matches.length; j++) {
      row.push(matches[i + j].trim());
    }
    
    // Only add rows that have at least one non-empty cell
    if (row.some(cell => cell !== '')) {
      // Pad with empty cells if the row is incomplete
      while (row.length < columnCount) {
        row.push('');
      }
      dataRows.push(row);
    }
  }

  // Create CSV content
  let csvContent = '';

  // Write headers
  csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';

  // Write data rows
  dataRows.forEach(row => {
    csvContent += row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',') + '\n';
  });

  // Write to CSV file
  fs.writeFileSync(outputPath, csvContent, 'utf-8');

  console.log(`✓ Conversion complete!`);
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Rows:   ${dataRows.length} data rows (plus 1 header row)`);

} catch (error) {
  console.error(`Error: ${error.message}`);
  if (error.code === 'ENOENT') {
    console.error(`File not found: ${inputPath}`);
  }
  process.exit(1);
}

