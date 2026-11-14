// Builds the page the desktop host shows: AAAVS's own Player build, plus this
// project's entry (src/spotifast-player.ts) bundled against the AAAVS source.
//
//   node tools/build-renderer.mjs [--out <folder>] [--skip-player-build]
//
// The output folder is self-contained and frozen: a later AAAVS build cannot
// replace chunks underneath a running app. Presets, ratings and settings are
// not copied; the sidecar serves them from the AAAVS checkout.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { aaavsRequire, aaavsRoot, localRoot, projectRoot } from './project-paths.mjs';

const flag = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const root = aaavsRoot();
const out = resolve(flag('--out') ?? join(localRoot, 'renderer-dev'));
if (out === root || out.startsWith(join(root, 'dist'))) throw Error('The renderer folder must be outside the AAAVS build output.');

if (!process.argv.includes('--skip-player-build')) {
  execFileSync('npm.cmd', ['run', 'build:player'], { cwd: root, stdio: 'inherit', shell: true });
}
const player = join(root, 'dist', 'player');
if (!existsSync(join(player, 'avs-render.worker.js'))) throw Error(`AAAVS Player build is missing: ${player}. Run without --skip-player-build.`);

rmSync(out, { recursive: true, force: true });
cpSync(player, out, { recursive: true });

const { build } = aaavsRequire()('esbuild');
await build({
  entryPoints: [join(projectRoot, 'src', 'spotifast-player.ts')],
  bundle: true, format: 'esm', target: 'es2022', outdir: out, splitting: true,
  entryNames: '[name]', chunkNames: 'spotifast-[hash]', loader: { '.wgsl': 'text' },
  plugins: [{
    name: 'aaavs-source', setup(b) {
      // `aaavs/...` is the AAAVS source tree. Nothing from it is copied into this project.
      b.onResolve({ filter: /^aaavs\// }, args => ({ path: join(root, 'src', args.path.slice('aaavs/'.length)) }));
      // Same substitution as AAAVS's tools/build-standalone.mjs: the Player loads bitmaps from the local library.
      b.onResolve({ filter: /(^|\/)bundled-bitmaps\.ts$/ }, () => ({ path: 'local-bitmap-resolver', namespace: 'mpc-local' }));
      b.onLoad({ filter: /.*/, namespace: 'mpc-local' }, () => ({ contents: 'export async function loadBundledAvsBitmapResolver(){return()=>null;}', loader: 'js' }));
    },
  }],
});
if (!existsSync(join(out, 'spotifast-player.js'))) throw Error('The Spotifast entry was not written.');
console.log(`Renderer: ${out}`);
