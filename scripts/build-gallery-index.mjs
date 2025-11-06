#!/usr/bin/env node
/**
 * Генерация index.json для albums/gallery/<id>/*
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import sharp from 'sharp';

const ROOT = path.resolve(process.cwd());
const GALLERY_ROOT = path.join(ROOT, 'albums', 'gallery');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']); // AVIF убран
const HTML_EXT = new Set(['.html', '.htm']);
const THUMBS_DIR = 'thumbs';
const THUMB_WIDTH = 480;

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }
function asRel(p) { return p.replace(ROOT + path.sep, '').split(path.sep).join('/'); }

async function getImageMeta(p) {
  try {
    const s = sharp(p);
    const meta = await s.metadata();
    const st = await fs.stat(p);
    return { width: meta.width || null, height: meta.height || null, size: st.size || null };
  } catch {
    const st = await fs.stat(p).catch(() => ({ size: null }));
    return { width: null, height: null, size: st.size || null };
  }
}
async function convertIfMissing(srcPath, targetPath, fmt) {
  if (await fileExists(targetPath)) return true;
  try {
    const image = sharp(srcPath);
    if (fmt === 'webp')      await image.webp({ quality: 80 }).toFile(targetPath);
    else if (fmt === 'thumb')await image.resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(targetPath);
    return true;
  } catch (e) {
    console.warn('convertIfMissing fail:', srcPath, '->', targetPath, e?.message);
    return false;
  }
}
function toFormats(baseDir, fileName) {
  const p = path.join(baseDir, fileName);
  const ext = path.extname(p).toLowerCase();
  if (!IMG_EXT.has(ext)) return null;
  const nameNoExt = fileName.slice(0, -ext.length);
  const fullAbs = path.join(baseDir, `${nameNoExt}${ext}`);
  const full = asRel(fullAbs);
  const webp = asRel(path.join(baseDir, `${nameNoExt}.webp`));
  const dirThumbs = path.join(baseDir, THUMBS_DIR);
  const thumbAbs = path.join(dirThumbs, `${nameNoExt}-thumb.jpg`);
  const thumb = asRel(thumbAbs);
  return { fullAbs, full, webp, thumbAbs, dirThumbs };
}

async function processGalleryDir(absDir) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile()).map(e => e.name);

  const htmls = files.filter(f => HTML_EXT.has(path.extname(f).toLowerCase())).sort();

  // Группируем изображения по базовому имени (без расширения): один логический кадр = один item
  const byBase = new Map();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!IMG_EXT.has(ext)) continue;
    const base = f.slice(0, -ext.length);
    const list = byBase.get(base) || [];
    list.push({ name: f, ext });
    byBase.set(base, list);
  }

  // Порядок предпочтения исходника (что конвертировать в другие форматы)
  const SRC_ORDER = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

  const items = [];

  for (const f of htmls) {
    items.push({ type: 'html', src: asRel(path.join(absDir, f)) });
  }

  for (const [base, variants] of Array.from(byBase.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    // Выбираем лучший исходник
    const pick = SRC_ORDER.find(ext => variants.some(v => v.ext === ext)) || variants[0].ext;
    const chosen = variants.find(v => v.ext === pick) || variants[0];

    const fm = toFormats(absDir, chosen.name);
    if (!fm) continue;

    await ensureDir(fm.dirThumbs);
    // Производные: только WebP и превью
    await convertIfMissing(fm.fullAbs, path.join(absDir, `${base}.webp`), 'webp');
    await convertIfMissing(fm.fullAbs, fm.thumbAbs, 'thumb');

    const meta = await getImageMeta(fm.fullAbs);
    // Полноразмер для показа — WebP; 'full' = webp
    items.push({
      formats: { full: fm.webp, webp: fm.webp, thumb: fm.thumb },
      width: meta.width, height: meta.height, size: meta.size
    });
  }

  await fs.writeFile(path.join(absDir, 'index.json'), JSON.stringify({ items }, null, 2), 'utf8');
}

async function main() {
  const dirs = await fg(['albums/gallery/*/'], { cwd: ROOT, onlyDirectories: true });
  if (!dirs.length) { console.log('No gallery dirs found'); return; }
  for (const rel of dirs) {
    const abs = path.join(ROOT, rel);
    console.log('Processing gallery:', rel);
    await processGalleryDir(abs);
  }
  console.log('Done.');
}
main().catch((e) => { console.error(e); process.exit(1); });
