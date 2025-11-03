#!/usr/bin/env node
/**
 * Генерация index.json для центральной галереи и создание производных форматов:
 * - Поиск директорий: albums/gallery/<id>/
 * - Для изображений: создаёт недостающие .webp, .avif и миниатюры thumbs/<name>-thumb.jpg
 * - Собирает items в index.json со структурами formats + метаданными width/height/size
 * - Поддерживает HTML-слайды (type=html)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..', '..');
const GALLERY_ROOT = path.join(ROOT, 'albums', 'gallery');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const HTML_EXT = new Set(['.html', '.htm']);
const THUMBS_DIR = 'thumbs';
const THUMB_WIDTH = 480;

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function asRel(p) {
  return p.split(path.sep).join('/').replace(/^\.\//, '');
}

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
    if (fmt === 'webp') {
      await image.webp({ quality: 80 }).toFile(targetPath);
    } else if (fmt === 'avif') {
      await image.avif({ quality: 60, effort: 4 }).toFile(targetPath);
    } else if (fmt === 'thumb') {
      await image.resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(targetPath);
    }
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
  const dirThumbs = path.join(baseDir, THUMBS_DIR);
  const full = asRel(path.join(baseDir, `${nameNoExt}${ext}`));
  const webp = asRel(path.join(baseDir, `${nameNoExt}.webp`));
  const avif = asRel(path.join(baseDir, `${nameNoExt}.avif`));
  const thumb = asRel(path.join(dirThumbs, `${nameNoExt}-thumb.jpg`));
  return { srcFullAbs: path.join(baseDir, `${nameNoExt}${ext}`), full, webp, avif, thumbPathAbs: path.join(dirThumbs, `${nameNoExt}-thumb.jpg`), dirThumbs };
}

async function processGalleryDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile()).map(e => e.name);
  const htmls = files.filter(f => HTML_EXT.has(path.extname(f).toLowerCase()));
  const imgs = files.filter(f => IMG_EXT.has(path.extname(f).toLowerCase()));

  // Сортировка по имени
  htmls.sort((a, b) => a.localeCompare(b, 'ru'));
  imgs.sort((a, b) => a.localeCompare(b, 'ru'));

  const items = [];

  // Слайды HTML
  for (const f of htmls) {
    items.push({
      type: 'html',
      src: asRel(path.join(dir, f))
    });
  }

  // Изображения
  for (const f of imgs) {
    const fm = toFormats(dir, f);
    if (!fm) continue;

    // Создаём директорию thumbs
    await ensureDir(fm.dirThumbs);

    // Генерируем производные, если нет
    await convertIfMissing(fm.srcFullAbs, path.join(dir, `${path.parse(f).name}.webp`), 'webp');
    await convertIfMissing(fm.srcFullAbs, path.join(dir, `${path.parse(f).name}.avif`), 'avif');
    await convertIfMissing(fm.srcFullAbs, fm.thumbPathAbs, 'thumb');

    const meta = await getImageMeta(fm.srcFullAbs);
    items.push({
      formats: {
        full: fm.full,
        webp: fm.webp,
        avif: fm.avif,
        thumb: fm.thumb
      },
      width: meta.width,
      height: meta.height,
      size: meta.size
    });
  }

  const out = { items };
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(out, null, 2), 'utf8');
  return out;
}

async function main() {
  const dirs = await fg(['albums/gallery/*/'], { cwd: ROOT, onlyDirectories: true, dot: false });
  if (!dirs.length) {
    console.log('No gallery dirs found.');
    return;
  }
  for (const rel of dirs) {
    const abs = path.join(ROOT, rel);
    console.log('Processing gallery:', rel);
    await processGalleryDir(abs);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
