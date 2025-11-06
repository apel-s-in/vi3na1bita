/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Генерирует .meta/project-full.txt и .meta/project-adaptive.txt с унифицированной структурой:
 * 1) ПРАВИЛА ДЛЯ НЕЙРОСЕТЕЙ
 * 2) МЕТА-БЛОК: repo name/url, «делается средствами GitHub»
 * 3) ДЕРЕВО ПРОЕКТА (только папки/файлы; бинарные не включаем)
 * 4) ФАЙЛЫ (по приоритету): каждый отделён
 *    //=================================================
 *    // FILE: <полный путь>
 *    <полный код без сокращений>
 * 5) КРИТИЧНЫЕ ЛОГИ: сжатая выжимка (GitHub Actions, Service Worker, браузерные ошибки)
 */

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

// Настройка сканирования
const TEXT_EXTS = new Set([".html",".htm",".js",".mjs",".cjs",".ts",".tsx",".css",".json",".webmanifest",".md",".txt",".yml",".yaml"]);
const EXCLUDE = [
  "node_modules/**",".git/**",".next/**","dist/**","build/**","out/**","coverage/**",".cache/**",".vscode/**",".idea/**",
  ".husky/**",".meta/**","**/*.log",".DS_Store"
].map(globToRegExp);

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });
const FULL_FILE = path.join(META_DIR, "project-full.txt");
const ADAPTIVE_FILE = path.join(META_DIR, "project-adaptive.txt");

// Приоритеты (упорядочиваем, что попадёт раньше)
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
    /^.*\.(ya?ml)$/i,
  ],
  medium: [
    /^.*\.(js|mjs|cjs|ts|tsx|json|html?|css)$/i
  ],
};

// ---------- Утилиты ----------
function globToRegExp(pat) {
  const esc = pat.replace(/[.+^${}()|[\]\\]/g,"\\$")
    .replace(/\*\*/g,"___GLOBSTAR___")
    .replace(/\*/g,"[^/]*")
    .replace(/___GLOBSTAR___/g,".*");
  return new RegExp("^" + esc + "$");
}
const toUnix = p => p.replace(/\\/g,"/");

function isExcluded(rel) { return EXCLUDE.some(re => re.test(toUnix(rel))); }
function isTextFile(rel) { return TEXT_EXTS.has(path.extname(rel).toLowerCase()); }

function listAllFiles() {
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
      if (e.isDirectory()) st.push(full);
      else if (e.isFile() && isTextFile(rel)) res.push(rel);
    }
  }
  return res.sort();
}

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

function repoMeta() {
  // Определяем имя/URL репо из origin, если доступен, иначе подсказки
  let repoUrl = "";
  try {
    const git = path.join(ROOT, ".git", "config");
    if (fs.existsSync(git)) {
      const cfg = fs.readFileSync(git, "utf8");
      const m = cfg.match(/url\s*=\s*(.+)\n/);
      if (m) repoUrl = m[1].trim();
    }
  } catch {}
  const repoName = path.basename(ROOT);

  return {
    name: repoName,
    url: repoUrl || "(укажите URL репозитория в .git/config)",
    madeWith: "Проект развёрнут и обслуживается средствами GitHub (GitHub Pages + GitHub Actions).",
  };
}

// ---------- Шапка: ПРАВИЛА ----------
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

// ---------- Мета-блок ----------
function metaBlock() {
  const meta = repoMeta();
  const desc = [
    'Название репозитория: ' + meta.name,
    'Адрес репозитория: ' + meta.url,
    'Описание: Веб‑приложение (статическое PWA) для прослушивания альбомов, с галереями (albums/gallery/*/index.json), мини‑плеером, офлайн‑режимом (Service Worker), CI для оптимизации изображений и автогенерации индексов/контекста.',
    meta.madeWith,
    ''
  ].join("\n");
  return desc;
}

// ---------- Дерево проекта ----------
function buildTree() {
  // Выводим только структуру каталогов + имена файлов (текстовых) из репозитория
  const lines = [];
  function walk(dir, prefix = "") {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    // Сортируем: папки сверху
    entries.sort((a,b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : (a.isDirectory() ? -1 : 1)));

    const filtered = entries.filter(e => !isExcluded(toUnix(path.relative(ROOT, path.join(dir, e.name)))));
    const lastIdx = filtered.length - 1;

    filtered.forEach((e, idx) => {
      const pointer = (idx === lastIdx) ? "└── " : "├── ";
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        lines.push(prefix + pointer + e.name + "/");
        walk(rel, prefix + (idx === lastIdx ? "    " : "│   "));
      } else {
        // показываем только текстовые
        const projRel = toUnix(path.relative(ROOT, rel));
        if (isTextFile(projRel)) lines.push(prefix + pointer + e.name);
      }
    });
  }
  lines.push(path.basename(ROOT) + "/");
  walk(ROOT);
  return lines.join("\n") + "\n\n";
}

// ---------- Критичные логи ----------
function criticalLogsBlock() {
  // Источники:
  // - Последние workflow run logs недоступны локально — дадим инструкции по сбору (и slot).
  // - SW: в проекте можно хранить сводку ошибок (если есть) в .meta/sw-errors.txt (собирайте в runtime и загружайте артефактом)
  // - Browser: рекомендуем выводить window.__CRITICAL_LOGS__ в отдельный файл при сборке контекста (если присутствует).
  const hints = [
    "КРИТИЧНЫЕ ЛОГИ (рекомендации по сбору):",
    "- GitHub Actions: храните последние 1–3 лога в .meta/ci-last.txt (job: pages, images, context). Можно собирать curl'ом GitHub API в отдельном job и писать сюда.",
    "- Service Worker: пишите критичные ветки (install/activate/fetch ошибки) в IndexedDB + выгружайте в .meta/sw-errors.txt при сборке контекста.",
    "- Браузерные ошибки: агрегируйте window.__CRITICAL_LOGS__ и сериализуйте в .meta/browser-errors.txt (если файл существует, будет включён).",
    "",
    includeIfExists(".meta/ci-last.txt", "// Нет .meta/ci-last.txt"),
    includeIfExists(".meta/sw-errors.txt", "// Нет .meta/sw-errors.txt"),
    includeIfExists(".meta/browser-errors.txt", "// Нет .meta/browser-errors.txt"),
    "",
  ].join("\n");
  return hints;
}

function includeIfExists(rel, fallback) {
  const abs = path.join(ROOT, rel);
  try {
    if (fs.existsSync(abs)) {
      return `// >>> ${rel}\n` + fs.readFileSync(abs, "utf8");
    }
  } catch {}
  return fallback;
}

// ---------- Сортировка файлов по приоритетам ----------
function filesByPriority() {
  const all = listAllFiles();
  return {
    critical: all.filter(f => getPriority(f) === "critical"),
    high:     all.filter(f => getPriority(f) === "high"),
    medium:   all.filter(f => getPriority(f) === "medium"),
    low:      all.filter(f => getPriority(f) === "low"),
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

function buildHeader() {
  const now = new Date().toISOString().replace("T"," ").slice(0,19) + " UTC";
  return [
    rulesBlock(),
    metaBlock(),
    "СТРУКТУРА ПРОЕКТА:",
    buildTree(),
    `Сгенерировано: ${now}`,
    ""
  ].join("\n");
}

function generateFull() {
  let out = buildHeader();

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
  let out = buildHeader();
  let cur = countLines(out);

  const max = MAX_LINES;
  const groups = filesByPriority();
  const order = ["critical","high","medium"]; // low для adaptive исключим чаще всего

  for (const lvl of order) {
    for (const rel of groups[lvl]) {
      const block = fileBlock(rel);
      const L = countLines(block);
      if (cur + L > max) return out + "\n// ... (truncate)\n";
      out += block; cur += L;
    }
  }

  // Логи в adaptive — коротко
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
