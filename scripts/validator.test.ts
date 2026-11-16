import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateMetadata, validatePolicy } from '@lazydata/validator';
import policy from '@lazydata/validator/policy' with { type: 'json' };
import { validateDataPackage } from '@lazydata/validator/repository';

const repository = fileURLToPath(new URL('../', import.meta.url));

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'template-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const descriptor = {
    name: 'example-dataset', title: 'Example dataset', description: 'Fictional consumer fixture.',
    keywords: ['task:example', 'project:example', 'stage:master'],
    resources: [{ name: 'input', title: 'Example input', path: 'input.csv', count: 999, bytes: 14 }],
  };
  writeFileSync(join(root, 'input.csv'), 'value\nexample\n');
  writeFileSync(join(root, 'datapackage.json'), JSON.stringify(descriptor));
  writeFileSync(join(root, 'README.md'), '# Handwritten\n\n<!-- notes -->\nKeep these notes.\n');
  return { root, descriptor };
}

function validate(root: string) {
  const result = spawnSync('pnpm', ['--silent', 'validate', root], {
    cwd: repository, encoding: 'utf8', timeout: 15_000,
  });
  assert.ifError(result.error);
  return result;
}

function snapshot(root: string) {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    const stat = statSync(path);
    return { name, mode: stat.mode, modified: stat.mtimeMs, contents: readFileSync(path) };
  });
}

test('the installed code and bundled policy accept the template dataset', () => {
  const descriptor: unknown = JSON.parse(readFileSync(join(repository, 'datapackage.json'), 'utf8'));
  assert.deepEqual(validatePolicy(policy), []);
  assert.deepEqual(validateMetadata(descriptor, policy), []);
  assert.deepEqual(validateDataPackage(descriptor, repository), []);
});

test('pnpm validate leaves dataset files unchanged on success and failure', (t) => {
  const { root, descriptor } = fixture(t);
  for (const invalid of [false, true]) {
    writeFileSync(join(root, 'datapackage.json'), JSON.stringify({ ...descriptor, title: invalid ? ' ' : descriptor.title }));
    const before = snapshot(root);
    const result = validate(root);
    assert.equal(result.status, invalid ? 1 : 0, result.stderr);
    if (invalid) assert.match(result.stderr, /title must be nonempty text/);
    else assert.equal(result.stdout, 'datapackage.json: valid\n');
    assert.deepEqual(snapshot(root), before);
  }
});

test('a dataset-local policy cannot weaken installed keyword requirements', (t) => {
  const { root, descriptor } = fixture(t);
  const local = structuredClone(policy);
  local.keywords.requiredPrefixes = [];
  writeFileSync(join(root, 'dataset.config.json'), JSON.stringify(local));
  writeFileSync(join(root, 'datapackage.json'), JSON.stringify({ ...descriptor, keywords: ['stage:master'] }));
  const before = snapshot(root);
  const result = validate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /task:/);
  assert.match(result.stderr, /project:/);
  assert.deepEqual(snapshot(root), before);
});

test('pnpm validate checks referenced files and undeclared root buckets', (t) => {
  const { root, descriptor } = fixture(t);
  writeFileSync(join(root, 'datapackage.json'), JSON.stringify({
    ...descriptor, resources: [{ ...descriptor.resources[0], path: 'missing.csv' }],
  }));
  const missing = validate(root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /does not exist/);

  writeFileSync(join(root, 'datapackage.json'), JSON.stringify(descriptor));
  writeFileSync(join(root, 'buckets.csv'), 'label,count\nexample,-1\n');
  const buckets = validate(root);
  assert.equal(buckets.status, 1);
  assert.match(buckets.stderr, /buckets\.csv/);
});

test('pnpm validate rejects resources resolving outside the dataset', (t) => {
  const { root, descriptor } = fixture(t);
  const outside = fixture(t);
  symlinkSync(join(outside.root, 'input.csv'), join(root, 'escape.csv'));
  writeFileSync(join(root, 'datapackage.json'), JSON.stringify({
    ...descriptor, resources: [{ ...descriptor.resources[0], path: 'escape.csv' }],
  }));
  const result = validate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside/);
});

test('malformed descriptor errors do not disclose local paths or descriptor contents', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'datapackage.json'), '{INVALID_DESCRIPTOR_MARKER');
  const before = snapshot(root);
  const result = validate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^datapackage.json: Could not read datapackage.json as JSON\n/);
  assert.ok(!result.stderr.includes('INVALID_DESCRIPTOR_MARKER'));
  assert.ok(!result.stderr.includes(root));
  assert.deepEqual(snapshot(root), before);
});
