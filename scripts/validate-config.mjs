#!/usr/bin/env node
/**
 * Валидация:
 * - albums.json: уникальные ключи, валидные URL, доступность (HEAD) базовых config.json (best-effort)
 * - Центральная галерея: наличие index.json, корректность структуры items
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

function fail(msg) { console.error('ERROR:', msg); process.exitCode = 1; }
function warn(msg) { console.warn('WARN:', msg); }

async function validateAlbumsJson() {
  const p = path.join(ROOT, 'albums.json');
  const raw = await fs.readFile(p, 'utf8').catch(() => null);
  if (!raw) { fail('albums.json not found'); return; }
  let json;
  try { json = JSON.parse(raw); } catch (e) { fail('albums.json invalid JSON'); return; }
  const arr = Array.isArray(json.albums) ? json.albums : [];
  if (!arr.length) warn('albums.json: empty albums array');

  // Уникальные ключи
  const keys = new Set();
  for (const a of arr) {
    if (!a.key || !a.base) { fail(`albums.json: invalid entry ${JSON.stringify(a)}`); continue; }
    if (keys.has(a.key)) fail(`Duplicate album key: ${a.key}`);
    keys.add(a.key);
    try { new URL(a.base); } catch { fail(`Invalid base URL: ${a.base}`); }
  }

  // Доступность config.json (best-effort)
  for (const a of arr) {
    try {
      const url = new URL('config.json', a.base).toString();
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) warn(`config.json not reachable for ${a.key} (${res.status})`);
    } catch {
      warn(`HEAD request failed for ${a.key}`);
    }
  }
}

async function validateGallery() {
  const galleryRoot = path.join(ROOT, 'albums', 'gallery');
  const dirents = await fs.readdir(galleryRoot, { withFileTypes: true }).catch(() => []);
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const dir = path.join(galleryRoot, d.name);
    const idxPath = path.join(dir, 'index.json');
    const raw = await fs.readFile(idxPath, 'utf8').catch(() => null);
    if (!raw) { warn(`Missing index.json in ${d.name}`); continue; }
    let json;
    try { json = JSON.parse(raw); } catch { fail(`Invalid JSON in ${idxPath}`); continue; }
    const items = Array.isArray(json.items) ? json.items : (Array.isArray(json) ? json : null);
    if (!items) { fail(`index.json: items should be array in ${d.name}`); continue; }
    for (const it of items) {
      if (it.type === 'html') {
        if (!it.src) warn(`html slide without src in ${d.name}`);
      } else {
        if (!it.formats || (!it.formats.full && !it.src)) warn(`image item without formats in ${d.name}`);
      }
    }
  }
}

(async function main() {
  await validateAlbumsJson();
  await validateGallery();
  if (process.exitCode === 1) {
    console.error('Validation failed.');
    process.exit(1);
  } else {
    console.log('Validation passed.');
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
