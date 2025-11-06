/* eslint-disable no-console */
"use strict";

/**
 * Генератор контекста .meta:
 * - .meta/project-full.txt      — заголовок + список текстовых файлов (полные пути) + содержимое
 * - .meta/project-adaptive.txt  — урезанная версия по приоритетам и лимиту строк
 *
 * Адаптировано под проект «Витрина Разбита» (GitHub Pages, статический PWA):
 *  - Критично: index.html, service-worker.js, manifest.json, albums.json, custom.json, news.html,
 *              albums/gallery/*/index.json, .github/workflows/optimize-images.yml, generate-index.js
 *  - High:     ./AudioController.js, ./GlobalState.js (если есть), ./news.html в деталях,
 *              *.yml, *.yaml (workflow/конфиги), вспомогательные скрипты
 *  - Medium:   прочие *.js/*.json/*.html
 */

const fs = require("fs");
const path = require("path");

// --------------------- CLI ---------------------
const argv = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, ...rest] = arg.replace(/^--/, "").split("=");
    return [k, rest.join("=") === "" ? true : rest.join("=")];
  })
);

const PROJECT_ROOT = path.resolve(argv.root || __dirname);
const META_DIR = path.resolve(argv["out-dir"] || path.join(PROJECT_ROOT, ".meta"));
const MODE = (argv.mode || "both").toLowerCase(); // full | adaptive | both
const ADAPTIVE_MAX_LINES = Number(argv["max-lines"] || 20000);

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

const FULL_FILE = path.join(META_DIR, "project-full.txt");
const ADAPTIVE_FILE = path.join(META_DIR, "project-adaptive.txt");

// --------------------- Конфигурация ---------------------
const CONFIG = {
  scanExclude: [
    "node_modules/**",
    ".git/**",
    ".next/**",
    "dist/**",
    "build/**",
    "out/**",
    "coverage/**",
    ".meta/**",
    ".vscode/**",
    ".idea/**",
    ".cache/**",
    ".husky/**",
    "**/*.log",
    "**/*.tmp",
    ".DS_Store",
    ".eslintcache",
    ".prettiercache",
  ],
  // Только текстовые расширения
  textExts: new Set([
    ".html",".htm",".js",".mjs",".cjs",".json",".webmanifest",".md",".txt",".yml",".yaml",".css",
  ]),
  // Приоритеты (для adaptive)
  priorityRules: {
    critical: [
      /^index\.html$/,
      /^service-worker\.js$/,
      /^manifest\.json$/,
      /^albums\.json$/,
      /^custom\.json$/,
      /^news\.html$/,
      /^generate-index\.(js|mjs|cjs)$/,

      // индексы галерей
      /^albums\/gallery\/[^/]+\/index\.json$/,

      // CI для оптимизации изображений
      /^\.github\/workflows\/optimize-images\.yml$/,
    ],
    high: [
      // вспомогательные модули, если используются
      /^AudioController\.(js|mjs|cjs)$/,
      /^GlobalState\.(js|mjs|cjs)$/,

      // остальные workflow/конфиги
      /^\.github\/workflows\/.*\.(ya?ml)$/,
      // любые дополнительные json/yml настройки
      /^.*\.(ya?ml)$/,
    ],
    medium: [
      // все прочие js/json/html
      /^.*\.(js|mjs|cjs|json|html|htm|css)$/,
    ],
  },
  adaptiveLimits: {
    maxLines: ADAPTIVE_MAX_LINES,
    criticalPercentage: 60,
    highPercentage: 25,
    mediumPercentage: 15,
  },
};

// --------------------- .mccontextignore ---------------------
function loadUserIgnore() {
  const file = path.join(PROJECT_ROOT, ".mccontextignore");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.split("\n").map((l)=>l.trim()).filter((l)=>l && !l.startsWith("#"));
  } catch { return []; }
}

const EXTRA_EXCLUDE = loadUserIgnore();

// --------------------- Утилиты ---------------------
const toUnix = (p) => p.replace(/\\/g, "/");
const globToRegExp = (pattern) => {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g,"\\$")
    .replace(/\*\*/g,"___GLOBSTAR___")
    .replace(/\*/g,"[^/]*")
    .replace(/___GLOBSTAR___/g,".*");
  return new RegExp(`^${esc}$`);
};
const EXCLUDE_PATTERNS = CONFIG.scanExclude.concat(EXTRA_EXCLUDE).map(globToRegExp);
const isExcluded = (rel) => EXCLUDE_PATTERNS.some((re)=>re.test(toUnix(rel)));

function normalizedExt(file) {
  let base = path.basename(file);
  while (base.endsWith(".")) base = base.slice(0, -1);
  return path.extname(base).toLowerCase();
}
function isTextFile(rel) {
  return CONFIG.textExts.has(normalizedExt(rel));
}

function getAllProjectFiles() {
  const files = [];
  const stack = [PROJECT_ROOT];
  while (stack.length) {
    const dir = stack.pop();
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      const rel = toUnix(path.relative(PROJECT_ROOT, full)) || ".";
      // исключаем скрытые каталоги, кроме .github (нужны workflows)
      if (it.isDirectory() && it.name.startsWith(".") && it.name !== ".github") continue;
      if (isExcluded(rel)) continue;
      try {
        if (it.isDirectory()) stack.push(full);
        else if (it.isFile() && isTextFile(rel)) files.push(rel);
      } catch {}
    }
  }
  return files.sort((a,b)=>a.localeCompare(b));
}

function readFileText(rel) {
  const abs = path.join(PROJECT_ROOT, rel);
  try { return fs.readFileSync(abs, "utf8"); }
  catch (e) { return `// read error: ${e.message}`; }
}

function countLines(s){ return (s.match(/\n/g)||[]).length + (s.length?1:0); }

function getFilePriority(rel) {
  const unix = toUnix(rel);
  for (const [level, rules] of Object.entries(CONFIG.priorityRules)) {
    if (rules.some((re)=>re.test(unix))) return level;
  }
  return "low";
}

// --------------------- Заголовок ---------------------
function headerBlock(){
  const now = new Date().toISOString().replace("T"," ").slice(0,19);

  const overview = [
    "Витрина Разбита — статический PWA на GitHub Pages.",
    "Структура: index.html, service-worker.js, albums.json, custom.json, news.html;",
    "Галереи: albums/gallery/<id>/index.json (декларативная модель загрузки, WebP/thumbnail).",
    "Производительность: ленивая загрузка, предзагрузка следующего кадра, умные стратегии SW.",
  ].join("\n");

  const rules = [
    "Правила для последующей работы с этим контекстом:",
    "- Язык ответов: по умолчанию RU. Английский — если явно попросят или в именах/терминах.",
    "- Всегда указывай точные пути файлов при ссылках (например, src/app/(main)/timeline/page.tsx).",
    "- Любой код выводи ТОЛЬКО в тройных бэктиках с указанием языка, например:",
    "  ```ts",
    "  export function x() {}",
    "  ```",
    "- Не используй тяжелое форматирование. Разрешены: списки, короткие таблицы.",
    "- Если требуются изменения в файле — показывай минимальный патч (unified diff) или целиком обновлённый файл (не смешивать).",
    "- Не выдумывай зависимости и API. Если данных нет — явно скажи «нужно уточнение».",
    "- Перед архитектурой проверяй совместимость (Next 14 App Router, @xyflow/react, d3, next-intl 3.x).",
    "- Команды терминала — в блоках ```bash; секреты не логируй.",
    "- i18n: учитывай RU/EN/ORIG и фоллбеки ru→en→orig.",
    "- Даты: ISO 8601, точность (год/месяц/день), circa, календарь.",
    "- PDF в MVP — только print CSS; CJK/RTL позже (pdfmake/@react-pdf или Puppeteer).",
    "- Стиль кода: TypeScript strict, ESM-импорты, 2 пробела.",
    "- CI/Actions: сборка контекста автономна даже при сломанном приложении.",
    "- НИКОГДА не генерируй весь файл целиком; только блоки для замены со строгим указанием места.",
    "- Формат изменений: -> ФАЙЛ: путь -> НАЙТИ: [фрагмент дословно] -> ЗАМЕНИТЬ НА: [полный новый блок].",
    "- Сохраняй комментарии, форматирование и импорт-структуру.",
    "- Если удаляем блок — укажи строку перед и строку после (из реального кода).",
    "- Всегда пиши краткое обоснование, что и почему делаем.",
  ].join("\n");

  return [
    "=== ОБЗОР ПРОЕКТА (Витрина Разбита) ===",
    overview, "",
    rules, "",
    `Сгенерировано: ${now} UTC`, ""
  ].join("\n");
}

// --------------------- FULL ---------------------
function generateFullFile() {
  let content = headerBlock();
  const all = getAllProjectFiles();
  for (const rel of all) {
    const label = "/" + toUnix(rel);
    content += `\n// FILE: ${label}\n${readFileText(rel)}\n`;
  }
  return content;
}

// --------------------- ADAPTIVE ---------------------
function generateAdaptiveFile() {
  const MAX = CONFIG.adaptiveLimits.maxLines;
  let content = headerBlock();
  let current = countLines(content);

  const allText = getAllProjectFiles();
  const by = (lvl) => allText.filter((f)=>getFilePriority(f)===lvl);

  const order = [
    ["critical", Math.floor(MAX * (CONFIG.adaptiveLimits.criticalPercentage / 100))],
    ["high",     Math.floor(MAX * ((CONFIG.adaptiveLimits.criticalPercentage + CONFIG.adaptiveLimits.highPercentage) / 100))],
    ["medium",   MAX],
  ];

  for (const [lvl, limit] of order) {
    for (const rel of by(lvl)) {
      const block = `\n// FILE: /${toUnix(rel)}\n${readFileText(rel)}\n`;
      const lines = countLines(block);
      if (current + lines > limit) break;
      content += block; current += lines;
    }
  }

  if (countLines(content) > MAX) {
    const lines = content.split("\n").slice(0, MAX);
    content = lines.join("\n");
  }
  return content;
}

// --------------------- MAIN ---------------------
function main(){
  console.log(`🔧 Корень проекта: ${PROJECT_ROOT}`);
  console.log(`📂 Папка вывода: ${META_DIR}`);
  console.log(`🧭 Режим: ${MODE}`);
  if (MODE === "full" || MODE === "both") {
    const full = generateFullFile();
    fs.writeFileSync(FULL_FILE, full, "utf8");
    console.log(`✅ ${FULL_FILE} готов`);
  }
  if (MODE === "adaptive" || MODE === "both") {
    const adaptive = generateAdaptiveFile();
    fs.writeFileSync(ADAPTIVE_FILE, adaptive, "utf8");
    console.log(`✅ ${ADAPTIVE_FILE} готов`);
  }
  console.log("🎉 Готово!");
}

try { main(); } catch (e) { console.error("❌ Ошибка:", e); process.exit(1); }
