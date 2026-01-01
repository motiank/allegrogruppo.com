import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to import sharp, provide helpful error if not available
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (error) {
  console.error('❌ Error: sharp package is not installed.');
  console.error('Please install it by running: npm install sharp');
  process.exit(1);
}

const imagesDir = join(__dirname, '..', 'resources', 'images');
const originalDir = join(imagesDir, 'original');

// Ensure original directory exists
if (!existsSync(originalDir)) {
  mkdirSync(originalDir, { recursive: true });
  console.log(`✅ Created directory: ${originalDir}`);
}

// Get image filename from command line argument
const imageFileName = process.argv[2];

if (!imageFileName) {
  console.error('❌ Error: Please provide an image filename.');
  console.error('Usage: node scripts/compress-image.js <image-filename>');
  console.error('Example: node scripts/compress-image.js logo.avif');
  process.exit(1);
}

const imagePath = join(imagesDir, imageFileName);
const originalImagePath = join(originalDir, imageFileName);

// Check if image exists
if (!existsSync(imagePath)) {
  console.error(`❌ Error: Image file not found: ${imagePath}`);
  process.exit(1);
}

// Get file extension
const ext = extname(imageFileName).toLowerCase();

// Check if it's a supported image format
const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tiff'];
if (!supportedFormats.includes(ext)) {
  console.error(`❌ Error: Unsupported image format: ${ext}`);
  console.error(`Supported formats: ${supportedFormats.join(', ')}`);
  process.exit(1);
}

// Skip compression if it's an SVG (vector format, doesn't need compression)
if (ext === '.svg') {
  console.log('ℹ️  SVG files are vector graphics and don\'t need compression.');
  process.exit(0);
}

try {
  console.log(`📸 Compressing image: ${imageFileName}`);
  
  // Copy original to original folder (only if it doesn't already exist there)
  if (!existsSync(originalImagePath)) {
    copyFileSync(imagePath, originalImagePath);
    console.log(`✅ Backed up original to: ${originalImagePath}`);
  } else {
    console.log(`ℹ️  Original backup already exists, skipping backup`);
  }
  
  // Read the image
  const imageBuffer = readFileSync(imagePath);
  
  // Get original file size
  const originalSize = imageBuffer.length;
  const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(2);
  
  // Compress based on format
  let compressedBuffer;
  let outputFormat = ext.slice(1); // Remove the dot
  
  if (ext === '.jpg' || ext === '.jpeg') {
    compressedBuffer = await sharp(imageBuffer)
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } else if (ext === '.png') {
    compressedBuffer = await sharp(imageBuffer)
      .png({ quality: 85, compressionLevel: 9 })
      .toBuffer();
  } else if (ext === '.webp') {
    compressedBuffer = await sharp(imageBuffer)
      .webp({ quality: 85 })
      .toBuffer();
  } else if (ext === '.avif') {
    compressedBuffer = await sharp(imageBuffer)
      .avif({ quality: 85 })
      .toBuffer();
  } else if (ext === '.gif') {
    // GIF compression is more limited, just optimize
    compressedBuffer = await sharp(imageBuffer)
      .gif()
      .toBuffer();
  } else if (ext === '.tiff') {
    compressedBuffer = await sharp(imageBuffer)
      .tiff({ quality: 85 })
      .toBuffer();
  }
  
  // Get compressed file size
  const compressedSize = compressedBuffer.length;
  const compressedSizeMB = (compressedSize / (1024 * 1024)).toFixed(2);
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
  
  // Write compressed image back to original location
  writeFileSync(imagePath, compressedBuffer);
  
  console.log(`✅ Compression complete!`);
  console.log(`   Original size: ${originalSizeMB} MB`);
  console.log(`   Compressed size: ${compressedSizeMB} MB`);
  console.log(`   Compression ratio: ${compressionRatio}%`);
  console.log(`   Original backed up to: original/${imageFileName}`);
  
} catch (error) {
  console.error('❌ Error compressing image:', error.message);
  process.exit(1);
}

