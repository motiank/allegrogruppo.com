// Builds the Windows install package of hash-sync as a zip (in memory, or into dist/ from the command line).
// Content: the program (src, sql, package.json, package-lock.json, README.md), the files of windows/ (install, check,
// sync and schedule scripts, INSTALL.md, ca.crt) and windows/env.example as .env.example. No passwords, no node_modules.
// The admin's Downloads page (admin/server/modules/downloads.js) calls buildWindowsPackage() so the download always
// matches the code of the deployed repo. By hand: node scripts/build-windows-package.js  →  dist/hash-sync-windows-<version>.zip
// jszip comes from the repo's root node_modules (a dependency of the admin).
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOP = 'hash-sync'; // the folder inside the zip
const CRLF_EXT = new Set(['.cmd', '.ps1', '.md', '.example']);

const crlf = (buffer) => Buffer.from(buffer.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
const ext = (name) => name.slice(name.lastIndexOf('.'));

// [{ path (inside the top folder), content (Buffer), mtime }]
export function windowsPackageFiles() {
  const out = [];
  const add = (zipPath, diskPath) => {
    const raw = readFileSync(diskPath);
    out.push({ path: zipPath, content: CRLF_EXT.has(ext(zipPath)) ? crlf(raw) : raw, mtime: statSync(diskPath).mtime });
  };
  for (const name of ['package.json', 'package-lock.json', 'README.md']) add(name, join(ROOT, name));
  for (const dir of ['src', 'sql']) for (const name of readdirSync(join(ROOT, dir)).sort()) add(`${dir}/${name}`, join(ROOT, dir, name));
  for (const name of readdirSync(join(ROOT, 'windows')).sort()) {
    if (name === 'env.example') add('.env.example', join(ROOT, 'windows', name));
    else add(name, join(ROOT, 'windows', name));
  }
  return out;
}

export function packageVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

// { fileName, version, files: [paths], buffer }
export async function buildWindowsPackage() {
  const version = packageVersion();
  const files = windowsPackageFiles();
  const zip = new JSZip();
  for (const f of files) zip.file(`${TOP}/${f.path}`, f.content, { date: f.mtime, unixPermissions: 0o644 });
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return { fileName: `hash-sync-windows-${version}.zip`, version, files: files.map((f) => f.path), buffer };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { fileName, files, buffer } = await buildWindowsPackage();
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const out = join(ROOT, 'dist', fileName);
  writeFileSync(out, buffer);
  console.log(`${out} (${Math.round(buffer.length / 1024)} KB, ${files.length} files)`);
  for (const f of files) console.log(`  ${TOP}/${f}`);
}
