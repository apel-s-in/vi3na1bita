const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// Локальная синхронная проверка существования файла
function existsSyncSafely(p) {
  try { fsSync.accessSync(p); return true; } catch { return false; }
}

// Базовая директория галерей
const GALLERY_BASE = './albums/gallery';

// Функция для получения размеров изображения (простая, без внешних зависимостей)
async function getImageSize(imagePath) {
  // Для простоты и избежания внешних зависимостей, мы не будем читать EXIF.
  // Вы можете вручную добавить это позже или использовать отдельный скрипт.
  // Пока вернём заглушку.
  return { width: 0, height: 0 };
}

// Основная функция генерации
async function generateIndex() {
  try {
    const albumDirs = await fs.readdir(GALLERY_BASE, { withFileTypes: true });
    
    for (const dir of albumDirs) {
      if (!dir.isDirectory()) continue;

      const albumPath = path.join(GALLERY_BASE, dir.name);
      const files = await fs.readdir(albumPath);
      
      const items = [];
      
      // Фильтруем и обрабатываем только изображения и HTML
      for (const file of files) {
        if (file === 'index.json') continue; // Пропускаем сам index.json
        
        const filePath = path.join(albumPath, file);
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) continue;
        
        const ext = path.extname(file).toLowerCase();
        
        if (ext === '.html') {
          // Обработка HTML
          items.push({
            type: 'html',
            src: file
          });
        } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
          // Обработка изображений
          // Игнорируем превью и миниатюры
          if (file.includes('-thumb.') || file.includes('@') || file.startsWith('thumb')) {
            continue;
          }
          
          const basename = path.basename(file, ext);
          const formats = {};
          
          // Пытаемся найти все форматы
          const webpPath = path.join(albumPath, `${basename}.webp`);
          const thumbPath = path.join(albumPath, 'thumbs', `${basename}-thumb.jpg`);
          
          if (files.includes(`${basename}.webp`)) {
            formats.webp = `${basename}.webp`;
          }
          if (existsSyncSafely(thumbPath)) {
            formats.thumb = `thumbs/${basename}-thumb.jpg`;
          }
          // Формат 'full' всегда указывает на исходный файл
          formats.full = file;
          
          const size = await getImageSize(filePath);
          
          items.push({
            id: basename,
            formats,
            width: size.width,
            height: size.height,
            // Мы не можем легко получить размер файла без синхронной операции,
            // но это не критично для первого релиза.
            // size: stats.size
          });
        }
      }
      
      // Сортируем элементы по имени для консистентности
      items.sort((a, b) => {
        const nameA = a.id || a.src || '';
        const nameB = b.id || b.src || '';
        return nameA.localeCompare(nameB);
      });
      
      // Создаём итоговый объект
      const indexData = {
        items,
        total: items.length
      };
      
      // Записываем в файл
      const indexPath = path.join(albumPath, 'index.json');
      await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
      console.log(`Generated ${indexPath}`);
    }
    
    console.log('✅ All index.json files have been generated.');
  } catch (err) {
    console.error('❌ Error generating index.json:', err);
    process.exit(1);
  }
}

// Запускаем скрипт
generateIndex();
