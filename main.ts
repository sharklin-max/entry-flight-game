// Emberwing Courier — entrypoint (Node 22, standard library only).
//
// Copies game/ and screenshots/ from this repository into the output
// directory and writes /output/dossier.json with buildDossier from
// vendor/makefun-game.ts, exactly as the kit's scorer rebuilds it.
// Runs twice in the grader: the output is byte-identical both times
// (files copied in sorted order, dossier built from the same bytes).

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

// The scorer's caps, from the kit's RULES.txt: dossier text 160 KiB,
// at most 4 screenshots of 256 KiB each, game/ at most 993 entries and
// 48 MiB, paths at most 1000 bytes.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

function copyTreeSorted(src, dest) {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of entries) {
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      copyTreeSorted(from, to);
    } else if (st.isFile()) {
      cpSync(from, to);
    }
    // Symlinks are skipped: the gate refuses them in game/ anyway.
  }
}

function main() {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyTreeSorted(join(repoRoot, 'game'), join(outDir, 'game'));
  copyTreeSorted(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  const dossier = buildDossier(outDir, CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const gameFiles = readdirSync(join(outDir, 'game')).length;
  const shotFiles = readdirSync(join(outDir, 'screenshots')).length;
  console.log(
    `emberwing-courier: wrote ${outDir} (game top-level ${gameFiles} entries, `
    + `${shotFiles} screenshots, dossier ${dossier.length} bytes)`,
  );
}

main();
