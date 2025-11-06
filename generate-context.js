/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, ...r] = a.replace(/^--/, "").split("=");
    return [k, r.join("=") === "" ? true : r.join("=")];
  })
);

const PROJECT_ROOT = path.resolve(argv.root || __dirname);
const META_DIR = path.resolve(argv["out-dir"] || path.join(PROJECT_ROOT, ".meta"));
const MODE = (argv.mode || "both").toLowerCase(); // full | adaptive | both
const MAX_LINES = Number(argv["max-lines"] || 20000);

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

const FULL_FILE = path.join(META_DIR, "project-full.txt");
const ADAPTIVE_FILE = path.join(META_DIR, "project-adaptive.txt");

const TEXT_EXTS = new Set([".html",".htm",".js",".mjs",".cjs",".css",".json",".webmanifest",".md",".txt",".yml",".yaml"]);
const EXCLUDE = [
  "node_modules/**",".git/**",".meta/**",".vscode/**",".idea/**","dist/**","build/**","out/**",".next/**","coverage/**","**/*.log",".DS_Store"
].map(globToRegExp);

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

function listFiles() {
  const res = [];
  const st = [PROJECT_ROOT];
  while (st.length) {
    const d = st.pop();
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      const rel = toUnix(path.relative(PROJECT_ROOT, full)) || ".";
      if (isExcluded(rel)) continue;
      if (e.isDirectory()) st.push(full);
      else if (e.isFile() && isTextFile(rel)) res.push(rel);
    }
  }
  return res.sort();
}

function read(rel) {
  try { return fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"); }
  catch (e) { return `// read error: ${e.message}`; }
}
function lines(s){ return (s.match(/\n/g)||[]).length + (s.length?1:0); }

function header() {
  const now = new Date().toISOString().replace("T"," ").slice(0,19);
  return [
    "=== Витрина Разбита — контекст проекта ===",
    "PWA на GitHub Pages. Галереи: albums/gallery/*/index.json. Сервис‑воркер, офлайн.",
    "Код собирается для контекстного анализа. Бинарные файлы не включаются.",
    `Сгенерировано: ${now} UTC`,
    ""
  ].join("\n");
}

function generateFull() {
  let out = header();
  for (const f of listFiles()) out += `\n// FILE: /${toUnix(f)}\n${read(f)}\n`;
  return out;
}

function generateAdaptive() {
  let out = header();
  let cur = lines(out);
  for (const f of listFiles()) {
    const block = `\n// FILE: /${toUnix(f)}\n${read(f)}\n`;
    const l = lines(block);
    if (cur + l > MAX_LINES) break;
    out += block; cur += l;
  }
  return out;
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
try { main(); } catch (e) { console.error(e); process.exit(1); }
