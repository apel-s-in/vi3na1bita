#!/usr/bin/env node
/**
 * Валидация:
 * - albums.json: уникальные ключи, валидные URL, доступность config.json (best-effort)
 * - Центральная галерея: наличие index.json, корректность структуры items
 * Аргументы:
 *   --soft  не фейлить сборку при отсутствии файлов, вывести WARN и продолжить
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SOFT = process.argv.includes('--soft');

function fail(msg) {
  console.error('ERROR:', msg);
  if (!SOFT) process.exitCode = 1;
  else console.warn('[soft] ' + msg);
}
function warn(msg) { console.warn('WARN:', msg); }

async function validateAlbumsJson() {
  const p = path.join(ROOT, 'albums.json');
  const raw = await fs.readFile(p, 'utf8').catch(() => null);
  if (!raw) { fail('albums.json not found'); return; }

  let json;
  try { json = JSON.parse(raw); } catch { fail('albums.json invalid JSON'); return; }
  const arr = Array.isArray(json.albums) ? json.albums : [];
  if (!arr.length) warn('albums.json: empty albums array');

  const keys = new Set();
  for (const a of arr) {
    if (!a || typeof a !== 'object') { fail('albums.json: entry is not object'); continue; }
    if (!a.key || !a.base) { fail(`albums.json: invalid entry ${JSON.stringify(a)}`); continue; }
    if (keys.has(a.key)) fail(`Duplicate album key: ${a.key}`);
    keys.add(a.key);
    try { new URL(a.base); } catch { fail(`Invalid base URL: ${a.base}`); }
  }

  // HEAD config.json (best-effort, не фейлим)
  for (const a of arr) {
    try {
      const url = new URL('config.json', a.base).toString();
      const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (!res || !res.ok) warn(`config.json not reachable for ${a.key}`);
    } catch {
      warn(`HEAD request failed for ${a.key}`);
    }
  }
}

async function validateGallery() {
  const galleryRoot = path.join(ROOT, 'albums', 'gallery');
  const dirs = await fs.readdir(galleryRoot, { withFileTypes: true }).catch(() => null);
  if (!dirs) { warn('albums/gallery not found — skip'); return; }

  for (const d of dirs) {
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
      if (it && it.type === 'html') {
        if (!it.src) warn(`html slide without src in ${d.name}`);
      } else {
        const ok = it && (it.formats?.full || it.src);
        if (!ok) warn(`image item without formats in ${d.name}`);
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
