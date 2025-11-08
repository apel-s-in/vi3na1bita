/* eslint-disable no-console */
"use strict";

/**
 * generate-context.js
 *
 * Генератор .meta/project-full.txt и .meta/project-adaptive.txt
 * Требования (выполнены):
 * 1) В начале — блок «ПРАВИЛА ДЛЯ НЕЙРОСЕТЕЙ», затем мета‑блок с названием/URL репозитория и пометкой про GitHub.
 * 2) СТРУКТУРА ПРОЕКТА — ПОЛНОЕ дерево ВСЕХ файлов (включая assets/), но без .git/** и .meta/**.
 *    Дополнительно защищаемся от самовключения результирующих файлов.
 * 3) После дерева — секция «ФАЙЛЫ»: только текстовые файлы, по приоритетам (critical → high → medium → low),
 *    каждый файл выводится целиком. Здесь assets/** исключаем (по вашему требованию), .meta/** тоже исключаем.
 * 4) НЕТ блока «Критичные логи».
 * 5) Adaptive-режим ограничивает общий объём строк параметром --max-lines (по умолчанию 20000).
 *
 * Запуск:
 *   node generate-context.js --mode=both --max-lines=20000
 *   node generate-context.js --mode=full
 *   node generate-context.js --mode=adaptive --out-dir=.meta
 *
 * Аргументы:
 *   --mode=both|full|adaptive
 *   --max-lines=ЧИСЛО           // только для adaptive
 *   --out-dir=ПУТЬ              // по умолчанию .meta
 *   --root=ПУТЬ                 // корень проекта (по умолчанию текущая папка)
 */

const fs = require("fs");
const path = require("path");

// -------------------- CLI --------------------
const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...r] = a.replace(/^--/, "").split("=");
    return [k, r.join("=") === "" ? true : r.join("=")];
  })
);

const ROOT     = path.resolve(argv.root || __dirname);
const META_DIR = path.resolve(argv["out-dir"] || path.join(ROOT, ".meta"));
const MODE     = (argv.mode || "both").toLowerCase(); // full | adaptive | both
const MAX_LINES = Number(argv["max-lines"] || 20000);

// Гарантируем наличие .meta
if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

const FULL_FILE    = path.join(META_DIR, "project-full.txt");
const ADAPTIVE_FILE= path.join(META_DIR, "project-adaptive.txt");

// Относительные пути к self-файлам (для защиты от самовключения)
const SELF_FULL_REL  = toUnix(path.relative(ROOT, FULL_FILE));
const SELF_ADAPT_REL = toUnix(path.relative(ROOT, ADAPTIVE_FILE));

// -------------------- Настройки --------------------

// Текстовые расширения, содержимое которых включаем в секцию «ФАЙЛЫ»
const TEXT_EXTS = new Set([
  ".html",".htm",".css",".js",".mjs",".cjs",".ts",".tsx",
  ".json",".webmanifest",".md",".txt",".yml",".yaml"
]);

/**
 * Исключения для СЕКЦИИ «ФАЙЛЫ» (только к листингу контента, НЕ к дереву):
 * - По требованию исключаем .meta/** и assets/** (не попадут в контент),
 * - Исключаем служебные каталоги.
 */
const EXCLUDE_FILES_PATTERNS = [
  "node_modules/**",
  ".git/**",
  ".meta/**",
  "assets/**",
  ".next/**","dist/**","build/**","out/**","coverage/**",
  ".cache/**",".vscode/**",".idea/**",".husky/**",
  "**/*.log",".DS_Store"
].map(globToRegExp);

/**
 * Исключения ТОЛЬКО для СТРУКТУРЫ ДЕРЕВА:
 * - По требованию показываем ВСЕ файлы, включая assets/**.
 * - Исключаем только .git/**, .meta/** и служебные каталоги (node_modules и т.п.),
 *   плюс защищаемся от самовключения итоговых файлов.
 */
const EXCLUDE_TREE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  ".meta/**",
  ".next/**","dist/**","build/**","out/**","coverage/**",
  ".cache/**",".vscode/**",".idea/**",".husky/**",
  "**/*.log",".DS_Store"
].map(globToRegExp);

// Приоритеты для секции «ФАЙЛЫ»
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

// -------------------- Утилиты --------------------
function toUnix(p) {
  return String(p).replace(/\\/g, "/");
}
function globToRegExp(pat) {
  const esc = pat
    .replace(/[.+^${}()|[\]\\]/g, "\\$")
    .replace(/\*\*/g, "___GLOBSTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___GLOBSTAR___/g, ".*");
  return new RegExp("^" + esc + "$");
}
function isTextFile(rel) {
  return TEXT_EXTS.has(path.extname(rel).toLowerCase());
}
function readText(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch (e) { return `// read error: ${e.message}`; }
}
function countLines(s) {
  return (s.match(/\n/g) || []).length + (s.length ? 1 : 0);
}

// Исключения для секции «ФАЙЛЫ»
function isExcludedForFiles(rel) {
  const u = toUnix(rel);
  if (!u) return true;
  if (u === SELF_FULL_REL || u === SELF_ADAPT_REL) return true; // защита от самовключения
  return EXCLUDE_FILES_PATTERNS.some(re => re.test(u));
}
// Исключения для дерева
function isExcludedForTree(rel) {
  const u = toUnix(rel);
  if (!u) return true;
  if (u === SELF_FULL_REL || u === SELF_ADAPT_REL) return true; // защита от самовключения
  return EXCLUDE_TREE_PATTERNS.some(re => re.test(u));
}

// -------------------- Сканирование --------------------
function listAllEntries(includeFiles = true, forTree = false) {
  const res = [];
  const stack = [ROOT];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = toUnix(path.relative(ROOT, full)) || ".";

      // Выбор правил исключения: для дерева — свои, для контента — свои
      const excluded = forTree ? isExcludedForTree(rel) : isExcludedForFiles(rel);
      if (excluded) continue;

      if (e.isDirectory()) {
        res.push({ rel, full, dir: true });
        stack.push(full);
      } else if (e.isFile() && includeFiles) {
        res.push({ rel, full, dir: false });
      }
    }
  }

  // Папки сверху, затем файлы; внутри — по алфавиту
  res.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.rel.localeCompare(b.rel)));
  return res;
}

function listTextFilesForContent() {
  return listAllEntries(true, /*forTree*/ false)
    .filter(e => !e.dir && isTextFile(e.rel))
    .map(e => e.rel);
}

// -------------------- Репозиторий --------------------
function readRepoMeta() {
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
    madeWith: "Проект делается и обслуживается средствами https://github.com/ (GitHub Pages + GitHub Actions).",
  };
}

// -------------------- Блоки заголовка --------------------
function rulesBlock() {
  return [
    "ПРАВИЛА ДЛЯ НЕЙРОСЕТЕЙ (важно для качества ответов):",
    "- Язык ответов: по умолчанию RU. Английский — если явно попросят или в именах/терминах.",
    "- Всегда начинай с полного и детального анализа всего приложения.",
    "- Всегда указывай точные пути файлов при ссылках (например, src/app/(main)/timeline/page.tsx).",
    "- Любой код выводи ТОЛЬКО в тройных бэктиках с указанием языка, например:",
    "  ```ts",
    "  export function x() {}",
    "  ```",
    "- Не используй тяжелое форматирование. Разрешены: списки, короткие таблицы.",
    "- Если требуются изменения в файле — показывай минимальный патч (unified diff) или целиком обновлённый файл (не смешивать).",
    "- Не выдумывай зависимости и API. Если данных нет — явно скажи «нужно уточнение».",
    "- Учитывай что я работаю через web интерфейс github.com и не возможности локально делать проект.",
    "- Стиль кода: TypeScript strict, ESM-импорты, 2 пробела.",
    "- НИКОГДА не генерируй весь файл project-full целиком; только блоки для замены со строгим указанием места.",
    "- Формат изменений: -> ФАЙЛ: путь -> НАЙТИ: [фрагмент дословно] -> ЗАМЕНИТЬ НА: [полный новый блок].",
    "- Если какой то файл приложения требует полной замены, то присылай именно этого файла полный и правильный (соответствующий моему проекту) файл который этого требует. ",
    "- Сохраняй комментарии, форматирование и импорт-структуру.",
    "- Если удаляем блок — укажи строку перед и строку после (из реального кода).",
    "- Всегда пиши краткое обоснование, что и почему делаем.",
    "- Очень важно прервать воспроизведение могут только кнопки Пауза, стоп и выключить таймер, при всех остальных сценариях какие бы не были плеер всегда играет и на всех устройствах, ничего другого его не может остановить или сбросить или отключить звук, вообще никакая другая функция - это базовое правило этого проигрывателя.",
    "- Приложение всегда должно корректно выполнять следующие функции: Фоновое воспроизведение и автопереход. Десктоп: при переключении на другую вкладку/сворачивании окно — музыка должна продолжать играть и автоматически переходить на следующий трек. Десктоп: показывать подсказку, если в Chrome включён «Memory Saver» (из‑за него вкладки выгружаются и музыка может остановиться), с инструкцией как добавить сайт в исключения. Мобильный: при блокировке экрана музыка продолжает играть, автоматически включается следующий трек, карточка на лок‑скрине остаётся. Мобильный: с гарнитуры и с лок‑скрина должны работать Play/Pause/Next/Prev. На лок‑скрине показывать обложку альбома (первая из галереи) и название трека/альбома/исполнителя. Обновлять метаданные при каждом переходе трека. Включаемый вручную режим «молния»: в фоне полностью замораживаем перерисовки прогресса/времени/лирики/галереи, но музыка и автопереход работают как обычно. При возвращении в окно сразу «догоняем» UI (ставим актуальный прогресс/лирику по текущей позиции). В «Ультра‑эконом» глушим анимации, «бит» (пульсацию логотипа), автопрокрутку галереи. Авто‑включение «Ультра‑эконом», если браузер сообщает saveData=true или активно «энергосбережение». Сохраняем состояние «молнии» между сессиями (localStorage). Если включён таймер сна, он имеет приоритет над «Ультра‑эконом»: всё равно останавливаем музыку по таймеру. «Ультра‑эконом» обязан соблюдать текущие режимы: Повтор, Случайный порядок, Только избранные — без изменений.",
    "- Всегда предлагай список дальнейших улучшений и критических ошибок если они встречаются во всей программе при анализе.",
    ""
  ].join("\n");
}

function metaBlock() {
  const m = readRepoMeta();
  return [
    `Название репозитория: ${m.name}`,
    `Адрес репозитория: ${m.url}`,
    "Описание: Статическое PWA (GitHub Pages): альбомы/галереи (albums/gallery/*/index.json), мини‑плеер, офлайн (Service Worker), CI (оптимизация изображений, генерация индексов/контекста).",
    m.madeWith,
    ""
  ].join("\n");
}

// -------------------- СТРУКТУРА ПРОЕКТА (дерево) --------------------
function buildFullTree() {
  const lines = [];
  lines.push(path.basename(ROOT) + "/");

  function walk(dir, prefix = "") {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    const visible = entries
      .filter(e => !isExcludedForTree(toUnix(path.relative(ROOT, path.join(dir, e.name)))))
      .sort((a, b) => (a.isDirectory() !== b.isDirectory() ? (a.isDirectory() ? -1 : 1) : a.name.localeCompare(b.name)));

    visible.forEach((e, i) => {
      const isLast = i === visible.length - 1;
      const branch = isLast ? "└── " : "├── ";
      lines.push(prefix + branch + e.name + (e.isDirectory() ? "/" : ""));
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), prefix + (isLast ? "    " : "│   "));
      }
    });
  }

  walk(ROOT);
  return lines.join("\n") + "\n\n";
}

// -------------------- Секция «ФАЙЛЫ» --------------------
function getPriority(rel) {
  const u = toUnix(rel);
  for (const [lvl, rules] of Object.entries(PRIORITY)) {
    if (rules.some(re => re.test(u))) return lvl;
  }
  return "low";
}

function groupFilesByPriority() {
  const all = listTextFilesForContent(); // уже исключены assets/.meta и прочие по EXCLUDE_FILES_PATTERNS
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
    readText(rel),
    ""
  ].join("\n");
}

// -------------------- Заголовок отчёта --------------------
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

// -------------------- Генераторы --------------------
function generateFull() {
  let out = headerBlock();

  const groups = groupFilesByPriority();
  const order = ["critical", "high", "medium", "low"];
  for (const lvl of order) {
    for (const f of groups[lvl]) {
      out += fileBlock(f);
    }
  }

  // БЕЗ блока «Критичные логи»
  return out;
}

function generateAdaptive() {
  let out = headerBlock();
  let cur = countLines(out);
  const max = MAX_LINES;

  const groups = groupFilesByPriority();
  const order = ["critical", "high", "medium"]; // low пропускаем в adaptive чаще всего

  for (const lvl of order) {
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

  // БЕЗ блока «Критичные логи»
  return out;
}

// -------------------- MAIN --------------------
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
