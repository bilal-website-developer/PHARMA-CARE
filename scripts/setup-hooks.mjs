import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error || result.status !== 0) {
  console.log('Git hooks were not configured (Git may be unavailable or this may not be a repository).');
}
