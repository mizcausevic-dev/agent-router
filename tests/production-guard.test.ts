import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

for (const modulePath of ['./src/index', './src/routes/index']) {
  test(`production import refuses ${modulePath}`, () => {
    const result = spawnSync(
      process.execPath,
      ['--require', 'ts-node/register', '-e', `require(${JSON.stringify(modulePath)})`],
      {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'production' },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );

    assert.equal(result.status, 1, result.error?.message || result.stderr);
    assert.match(result.stderr, /production runtime disabled/);
  });
}
