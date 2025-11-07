#!/usr/bin/env node
/**
 * Генерация index.json для albums/gallery/<id>/*
 * ВАЖНО: один логический кадр = один элемент в index.json (не дублируем форматы)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const GALLERY_ROOT = path.join(ROOT, 'albums', 'gallery');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const HTML_EXT = new Set(['.html', '.htm']);
const THUMBS_DIR = 'thumbs';
const THUMB_WIDTH = 480;

async function ensureDir(p) { 
  await fs.mkdir(p, { recursive: true }); 
}

async function fileExists(p) { 
  try { 
    await fs.access(p); 
    return true; 
  } catch { 
    return false; 
  } 
}

function asRel(p) { 
  return p.replace(ROOT + path.sep, '').split(path.sep).join('/'); 
}

async function getImageMeta(p) {
  try {
    const s = sharp(p);
    const meta = await s.metadata();
    const st = await fs.stat(p);
    return { 
      width: meta.width || null, 
      height: meta.height || null, 
      size: st.size || null 
    };
  } catch {
    try {
      const st = await fs.stat(p);
      return { width: null, height: null, size: st.size || null };
    } catch {
      return { width: null, height: null, size: null };
    }
  }
}

async function convertIfMissing(srcPath, targetPath, fmt) {
  if (await fileExists(targetPath)) return true;
  try {
    const image = sharp(srcPath);
    if (fmt === 'webp') {
      await image.webp({ quality: 80 }).toFile(targetPath);
    } else if (fmt === 'thumb') {
      await image.resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(targetPath);
    }
    return true;
  } catch (e) {
    console.warn('convertIfMissing fail:', srcPath, '->', targetPath, e?.message);
    return false;
  }
}

async function processGalleryDir(absDir) {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile()).map(e => e.name);

  // HTML файлы
  const htmls = files.filter(f => HTML_EXT.has(path.extname(f).toLowerCase())).sort();

  // Группируем изображения по базовому имени (без расширения)
  const imageGroups = new Map();
  
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!IMG_EXT.has(ext)) continue;
    
    // Пропускаем миниатюры
    if (f.includes('-thumb.') || f.includes('@')) continue;
    
    const base = f.slice(0, -ext.length);
    if (!imageGroups.has(base)) {
      imageGroups.set(base, []);
    }
    imageGroups.get(base).push({ name: f, ext });
  }

  const items = [];

  // Добавляем HTML файлы
  for (const f of htmls) {
    items.push({ 
      type: 'html', 
      src: asRel(path.join(absDir, f)) 
    });
  }

  // Обрабатываем каждую группу изображений как ОДИН элемент
  const sortedGroups = Array.from(imageGroups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  
  for (const [base, variants] of sortedGroups) {
    // Выбираем лучший исходник для метаданных
    const priorityOrder = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
    let sourceFile = variants[0];
    
    for (const ext of priorityOrder) {
      const found = variants.find(v => v.ext === ext);
      if (found) {
        sourceFile = found;
        break;
      }
    }

    const sourceAbsPath = path.join(absDir, sourceFile.name);
    
    // Генерируем WebP и миниатюру при необходимости
    const webpPath = path.join(absDir, `${base}.webp`);
    const thumbsDir = path.join(absDir, THUMBS_DIR);
    const thumbPath = path.join(thumbsDir, `${base}-thumb.jpg`);
    
    await ensureDir(thumbsDir);
    await convertIfMissing(sourceAbsPath, webpPath, 'webp');
    await convertIfMissing(sourceAbsPath, thumbPath, 'thumb');

    // Получаем метаданные
    const meta = await getImageMeta(sourceAbsPath);

    // Собираем все доступные форматы
    const formats = {};
    
    // Проверяем существование всех форматов
    for (const variant of variants) {
      const varPath = path.join(absDir, variant.name);
      if (await fileExists(varPath)) {
        // Устанавливаем первый найденный как full
        if (!formats.full) {
          formats.full = asRel(varPath);
        }
        
        // Добавляем специфические форматы
        if (variant.ext === '.webp') {
          formats.webp = asRel(varPath);
        } else if (variant.ext === '.avif') {
          formats.avif = asRel(varPath);
        }
      }
    }
    
    // Если webp сгенерирован, но не был в исходных
    if (!formats.webp && await fileExists(webpPath)) {
      formats.webp = asRel(webpPath);
    }
    
    // Миниатюра
    if (await fileExists(thumbPath)) {
      formats.thumb = asRel(thumbPath);
    }
    
    // Если нет full - используем webp
    if (!formats.full && formats.webp) {
      formats.full = formats.webp;
    }

    // Добавляем ОДИН элемент для всей группы форматов
    items.push({
      formats,
      width: meta.width,
      height: meta.height,
      size: meta.size
    });
  }

  // Записываем index.json
  await fs.writeFile(
    path.join(absDir, 'index.json'), 
    JSON.stringify({ items }, null, 2), 
    'utf8'
  );
  
  console.log(`Processed ${absDir}: ${items.length} items`);
}

async function main() {
  try {
    const dirs = await fg(['albums/gallery/*/'], { cwd: ROOT, onlyDirectories: true });
    
    if (!dirs.length) {
      console.log('No gallery dirs found');
      return;
    }
    
    for (const rel of dirs) {
      const abs = path.join(ROOT, rel);
      console.log('Processing gallery:', rel);
      await processGalleryDir(abs);
    }
    
    console.log('Done.');
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
