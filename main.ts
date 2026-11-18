// main.ts — build the token-radar bundle from a sealed snapshot:
// board.json, data.js, a copy of dashboard/ and screenshots/, then dossier.json last.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, boardIssue, dataScript, parseSnapshot, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function argValue(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  // A missing or flag-shaped value falls through to the default instead of eating another flag.
  return value !== undefined && !value.startsWith('--') ? value : undefined;
}

function fail(code: number, message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

function statOrNull(path: string): import('node:fs').Stats | null {
  return statSync(path, { throwIfNoEntry: false }) ?? null;
}

/** Copy the regular, non-dot files of srcDir into destDir; returns the names copied. */
function copyTree(srcDir: string, destDir: string): string[] {
  const copied: string[] = [];
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (entry.startsWith('.')) continue;
    const st = statOrNull(join(srcDir, entry));
    if (st === null || !st.isFile()) continue;
    copyFileSync(join(srcDir, entry), join(destDir, entry));
    copied.push(entry);
  }
  return copied;
}

// -- read and score the snapshot --------------------------------------------

const inputArg = argValue('--input') ?? '/input';
const inputStat = statOrNull(inputArg);
if (inputStat === null) fail(2, `no snapshot input at ${inputArg} (pass --input <file-or-directory>)`);
const inputPath = inputStat.isDirectory() ? join(inputArg, 'snapshot.json') : inputArg;
if (statOrNull(inputPath) === null) fail(2, `no snapshot.json at ${inputPath}`);

let snapshot: Snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
} catch (err) {
  fail(1, err instanceof Error ? err.message : String(err));
}

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(1, issue);

// -- write the bundle ---------------------------------------------------------

const outDir = argValue('--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const repoRoot = dirname(fileURLToPath(import.meta.url));
for (const dir of ['dashboard', 'screenshots']) {
  const st = statOrNull(join(repoRoot, dir));
  if (st === null || !st.isDirectory()) fail(1, `missing ${dir}/ beside main.ts`);
}

let dashboardFiles: string[] = [];
let screenshotFiles: string[] = [];
try {
  dashboardFiles = copyTree(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
  screenshotFiles = copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
} catch (err) {
  fail(1, `cannot copy dashboard/ and screenshots/: ${err instanceof Error ? err.message : String(err)}`);
}

const badName = screenshotFiles.find((name) => !SCREENSHOT_NAME.test(name));
if (badName !== undefined) fail(1, `screenshot name ${JSON.stringify(badName)} fails ${SCREENSHOT_NAME}`);
if (screenshotFiles.length < 3) fail(1, `expected at least 3 screenshots, copied ${screenshotFiles.length}`);

try {
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4194304 },
    }),
  );
} catch (err) {
  fail(1, err instanceof Error ? err.message : String(err));
}

console.log(
  `token-radar ${radar.as_of}: ${snapshot.protocols.length} protocols, ${radar.watchlist_size} watchlist slugs, ` +
    `${radar.board_size} rows scored, ${radar.early_size} early rows, ${radar.live_size} live rows set aside; ` +
    `${dashboardFiles.length} dashboard files, ${screenshotFiles.length} screenshots, dossier written last.`,
);
