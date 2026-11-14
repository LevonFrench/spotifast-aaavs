// Starts a built package's sidecar exactly as the native host does (without the
// window) and checks that the page, the renderer and the AAAVS library answer.
//   node tools/check-package.mjs [<package folder>]   default: .local\spotifast-prototype\app
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { localRoot } from './project-paths.mjs';

const folder = resolve(process.argv[2] ?? join(localRoot, 'app'));
const read = name => readFileSync(join(folder, name), 'utf8').replace(/^﻿/, '').trim();
for (const name of ['SpotifastAAAVS.exe', 'node.exe', 'server/spotifast-server.mjs', 'server/spotifast-spotify.mjs', 'server/project-paths.mjs', 'aaavs-root.txt', 'renderer-path.txt', 'SPOTIFAST-LICENSE.txt'])
  assert.ok(existsSync(join(folder, name)), `package is missing ${name}`);
const root = read('aaavs-root.txt'), renderer = read('renderer-path.txt');
assert.ok(existsSync(join(renderer, 'spotifast-player.js')), 'frozen renderer has the Spotifast entry');
assert.ok(existsSync(join(renderer, 'avs-render.worker.js')), 'frozen renderer has the AAAVS workers');

const child = spawn(join(folder, 'node.exe'), [join(folder, 'server', 'spotifast-server.mjs'), '--root', root, '--engine', join(folder, 'SpotifastAAAVS.exe'), '--renderer', renderer],
  { env: { ...process.env, AAAVS_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let stderr = ''; child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
try {
  const line = await new Promise((yes, no) => {
    createInterface({ input: child.stdout }).once('line', yes);
    child.once('exit', code => no(Error(`sidecar exited (${code}): ${stderr}`)));
    setTimeout(() => no(Error('sidecar did not report a URL in 20 s: ' + stderr)), 20000);
  });
  // The host is given the address with its session secret after '#'; only the origin is used here.
  const url = String(JSON.parse(line).url).split('#')[0]; assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const page = await fetch(url); assert.equal(page.status, 200);
  const html = await page.text(); assert.ok(html.includes('dist/player/spotifast-player.js') && html.includes('Spotifast + AAAVS'));
  for (const path of ['dist/player/spotifast-player.js', 'dist/player/avs-render.worker.js', 'avs%20presets/catalog/presets.json']) assert.equal((await fetch(url + path)).status, 200, path);
  for (const path of ['server/spotifast-server.mjs', 'aaavs-root.txt', 'tools/serve.mjs']) assert.equal((await fetch(url + path)).status, 404, path + ' must not be served');
  console.log(`Package check PASS: ${folder} (sidecar from the package, renderer ${renderer}, library from ${root}). The window itself was not opened.`);
} finally { child.stdin.end(); child.kill(); }
