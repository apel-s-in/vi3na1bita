/* eslint-disable no-console */
"use strict";

/**
 * Генератор .meta/project-full.txt и .meta/project-adaptive.txt
 * Структура выводов:
 * 1) ПРАВИЛА ДЛЯ НЕЙРОСЕТЕЙ
 * 2) МЕТА-БЛОК: имя/URL репозитория, «проект делается средствами GitHub»
 * 3) СТРУКТУРА ПРОЕКТА: ПОЛНОЕ дерево всех файлов (включая бинарные),
 *    исключая только .git/** и .meta/** (и прочие служебные исключения).
 * 4) ФАЙЛЫ (по приоритетам): для текстовых файлов — ПОЛНЫЙ КОД.
 *    Каждый файл отделяется:
 *    //=================================================
 *    // FILE: /полный/путь
 *    <полный код без сокращений>
 * 5) КРИТИЧНЫЕ ЛОГИ: подключение .meta/ci-last.txt, sw-errors.txt, browser-errors.txt если присутствуют.
 *
 * Запуск:
 *   node generate-context.js --mode=both --max-lines=20000
 */

const fs = require("fs");
const path = require("path");

// CLI
const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...r] = a.replace(/^--/,"").split("=");
    return [k, r.join("=") === "" ? true : r.join("=")];
  })
);

const ROOT = path.resolve(argv.root || __dirname);
const META_DIR = path.resolve(argv["out-dir"] || path.join(ROOT, ".meta"));
const MODE = (argv.mode || "both").toLowerCase(); // full | adaptive | both
const MAX_LINES = Number(argv["max-lines"] || 20000);

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });
const FULL_FILE = path.join(META_DIR, "project-full.txt");
const ADAPTIVE_FILE = path.join(META_DIR, "project-adaptive.txt");

// Расширения «текстовых» файлов, для которых будет выведен ПОЛНЫЙ КОД
const TEXT_EXTS = new Set([
  ".html",".htm",".css",".js",".mjs",".cjs",".ts",".tsx",
  ".json",".webmanifest",".md",".txt",".yml",".yaml"
]);

// Исключения (применяются и к дереву, и к выбору файлов для кода)
const EXCLUDE_PATTERNS = [
  "node_modules/**",".git/**",".meta/**",".next/**","dist/**","build/**","out/**",
  "coverage/**",".cache/**",".vscode/**",".idea/**",".husky/**","**/*.log",".DS_Store"
].map(globToRegExp);

function globToRegExp(pat) {
  const esc = pat
    .replace(/[.+^${}()|[\]\\]/g,"\\$")
    .replace(/\*\*/g,"___GLOBSTAR___")
    .replace(/\*/g,"[^/]*")
    .replace(/___GLOBSTAR___/g,".*");
  return new RegExp("^" + esc + "$");
}
const toUnix = p => p.replace(/\\/g,"/");

function isExcluded(rel) { return EXCLUDE_PATTERNS.some(re => re.test(toUnix(rel))); }
function isTextFile(rel) { return TEXT_EXTS.has(path.extname(rel).toLowerCase()); }

// -------- Приоритеты (упорядочивает список файлов-кода) --------
const PRIORITY = {
  critical: [
    /^index\.html?$/i,
    /^service-worker\.js$/i,
    /^manifest\.json$/i,
    /^albums\.json$/i,
    /^custom\.json$/i,
    /^news\.html?$/i,
    /^generate-index\.(js|mjs|cjs)$/i,
    /^albums\/gallery\/[^/]+\/index\.json$/i,
    /^\.github\/workflows\/.*\.ya?ml$/i
  ],
  high: [
    /^AudioController\.(js|mjs|cjs|ts)$/i,
    /^GlobalState\.(js|mjs|cjs|ts)$/i,
    /^scripts\/.*\.(mjs|js|ts)$/i,
    /^performance\/.*\.(js|ts)$/i,
    /^.*\.(ya?ml)$/i
  ],
  medium: [
    /^.*\.(js|mjs|cjs|ts|tsx|json|html?|css)$/i
  ],
};

// -------- Сканирование файлов --------
function listAllEntries(includeFiles = true) {
  const res = [];
  const st = [ROOT];
  while (st.length) {
    const d = st.pop();
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      const rel = toUnix(path.relative(ROOT, full)) || ".";
      if (isExcluded(rel)) continue;
      if (e.isDirectory()) {
        res.push({ rel, full, dir: true });
        st.push(full);
      } else if (e.isFile() && includeFiles) {
        res.push({ rel, full, dir: false });
      }
    }
  }
  // Отсортируем: папки сверху, затем файлы по имени
  res.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.rel.localeCompare(b.rel);
  });
  return res;
}

function listTextFilesOnly() {
  const all = listAllEntries(true);
  return all
    .filter(e => !e.dir && isTextFile(e.rel))
    .map(e => e.rel);
}

// -------- Чтение/вспомогательные --------
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { return `// read error: ${e.message}`; }
}
function countLines(s){ return (s.match(/\n/g)||[]).length + (s.length?1:0); }

function getPriority(rel) {
  const u = toUnix(rel);
  for (const [lvl, rules] of Object.entries(PRIORITY)) {
    if (rules.some(re => re.test(u))) return lvl;
  }
  return "low";
}

// -------- Repo метаданные --------
function repoMeta() {
  let repoUrl = "";
  try {
    const gitcfg = path.join(ROOT, ".git", "config");
    if (fs.existsSync(gitcfg)) {
      const cfg = fs.readFileSync(gitcfg, "utf8");
      const m = cfg.match(/url\s*=\s*(.+)\n/);
      if (m) repoUrl = m[1].trim();
    }
  } catch {}
  return {
    name: path.basename(ROOT),
    url: repoUrl || "(URL репозитория не обнаружен; укажите в .git/config)",
    madeWith: "Проект делается и обслуживается средствами https://github.com/ (GitHub Pages + GitHub Actions)."
  };
}

// -------- Шапка: ПРАВИЛА --------
function rulesBlock() {
  return [
    'ПРАВИЛА ДЛЯ НЕЙРОСЕТЕЙ (важно для качества ответов):',
    '- Язык ответов: по умолчанию RU. Английский — если явно попросят или в именах/терминах.',
    '- Всегда указывай точные пути файлов при ссылках (например, src/app/(main)/timeline/page.tsx).',
    '- Любой код выводи ТОЛЬКО в тройных бэктиках с указанием языка, например:',
    '  ```ts',
    '  export function x() {}',
    '  ```',
    '- Не используй тяжелое форматирование. Разрешены: списки, короткие таблицы.',
    '- Если требуются изменения в файле — показывай минимальный патч (unified diff) или целиком обновлённый файл (не смешивать).',
    '- Не выдумывай зависимости и API. Если данных нет — явно скажи «нужно уточнение».',
    '- Перед архитектурой проверяй совместимость (Next 14 App Router, @xyflow/react, d3, next-intl 3.x).',
    '- Команды терминала — в блоках ```bash; секреты не логируй.',
    '- i18n: учитывай RU/EN/ORIG и фоллбеки ru→en→orig.',
    '- Даты: ISO 8601, точность (год/месяц/день), circa, календарь.',
    '- PDF в MVP — только print CSS; CJK/RTL позже (pdfmake/@react-pdf или Puppeteer).',
    '- Стиль кода: TypeScript strict, ESM-импорты, 2 пробела.',
    '- CI/Actions: сборка контекста автономна даже при сломанном приложении.',
    '- НИКОГДА не генерируй весь файл целиком; только блоки для замены со строгим указанием места.',
    '- Формат изменений: -> ФАЙЛ: путь -> НАЙТИ: [фрагмент дословно] -> ЗАМЕНИТЬ НА: [полный новый блок].',
    '- Сохраняй комментарии, форматирование и импорт-структуру.',
    '- Если удаляем блок — укажи строку перед и строку после (из реального кода).',
    '- Всегда пиши краткое обоснование, что и почему делаем.',
    ''
  ].join("\n");
}

// -------- Мета-блок --------
function metaBlock() {
  const m = repoMeta();
  return [
    `Название репозитория: ${m.name}`,
    `Адрес репозитория: ${m.url}`,
    'Описание: Статическое PWA на GitHub Pages — альбомы/галереи (albums/gallery/*/index.json), мини‑плеер, офлайн (Service Worker), CI (оптимизация изображений, генерация индексов/контекста).',
    m.madeWith,
    ''
  ].join("\n");
}

// -------- Полное дерево проекта (включая бинарные) --------
function buildFullTree() {
  const lines = [];
  const rootName = path.basename(ROOT);
  lines.push(rootName + "/");

  function walk(dir, prefix = "") {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    // Отфильтровать исключения, отсортировать: папки, затем файлы
    const visible = entries.filter(e => {
      const rel = toUnix(path.relative(ROOT, path.join(dir, e.name)));
      return !isExcluded(rel);
    }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    visible.forEach((e, idx) => {
      const isLast = idx === visible.length - 1;
      const pointer = isLast ? "└── " : "├── ";
      const mark = prefix + pointer + e.name + (e.isDirectory() ? "/" : "");
      lines.push(mark);
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, prefix + (isLast ? "    " : "│   "));
    });
  }

  walk(ROOT);
  return lines.join("\n") + "\n\n";
}

// -------- Критичные логи --------
function includeIfExists(rel) {
  const abs = path.join(ROOT, rel);
  try {
    if (fs.existsSync(abs)) {
      return `// >>> ${rel}\n` + fs.readFileSync(abs, "utf8") + "\n";
    }
  } catch {}
  return "";
}
function criticalLogsBlock() {
  const hints = [
    "КРИТИЧНЫЕ ЛОГИ:",
    "- .meta/ci-last.txt — краткая сводка последних прогонов CI (деплой, оптимизация изображений и т.п.).",
    "- .meta/sw-errors.txt — критичные ошибки Service Worker (install/activate/fetch).",
    "- .meta/browser-errors.txt — агрегированные ошибки браузера (window.onerror/unhandledrejection).",
    "",
  ].join("\n");
  return hints
    + includeIfExists(".meta/ci-last.txt")
    + includeIfExists(".meta/sw-errors.txt")
    + includeIfExists(".meta/browser-errors.txt");
}

// -------- Группировка файлов по приоритетам --------
function filesByPriority() {
  const textFiles = listTextFilesOnly();
  return {
    critical: textFiles.filter(f => getPriority(f) === "critical"),
    high:     textFiles.filter(f => getPriority(f) === "high"),
    medium:   textFiles.filter(f => getPriority(f) === "medium"),
    low:      textFiles.filter(f => getPriority(f) === "low"),
  };
}

function fileBlock(rel) {
  const code = read(rel);
  return [
    "//=================================================",
    `// FILE: /${toUnix(rel)}`,
    code,
    ""
  ].join("\n");
}

function headerBlock() {
  const now = new Date().toISOString().replace("T"," ").slice(0,19) + " UTC";
  return [
    rulesBlock(),
    metaBlock(),
    "СТРУКТУРА ПРОЕКТА:",
    buildFullTree(),
    `Сгенерировано: ${now}`,
    ""
  ].join("\n");
}

// -------- Генераторы --------
function generateFull() {
  let out = headerBlock();

  const groups = filesByPriority();
  const order = ["critical","high","medium","low"];

  for (const lvl of order) {
    for (const rel of groups[lvl]) {
      out += fileBlock(rel);
    }
  }

  out += criticalLogsBlock();
  return out;
}

function generateAdaptive() {
  let out = headerBlock();
  let cur = countLines(out);

  const max = MAX_LINES;
  const groups = filesByPriority();
  const order = ["critical","high","medium"];

  for (const lvl of order) {
    for (const rel of groups[lvl]) {
      const block = fileBlock(rel);
      const L = countLines(block);
      if (cur + L > max) {
        out += "\n// ... (truncate)\n";
        return out;
      }
      out += block; cur += L;
    }
  }

  // Логи — коротко, если помещаются
  const logs = criticalLogsBlock();
  const Llogs = countLines(logs);
  if (cur + Llogs <= max) out += logs;
  return out;
}

function main() {
  if (MODE === "full" || MODE === "both") {
    const full = generateFull();
    fs.writeFileSync(FULL_FILE, full, "utf8");
    console.log(`✅ ${FULL_FILE}`);
  }
  if (MODE === "adaptive" || MODE === "both") {
    const adaptive = generateAdaptive();
    fs.writeFileSync(ADAPTIVE_FILE, adaptive, "utf8");
    console.log(`✅ ${ADAPTIVE_FILE}`);
  }
}

try { main(); } catch (e) { console.error("❌", e); process.exit(1); }
