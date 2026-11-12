import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  resources: [{ name: 'input', title: 'Input', path: 'input.csv', format: 'csv' }],
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
        { name: 'input', title: 'Input', path: 'input.csv' },
        { name: 'labels', title: 'Labels', path: 'annotations/labels.csv' },
        { name: 'combined', title: 'Combined', path: ['input.csv', 'annotations/labels.csv'] },
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
        resources: [{ name: 'annotations', title: 'Annotations', path, count: 1 }],
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
        resources: [{ name: 'annotations', title: 'Annotations', path: 'annotations/', format }],
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
        resources: [{ ...validPackage.resources[0], count }],
      }, root), []);
    }
    for (const count of [-1, 1.5, '1', true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const errors = validateDataPackage({
        ...validPackage,
        resources: [{ ...validPackage.resources[0], count }],
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
        resources: [{ ...validPackage.resources[0], path }],
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
        resources: [{ ...validPackage.resources[0], path }],
      }, root);
      assert.ok(errors.some((error) => error.includes('outside')), `expected escape rejection: ${path}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('requires a package name and at least one resource', () => {
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

test('requires nonblank package titles and descriptions', () => {
  const root = fixture();
  try {
    for (const field of ['title', 'description']) {
      for (const value of [undefined, null, '', '   ', false, 0, {}, []]) {
        const descriptor = { ...validPackage, [field]: value };
        if (value === undefined) delete descriptor[field];

        const errors = validateDataPackage(descriptor, root);

        assert.ok(
          errors.some((error) => error.startsWith(`${field} `)),
          `expected ${field} error for ${JSON.stringify(value)}`
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires a nonblank resource title', () => {
  const root = fixture();
  try {
    for (const title of [undefined, null, '', '   ', false, 0, {}, []]) {
      const resource = { ...validPackage.resources[0], title };
      if (title === undefined) delete resource.title;

      const errors = validateDataPackage({ ...validPackage, resources: [resource] }, root);

      assert.ok(
        errors.some((error) => /resource.*title/.test(error)),
        `expected resource title error for ${JSON.stringify(title)}`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed and duplicate resources', () => {
  const root = fixture();
  try {
    for (const resources of [
      [{ title: 'Input', path: 'input.csv' }],
      [validPackage.resources[0], validPackage.resources[0]],
      [{ ...validPackage.resources[0], path: 'missing.csv' }],
      [{ ...validPackage.resources[0], path: ['input.csv', 'missing.csv'] }],
      [{ name: 'input', title: 'Input', data: ['inline'] }],
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
        resources: [{ ...validPackage.resources[0], path }],
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

test('accepts omitted optional metadata and valid supplied metadata without fetching references', () => {
  const root = fixture();
  try {
    for (const optional of [
      {},
      { created: '2026-01-02T03:04:05.123+08:00' },
      { contributors: [{ title: 'Synthetic group', roles: ['creator', 'curator'] }] },
      { contributors: [{ organization: 'Synthetic group' }] },
      { licenses: [{ name: 'CC-BY-4.0', title: 'Attribution' }] },
      { licenses: [{ path: 'LICENSE-not-present.txt' }] },
      { sources: [{ title: 'Source collection', path: 'https://example.invalid/source', version: '1' }] },
      { sources: [] },
    ]) {
      assert.deepEqual(
        validateDataPackage({ ...validPackage, ...optional }, root),
        [],
        JSON.stringify(optional)
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects malformed optional metadata when supplied', () => {
  const root = fixture();
  try {
    for (const field of ['created', 'contributors', 'licenses', 'sources']) {
      for (const value of [null, false, 42, 'unknown', {}]) {
        const errors = validateDataPackage({ ...validPackage, [field]: value }, root);

        assert.ok(
          errors.some((error) => error.includes(field)),
          `expected ${field} error for ${JSON.stringify(value)}`
        );
      }
    }

    for (const field of ['contributors', 'licenses', 'sources']) {
      for (const entry of [null, false, 42, 'unknown', [], {}]) {
        const errors = validateDataPackage({ ...validPackage, [field]: [entry] }, root);

        assert.ok(
          errors.some((error) => error.includes(field)),
          `expected ${field} entry error for ${JSON.stringify(entry)}`
        );
      }
    }

    for (const created of ['', '2026-02-30T00:00:00Z', '2026-01-02', '2026-01-02T25:00:00Z']) {
      assert.ok(validateDataPackage({ ...validPackage, created }, root).some((error) => error.includes('created')));
    }

    for (const field of ['contributors', 'licenses']) {
      assert.ok(validateDataPackage({ ...validPackage, [field]: [] }, root).some((error) => error.includes(field)));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates supplied optional entry text and contributor roles', () => {
  const root = fixture();
  try {
    for (const [field, properties, entry] of [
      ['contributors', ['title', 'path', 'email', 'givenName', 'familyName', 'organization'], { title: 'Synthetic group' }],
      ['licenses', ['name', 'path', 'title'], { name: 'CC-BY-4.0' }],
      ['sources', ['title', 'path', 'email', 'version'], { title: 'Source collection' }],
    ]) {
      for (const property of properties) {
        for (const value of [null, false, 42, [], {}, '', '   ']) {
          const errors = validateDataPackage({ ...validPackage, [field]: [{ ...entry, [property]: value }] }, root);

          assert.ok(
            errors.some((error) => error.includes(field)),
            `expected ${field}.${property} error for ${JSON.stringify(value)}`
          );
        }
      }
    }

    for (const roles of [null, 'creator', [], [null], [42], ['']]) {
      const errors = validateDataPackage({
        ...validPackage,
        contributors: [{ title: 'Synthetic group', roles }],
      }, root);

      assert.ok(
        errors.some((error) => error.includes('contributors')),
        `expected roles error for ${JSON.stringify(roles)}`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires each supplied license to identify a name or path', () => {
  const root = fixture();
  try {
    for (const license of [{ title: 'Unidentified license' }, { name: 'not a license identifier' }]) {
      assert.ok(validateDataPackage({ ...validPackage, licenses: [license] }, root).some((error) => error.includes('licenses')));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the function and CLI leave descriptors and files unchanged on success and failure', () => {
  const root = fixture();
  const script = fileURLToPath(new URL('./validate-datapackage.mjs', import.meta.url));

  const freeze = (value) => {
    if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }

    return value;
  };

  const snapshot = () => readdirSync(root, { recursive: true }).sort().map((path) => {
    const fullPath = join(root, path);
    const stat = statSync(fullPath);

    return {
      path,
      mode: stat.mode,
      modified: stat.mtimeMs,
      contents: stat.isFile() ? readFileSync(fullPath) : null,
    };
  });

  try {
    mkdirSync(join(root, 'annotations'));
    writeFileSync(join(root, 'annotations', 'item.xml'), '<item/>');
    writeFileSync(join(root, 'README.md'), '# Handwritten\n\n<!-- notes -->\nKeep these notes.\n');
    writeFileSync(join(root, 'buckets.csv'), 'label,count\nexample,1\n');

    for (const invalid of [false, true]) {
      const descriptor = {
        ...structuredClone(validPackage),
        title: ' Example dataset ',
        created: '2026-01-02T03:04:05Z',
        contributors: [{ title: 'Synthetic group', roles: ['creator'] }],
        licenses: [{ name: 'CC-BY-4.0' }],
        sources: [{ title: 'Source collection', path: 'https://example.invalid/source' }],
        resources: [
          { ...validPackage.resources[0], count: 999, size: 999, bytes: 24 },
          {
            name: 'annotations',
            title: 'Annotations',
            path: 'annotations/',
            count: 999,
            ...(invalid ? { format: 'dir' } : {}),
          },
        ],
        custom: { keep: ['unchanged'] },
      };
      writeFileSync(join(root, 'datapackage.json'), JSON.stringify(descriptor, null, 2) + '\n');
      const beforeDescriptor = structuredClone(descriptor);
      const beforeFiles = snapshot();

      const errors = validateDataPackage(freeze(descriptor), root);

      assert.equal(errors.length === 0, !invalid);
      assert.deepEqual(descriptor, beforeDescriptor, 'the function must not mutate its input');
      assert.deepEqual(snapshot(), beforeFiles, 'the function must not write files');

      const run = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
      if (invalid) assert.throws(run, (error) => error.status === 1 && /omit format/.test(error.stderr));
      else assert.match(run(), /valid/);

      assert.deepEqual(snapshot(), beforeFiles, 'the CLI must not write files');
    }
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
