// Where this project finds AAAVS and its own local build data.
//
// AAAVS (the visualizer) is a separate project. This one borrows its Player
// build, its library server and its Node tooling, and never copies them.
//   AAAVS_ROOT       the AAAVS checkout; default: the sibling folder ..\aaavs
//   SPOTIFAST_LOCAL  toolchain, build output and evidence; default: .local\spotifast-prototype here
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const projectRoot = resolve(import.meta.dirname, '..');
export const localRoot = resolve(process.env.SPOTIFAST_LOCAL ?? join(projectRoot, '.local', 'spotifast-prototype'));

export function aaavsRoot() {
  const root = resolve(process.env.AAAVS_ROOT ?? join(projectRoot, '..', 'aaavs'));
  if (!existsSync(join(root, 'standalone.html')) || !existsSync(join(root, 'tools', 'standalone-library.mjs'))) {
    throw Error(`AAAVS was not found at ${root}. Set AAAVS_ROOT to the AAAVS checkout.`);
  }
  return root;
}

/** require() that resolves packages from AAAVS's node_modules (esbuild, playwright-core, typescript). */
export function aaavsRequire() { return createRequire(join(aaavsRoot(), 'package.json')); }

/** import() of a module inside the AAAVS checkout, by its path from the AAAVS root. */
export function importFromAaavs(path) { return import(pathToFileURL(join(aaavsRoot(), path)).href); }
