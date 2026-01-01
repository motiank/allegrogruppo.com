import { createReadStream, promises as fs } from "fs";
// const fs = require("fs").promises;
import path, { resolve } from "path";
// import csv from "csv-parser";
import { parse } from "fast-csv";
import xlsx from "node-xlsx";
import moment from "moment";

// Function to process a single CSV file and return its content
async function readCSVFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileContent = [];

    createReadStream(filePath)
      //   .pipe(csv())
      .pipe(parse({ headers: true, ignoreEmpty: true }))
      .transform((row) => {
        // Transform each field in the row
        return Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            // Convert numeric strings to numbers
            const parsedValue = isNaN(value) ? value : parseFloat(value);
            return [key.toLowerCase(), parsedValue];
          }),
        );
      })
      .on("data", (row) => {
        fileContent.push(row);
      })
      .on("end", () => {
        resolve(fileContent);
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

async function readXLSXFile(filePath) {
  return new Promise((resolve, reject) => {
    const workSheetsFromFile = xlsx.parse(filePath);
    console.log(workSheetsFromFile);
    // resolve(fileContent);
  });
}

// Function to iterate over folders and CSV files
async function csvLoader(dirPath, callback) {
  try {
    const folders = await fs.readdir(dirPath);

    // Iterate through each folder
    for (const folder of folders) {
      const folderPath = path.join(dirPath, folder);
      const stats = await fs.stat(folderPath);

      // Check if it's a directory
      if (stats.isDirectory()) {
        const files = await fs.readdir(folderPath);

        // Iterate through CSV files in the directory
        for (const file of files) {
          const filePath = path.join(folderPath, file);

          // Check if the file is a CSV
          if (path.extname(file) === ".csv") {
            const fileContent = await readCSVFile(filePath);

            // Call the callback with the file name and its content
            await callback(folder, fileContent, file);
          }
          // Check if the file is a xlsx
          if (path.extname(file) === ".xlsx") {
            const fileContent = await readXLSXFile(filePath);
            // Call the callback with the file name and its content
            await callback(folder, fileContent, file);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

function getRecord(row) {
  return {
    order_no: row[csv_fields[2]],
    branch: row[csv_fields[9]],
    openat: moment(row[csv_fields[6]], "DD/MM/YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
    closeat: moment(row[csv_fields[5]], "DD/MM/YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
    total: row[csv_fields[7]],
    service: row[csv_fields[10]],
    table_no: row[csv_fields[3]],
    discount: row[csv_fields[1]],
    // source: row[csv_fields[4]],
    diners: row[csv_fields[8]],
  };
}

export default csvLoader;
export { getRecord };

// Example callback function
// async function myCallback(fileName, fileContent) {
//   console.log(`Processing file: ${fileName}`);
//   console.log(fileContent); // fileContent is an array of objects
// }

// // Example usage
// const directoryPath = "/path/to/your/directory"; // Replace with the actual path

// processCSVFiles(directoryPath, myCallback);
