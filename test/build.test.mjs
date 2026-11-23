// The generator must stop when the data contradict each other. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'hub', 'build.mjs');
const env = { ...process.env, AION_NO_SHOTS: '1' };

function run(guide, out) {
  return spawnSync(process.execPath, [build, guide, out], { env, encoding: 'utf8' });
}

// Work on a copy of one class folder so the originals are never touched.
function copyClass(name = 'ranger') {
  const dir = mkdtempSync(join(tmpdir(), 'aion-guide-'));
  cpSync(join(root, 'data', 'classes', name), join(dir, name), { recursive: true });
  mkdirSync(join(dir, 'out'));
  return dir;
}

test('the untouched data build', () => {
  const dir = copyClass();
  const r = run(join(dir, 'ranger', 'guide.json'), join(dir, 'out'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('a reference to a skill that does not exist stops the build', () => {
  const dir = copyClass();
  const f = join(dir, 'ranger', 'guide.json');
  const s = readFileSync(f, 'utf8');
  const m = s.match(/\[\[([a-z0-9-]+)\]\]/);
  assert.ok(m, 'the guide has at least one [[skill]] reference');
  writeFileSync(f, s.replace(m[0], '[[no-such-skill]]'), 'utf8');
  const r = run(f, join(dir, 'out'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /no-such-skill/);
});

test('a source that is not in the list stops the build', () => {
  const dir = copyClass('gladiator');
  const f = join(dir, 'gladiator', 'guide.json');
  const s = readFileSync(f, 'utf8');
  const m = s.match(/\[\^([a-z0-9-]+)\]/);
  assert.ok(m, 'the guide cites at least one source');
  writeFileSync(f, s.replace(m[0], '[^no-such-source]'), 'utf8');
  const r = run(f, join(dir, 'out'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /no-such-source/);
});
