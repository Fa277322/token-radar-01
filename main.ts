// main.ts — Token Radar's build step: one snapshot.json in, the whole entry out.
//
// The run has four phases, in the order the dossier implies them:
//   1. read the sealed snapshot (--input names the snapshot.json file, or a directory holding one)
//   2. score it with lib/model.ts and refuse any board that fails the gate's checks
//   3. lay the entry down in the output directory: board.json, data.js, the dashboard's own files
//      and the screenshots — every artifact the dossier will describe, in place before it runs
//   4. write dossier.json last, so it always describes exactly what is on disk
//
// Node 22, standard library only, no build step: the TypeScript here is erasable and runs as-is.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The name rule every copied file must pass: what buildDossier calls a plain name. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The smallest screenshot set an entry makes sense from: board, detail, a filtered view. */
const MIN_SCREENSHOTS = 3;

// ---------------------------------------------------------------- arguments

/** The value of one `--flag` in argv (`--flag value` or `--flag=value`), or null when absent. */
function flagValue(flag: string, argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === flag) return argv[i + 1] ?? null;
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return null;
}

/** The snapshot's path: a directory's entry is its snapshot.json; anything else is the file itself. */
function snapshotPath(input: string): string {
  try {
    if (statSync(input).isDirectory()) return join(input, 'snapshot.json');
  } catch {
    // A missing --input falls through: the existsSync check below reports it with exit 2.
  }
  return input;
}

// ---------------------------------------------------------------- copying

interface SourceFile {
  /** The path under the copied root, with '/' separators. */
  rel: string;
  abs: string;
}

/** Every regular file under `root` (dotfiles and dot-directories skipped), in walk order. */
function listFiles(root: string, rel: string = ''): SourceFile[] {
  const found: SourceFile[] = [];
  const dir = rel === '' ? root : join(root, rel);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const child = rel === '' ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) found.push(...listFiles(root, child));
    else if (e.isFile()) found.push({ rel: child, abs: join(root, e.name) });
  }
  return found;
}

/** Copy one entry directory into the output, refusing a file name the dossier would refuse; returns how many files it copied. */
function copyTree(what: string, out: string): number {
  const files = listFiles(what);
  for (const f of files) {
    const base = basename(f.abs);
    if (!PLAIN_NAME.test(base)) {
      throw new Error(`${what}/${f.rel}: a file's name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -`);
    }
    const target = join(out, f.rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(f.abs, target);
  }
  return files.length;
}

// ---------------------------------------------------------------- the run

const argv = process.argv.slice(2);
const NAME = flagValue('--name', argv) ?? 'token-radar';

function die(code: number, message: string): never {
  console.error(`${NAME}: ${message}`);
  process.exit(code);
}

function run(): void {
  const input = flagValue('--input', argv) ?? '/input';
  const output = flagValue('--output', argv) ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  const snap = snapshotPath(input);
  if (!existsSync(snap)) die(2, `no snapshot at ${snap} (--input names the snapshot.json file or its directory)`);
  const snapshot = parseSnapshot(readFileSync(snap, 'utf8'));

  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) die(1, `the board the model built fails its own checks: ${issue}`);

  // The entry, in the order the scorer reads it: the data, then the page's own files, then the cover
  // images, and only after all of that the dossier that describes them.
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  copyTree('dashboard', join(output, 'dashboard'));
  const shotsCopied = copyTree('screenshots', join(output, 'screenshots'));

  if (shotsCopied < MIN_SCREENSHOTS) {
    die(1, `screenshots/ holds ${shotsCopied} file${shotsCopied === 1 ? '' : 's'}; an entry needs at least ${MIN_SCREENSHOTS}`);
  }

  // Last, so the dossier can never describe a file that is not on disk.
  writeFileSync(
    join(output, 'dossier.json'),
    buildDossier(output, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 524288 },
      dashboard: { max_files: 400, max_bytes: 4194304 },
    }),
  );

  console.log(
    `${NAME}: ${snapshot.protocols.length} protocols in, ${snapshot.watchlist.length} on the watchlist — ` +
      `${board.length} rows scored, ${radar.early_size} early below the floor, ${radar.live_size} live set aside — ` +
      `wrote ${output}/{board.json,data.js,dashboard/,screenshots/,dossier.json}`,
  );
}

try {
  run();
} catch (err) {
  console.error(`${NAME}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
