import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateDataPackage } from './validate-datapackage.mjs';

const stageLabels = JSON.parse(readFileSync(new URL('../stage.config.json', import.meta.url), 'utf8'));

const validPackage = {
  $schema: 'https://datapackage.org/profiles/2.0/datapackage.json',
  name: 'example-dataset',
  title: 'Example dataset',
  description: 'A clearly labelled placeholder package.',
  keywords: ['example', 'stage:master'],
  resources: [{ name: 'input', path: 'input.csv', format: 'csv' }],
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'data-package-'));
  writeFileSync(join(root, 'input.csv'), 'value\nREPLACE_WITH_REAL_DATA\n');
  return root;
}

test('accepts a Data Package with an existing resource', () => {
  const root = fixture();
  try {
    assert.deepEqual(validateDataPackage(validPackage, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts multiple resources in nested directories', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'annotations'));
    writeFileSync(join(root, 'annotations', 'labels.csv'), 'label\nexample\n');
    const descriptor = {
      ...validPackage,
      resources: [
        { name: 'input', path: 'input.csv' },
        { name: 'labels', path: 'annotations/labels.csv' },
        { name: 'combined', path: ['input.csv', 'annotations/labels.csv'] },
      ],
    };
    assert.deepEqual(validateDataPackage(descriptor, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accepts a directory covering nested files, with no format and an optional trailing slash', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'annotations', 'nested'), { recursive: true });
    writeFileSync(join(root, 'annotations', 'nested', 'label.xml'), '<item/>');
    for (const path of ['annotations', 'annotations/']) {
      const descriptor = {
        ...validPackage,
        resources: [{ name: 'annotations', path, count: 1 }],
      };
      const before = structuredClone(descriptor);
      assert.deepEqual(validateDataPackage(descriptor, root), []);
      assert.deepEqual(descriptor, before, 'validation must not rewrite metadata');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('directory resources must omit format', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'annotations'));
    for (const format of ['dir', 'directory', 'xml', '', null]) {
      const errors = validateDataPackage({
        ...validPackage,
        resources: [{ name: 'annotations', path: 'annotations/', format }],
      }, root);
      assert.ok(errors.some((error) => error.includes('omit format')), `expected format rejection: ${format}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates optional resource counts as non-negative safe integers', () => {
  const root = fixture();
  try {
    for (const count of [0, 1, Number.MAX_SAFE_INTEGER]) {
      assert.deepEqual(validateDataPackage({
        ...validPackage,
        resources: [{ name: 'input', path: 'input.csv', count }],
      }, root), []);
    }
    for (const count of [-1, 1.5, '1', true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const errors = validateDataPackage({
        ...validPackage,
        resources: [{ name: 'input', path: 'input.csv', count }],
      }, root);
      assert.ok(errors.some((error) => error.includes('count')), `expected count rejection: ${count}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsafe directory paths and trailing slashes on files', () => {
  const root = fixture();
  try {
    mkdirSync(join(root, 'annotations'));
    for (const path of ['', '.', './', '../', 'annotations//', 'annotations/../', 'annotations/./', 'gone/', 'input.csv/']) {
      assert.notDeepEqual(validateDataPackage({
        ...validPackage,
        resources: [{ name: 'input', path }],
      }, root), [], `expected path rejection: ${path}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects directory symlinks and symlinked parents that resolve outside the repository', () => {
  const root = fixture();
  const outside = fixture();
  try {
    symlinkSync(outside, join(root, 'escape'));
    for (const path of ['escape', 'escape/', 'escape/input.csv']) {
      const errors = validateDataPackage({
        ...validPackage,
        resources: [{ name: 'input', path }],
      }, root);
      assert.ok(errors.some((error) => error.includes('outside')), `expected escape rejection: ${path}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('requires a package name and at least one resource; validates an optional title', () => {
  const root = fixture();
  try {
    for (const descriptor of [
      { ...validPackage, name: undefined },
      { ...validPackage, title: '' },
      { ...validPackage, resources: [] },
    ]) {
      assert.notDeepEqual(validateDataPackage(descriptor, root), []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed and duplicate resources', () => {
  const root = fixture();
  try {
    for (const resources of [
      [{ path: 'input.csv' }],
      [{ name: 'input', path: 'input.csv' }, { name: 'input', path: 'input.csv' }],
      [{ name: 'input', path: 'missing.csv' }],
      [{ name: 'input', path: ['input.csv', 'missing.csv'] }],
      [{ name: 'input', data: ['inline'] }],
    ]) {
      assert.notDeepEqual(validateDataPackage({ ...validPackage, resources }, root), []);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects absolute, traversing, URL, and outside-pointing symlink paths', () => {
  const root = fixture();
  const outside = `${root}.outside.csv`;
  writeFileSync(outside, 'private\n');
  symlinkSync(outside, join(root, 'outside.csv'));
  try {
    for (const path of ['/etc/passwd', '../outside-dataset-resource.csv', 'https://example.test/data.csv', 'outside.csv']) {
      const errors = validateDataPackage({
        ...validPackage,
        resources: [{ name: 'input', path }],
      }, root);
      assert.notDeepEqual(errors, [], `expected unsafe path to fail: ${path}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test('accepts ground-truth as the primary stage', () => {
  const root = fixture();
  try {
    assert.deepEqual(validateDataPackage({
      ...validPackage,
      keywords: ['evaluation', 'stage:ground-truth'],
    }, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires exactly one controlled stage keyword while allowing subject keywords', () => {
  const root = fixture();
  try {
    for (const stage of Object.keys(stageLabels)) {
      assert.deepEqual(validateDataPackage({
        ...validPackage,
        keywords: ['example', `stage:${stage}`],
      }, root), []);
    }
    for (const keywords of [
      undefined,
      ['example'],
      ['stage:unknown'],
      ['stage:Master'],
      ['stage:master', 'stage:curated'],
      ['stage:master', 'stage:master'],
    ]) {
      const errors = validateDataPackage({ ...validPackage, keywords }, root);
      assert.ok(errors.some((error) => error.includes('stage')), `expected a stage error for ${keywords}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates optional Data Package fields without requiring them', () => {
  const root = fixture();
  try {
    assert.deepEqual(validateDataPackage({
      ...validPackage,
      created: '2026-01-02T03:04:05Z',
      contributors: [{ title: 'Research group', roles: ['creator'] }],
      licenses: [{ name: 'CC-BY-4.0' }],
      sources: [{ title: 'Source collection' }],
    }, root), []);
    assert.deepEqual(validateDataPackage(validPackage, root), []);
    assert.notDeepEqual(validateDataPackage({ ...validPackage, created: 'yesterday' }, root), []);
    assert.notDeepEqual(validateDataPackage({ ...validPackage, created: '2026-02-30T00:00:00Z' }, root), []);
    assert.notDeepEqual(validateDataPackage({ ...validPackage, contributors: 'unknown' }, root), []);
    assert.notDeepEqual(validateDataPackage({ ...validPackage, contributors: [{}] }, root), []);
    assert.notDeepEqual(validateDataPackage({ ...validPackage, licenses: ['CC-BY-4.0'] }, root), []);
    assert.notDeepEqual(validateDataPackage({ ...validPackage, sources: [null] }, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI validates datapackage.json and fails for missing or malformed descriptors', () => {
  const root = fixture();
  const script = fileURLToPath(new URL('./validate-datapackage.mjs', import.meta.url));
  try {
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' }));
    writeFileSync(join(root, 'datapackage.json'), '{invalid');
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' }));
    writeFileSync(join(root, 'datapackage.json'), JSON.stringify(validPackage));
    assert.match(execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }), /datapackage\.json: valid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
