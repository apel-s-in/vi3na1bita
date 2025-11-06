/* eslint-disable no-console */
"use strict";

/**
 * Генератор .meta/project-full.txt и .meta/project-adaptive.txt
 * Структура:
 * 1) ПРАВИЛА ДЛЯ НЕЙРОСЕТЕЙ
 * 2) МЕТА: имя/URL репозитория, «проект делается средствами GitHub»
 * 3) СТРУКТУРА ПРОЕКТА — полное дерево (НО исключаем .git/**, .meta/**, assets/**)
 * 4) ФАЙЛЫ — только текстовые (html/js/ts/css/json/yml/md/…), по приоритету. Каждый:
 *    //=================================================
 *    // FILE: /путь
 *    <полный код без сокращений>
 *
 * ВАЖНО: нет блока «Критичные логи». НИКОГДА не включаем сами project-full.txt/adaptive.txt.
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

// Относительные пути к self-файлам (для дополнительной страховки)
const SELF_FULL_REL = toUnix(path.relative(ROOT, FULL_FILE));
const SELF_ADAPT_REL = toUnix(path.relative(ROOT, ADAPTIVE_FILE));

// Текстовые расширения, код которых включаем в «ФАЙЛЫ»
const TEXT_EXTS = new Set([
  ".html",".htm",".css",".js",".mjs",".cjs",".ts",".tsx",
  ".json",".webmanifest",".md",".txt",".yml",".yaml"
]);

// Исключения для дерева и списка файлов.
// По требованию исключаем .meta/** и assets/** (и служебные).
const EXCLUDE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  ".meta/**",
  "assets/**",
  ".next/**","dist/**","build/**","out/**","coverage/**",
  ".cache/**",".vscode/**",".idea/**",".husky/**",
  "**/*.log",".DS_Store"
].map(globToRegExp);

// Приоритеты для сортировки текстовых файлов в секции «ФАЙЛЫ»
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

// ---------- utils ----------
function globToRegExp(pat) {
  const esc = pat
    .replace(/[.+^${}()|[\]\\]/g,"\\$")
    .replace(/\*\*/g,"___GLOBSTAR___")
    .replace(/\*/g,"[^/]*")
    .replace(/___GLOBSTAR___/g,".*");
  return new RegExp("^" + esc + "$");
}
function toUnix(p) { return String(p).replace(/\\/g,"/"); }

function isExcluded(rel) {
  const u = toUnix(rel);
  if (!u) return true;
  // Жёсткий запрет самовключения результирующих файлов (доп. защита):
  if (u === SELF_FULL_REL || u === SELF_ADAPT_REL) return true;
  return EXCLUDE_PATTERNS.some(re => re.test(u));
}
function isTextFile(rel) { return TEXT_EXTS.has(path.extname(rel).toLowerCase()); }

// ---------- scan ----------
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
  res.sort((a,b)=> (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.rel.localeCompare(b.rel)));
  return res;
}
function listTextFiles() {
  return listAllEntries(true).filter(e => !e.dir && isTextFile(e.rel)).map(e => e.rel);
}

// ---------- io ----------
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { return `// read error: ${e.message}`; }
}
function countLines(s){ return (s.match(/\n/g)||[]).length + (s.length?1:0); }

// ---------- meta ----------
function repoMeta() {
  let url = "";
  try {
    const cfg = path.join(ROOT, ".git", "config");
    if (fs.existsSync(cfg)) {
      const raw = fs.readFileSync(cfg, "utf8");
      const m = raw.match(/url\s*=\s*(.+)\n/);
      if (m) url = m[1].trim();
    }
  } catch {}
  return {
    name: path.basename(ROOT),
    url: url || "(URL репозитория не обнаружен; укажите в .git/config)",
    madeWith: "Проект делается и обслуживается средствами https://github.com/ (GitHub Pages + GitHub Actions)."
  };
}

// ---------- blocks ----------
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
function metaBlock() {
  const m = repoMeta();
  return [
    `Название репозитория: ${m.name}`,
    `Адрес репозитория: ${m.url}`,
    'Описание: Статическое PWA (GitHub Pages): альбомы/галереи (albums/gallery/*/index.json), мини‑плеер, офлайн (Service Worker), CI (оптимизация изображений, генерация индексов/контекста).',
    m.madeWith,
    ''
  ].join("\n");
}
function buildTreeFull() {
  const lines = [];
  lines.push(path.basename(ROOT) + "/");
  function walk(dir, prefix = "") {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const visible = entries
      .filter(e => !isExcluded(toUnix(path.relative(ROOT, path.join(dir, e.name)))))
      .sort((a,b)=> (a.isDirectory()!==b.isDirectory()? (a.isDirectory()?-1:1) : a.name.localeCompare(b.name)));
    visible.forEach((e, idx) => {
      const isLast = idx === visible.length - 1;
      const branch = isLast ? "└── " : "├── ";
      lines.push(prefix + branch + e.name + (e.isDirectory()? "/" : ""));
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + (isLast ? "    " : "│   "));
    });
  }
  walk(ROOT);
  return lines.join("\n") + "\n\n";
}

// ---------- files ----------
function getPriority(rel) {
  const u = toUnix(rel);
  for (const [lvl, rules] of Object.entries(PRIORITY)) if (rules.some(re => re.test(u))) return lvl;
  return "low";
}
function filesByPriority() {
  const all = listTextFiles();
  return {
    critical: all.filter(f => getPriority(f) === "critical"),
    high:     all.filter(f => getPriority(f) === "high"),
    medium:   all.filter(f => getPriority(f) === "medium"),
    low:      all.filter(f => getPriority(f) === "low"),
  };
}
function fileBlock(rel) {
  return [
    "//=================================================",
    `// FILE: /${toUnix(rel)}`,
    read(rel),
    ""
  ].join("\n");
}

// ---------- header ----------
function headerBlock() {
  const now = new Date().toISOString().replace("T"," ").slice(0,19) + " UTC";
  return [
    rulesBlock(),
    metaBlock(),
    "СТРУКТУРА ПРОЕКТА:",
    buildTreeFull(),
    `Сгенерировано: ${now}`,
    ""
  ].join("\n");
}

// ---------- generators ----------
function generateFull() {
  let out = headerBlock();
  const groups = filesByPriority();
  for (const lvl of ["critical","high","medium","low"]) {
    for (const f of groups[lvl]) out += fileBlock(f);
  }
  return out; // БЕЗ блока «критичные логи»
}
function generateAdaptive() {
  let out = headerBlock();
  let cur = countLines(out);
  const max = MAX_LINES;
  const groups = filesByPriority();

  for (const lvl of ["critical","high","medium"]) {
    for (const f of groups[lvl]) {
      const block = fileBlock(f);
      const L = countLines(block);
      if (cur + L > max) {
        out += "\n// ... (truncate)\n";
        return out;
      }
      out += block; cur += L;
    }
  }
  return out; // БЕЗ блока «критичные логи»
}

function main() {
  if (MODE === "full" || MODE === "both") {
    fs.writeFileSync(FULL_FILE, generateFull(), "utf8");
    console.log(`✅ ${FULL_FILE}`);
  }
  if (MODE === "adaptive" || MODE === "both") {
    fs.writeFileSync(ADAPTIVE_FILE, generateAdaptive(), "utf8");
    console.log(`✅ ${ADAPTIVE_FILE}`);
  }
}

try { main(); } catch (e) { console.error("❌", e); process.exit(1); }
