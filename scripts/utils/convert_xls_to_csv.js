#!/usr/bin/env node
/**
 * Convert XML-based Excel (.xls) files to CSV format
 * 
 * Usage:
 *   node convert_xls_to_csv.js [input_file] [output_file] [--skip-rows N]
 * 
 * Examples:
 *   node convert_xls_to_csv.js trans.xls trans.csv --skip-rows 2
 *   node convert_xls_to_csv.js trans.xls  (outputs to trans.csv)
 *   node convert_xls_to_csv.js           (uses trans.xls -> trans.csv)
 * 
 * Options:
 *   --skip-rows N    Number of rows to skip from the beginning (default: 0)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
let inputFile = null;
let outputFile = null;
let skipRows = 0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skip-rows' && i + 1 < args.length) {
    skipRows = parseInt(args[i + 1], 10);
    if (isNaN(skipRows) || skipRows < 0) {
      console.error('Error: --skip-rows must be a non-negative integer');
      process.exit(1);
    }
    i++; // Skip the next argument as it's the value
  } else if (!inputFile) {
    inputFile = args[i];
  } else if (!outputFile) {
    outputFile = args[i];
  }
}

// Set defaults
inputFile = inputFile || 'trans.xls';
outputFile = outputFile || inputFile.replace(/\.xls$/i, '.csv');

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

/**
 * Parse XML rows from Excel XML format
 * Returns an array of rows, where each row is an array of cell values
 */
function parseExcelXML(xmlContent) {
  const rows = [];
  
  // Match all Row elements
  const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
  let rowMatch;
  
  while ((rowMatch = rowRegex.exec(xmlContent)) !== null) {
    const rowContent = rowMatch[1];
    const cells = [];
    
    // Match all Cell elements within this row
    const cellRegex = /<Cell[^>]*>([\s\S]*?)<\/Cell>/g;
    let cellMatch;
    
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const cellContent = cellMatch[1];
      
      // Extract Data element from Cell
      const dataMatch = cellContent.match(/<Data[^>]*>(.*?)<\/Data>/);
      if (dataMatch) {
        cells.push(dataMatch[1].trim());
      } else {
        // Empty cell
        cells.push('');
      }
    }
    
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  
  return rows;
}

try {
  // Read the XML file
  const xmlContent = fs.readFileSync(inputPath, 'utf-8');

  // Parse rows from XML
  const allRows = parseExcelXML(xmlContent);

  if (allRows.length === 0) {
    console.error('Error: No rows found in the XML file');
    process.exit(1);
  }

  // Skip the specified number of rows
  if (skipRows >= allRows.length) {
    console.error(`Error: Cannot skip ${skipRows} rows, file only has ${allRows.length} rows`);
    process.exit(1);
  }

  const rowsAfterSkip = allRows.slice(skipRows);
  
  if (rowsAfterSkip.length === 0) {
    console.error('Error: No rows remaining after skipping');
    process.exit(1);
  }

  // The first row after skipping is the header row
  const headerRow = rowsAfterSkip[0];
  const columnCount = headerRow.length;

  // Print analysis
  console.log('📊 Analysis:');
  console.log(`  Rows skipped: ${skipRows}`);
  console.log(`  Total rows in file: ${allRows.length}`);
  console.log(`  Rows after skip: ${rowsAfterSkip.length}`);
  console.log(`  Number of columns: ${columnCount}`);
  console.log(`  Header row:`);
  headerRow.forEach((header, index) => {
    console.log(`    Column ${index + 1}: "${header}"`);
  });
  console.log('');

  // Extract data rows (everything after the header)
  const dataRows = rowsAfterSkip.slice(1).filter(row => {
    // Only include rows that have at least one non-empty cell
    return row.some(cell => cell !== '');
  });

  // Normalize all rows to have the same column count
  const normalizedDataRows = dataRows.map(row => {
    const normalized = [...row];
    // Pad with empty cells if the row is incomplete
    while (normalized.length < columnCount) {
      normalized.push('');
    }
    // Truncate if the row has too many cells
    return normalized.slice(0, columnCount);
  });

  // Create CSV content
  let csvContent = '';

  // Write headers
  csvContent += headerRow.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';

  // Write data rows
  normalizedDataRows.forEach(row => {
    csvContent += row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',') + '\n';
  });

  // Write to CSV file
  fs.writeFileSync(outputPath, csvContent, 'utf-8');

  console.log(`✓ Conversion complete!`);
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Rows:   ${normalizedDataRows.length} data rows (plus 1 header row)`);

} catch (error) {
  console.error(`Error: ${error.message}`);
  if (error.code === 'ENOENT') {
    console.error(`File not found: ${inputPath}`);
  }
  console.error(error.stack);
  process.exit(1);
}

