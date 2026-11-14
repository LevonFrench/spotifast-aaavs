// Type-checks src against the AAAVS source, with AAAVS's own TypeScript.
// tsconfig.json assumes the sibling layout (..\aaavs); AAAVS_ROOT elsewhere is not supported by this check.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { aaavsRoot, projectRoot } from './project-paths.mjs';
const root = aaavsRoot();
if (root !== resolve(projectRoot, '..', 'aaavs')) { console.log('check-types: skipped, AAAVS is not in the sibling folder.'); process.exit(0); }
execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(projectRoot, 'tsconfig.json')], { stdio: 'inherit' });
console.log('check-types: PASS');
