import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseBuckets } from './validate-buckets.mjs';
import { validateDataPackage } from './validate-datapackage.mjs';

const validCases = [
  ['year,count\n001,0\n1962,10\n', 'year', [{ year: '001', count: 0 }, { year: '1962', count: 10 }]],
  ['\uFEFF category , count \r\n A , 0 \r\n\r\nB,0', 'category', [{ category: 'A', count: 0 }, { category: 'B', count: 0 }]],
  ['kind,count\n"A,B",2\n"A""B",3\n"two\nlines",4\n', 'kind', [{ kind: 'A,B', count: 2 }, { kind: 'A"B', count: 3 }, { kind: 'two\nlines', count: 4 }]],
  ['__proto__,count\nconstructor,9007199254740991', '__proto__', [{ ['__proto__']: 'constructor', count: Number.MAX_SAFE_INTEGER }]],
];

for (const [text, labelColumn, rows] of validCases) {
  test(`accepts bucket CSV with header ${labelColumn} and preserves labels`, () => {
    assert.deepEqual(parseBuckets(text), { labelColumn, rows });
  });
}

for (const text of [
  '', 'year,count\n', 'year,total\nA,1', 'count,count\nA,1', ',count\nA,1',
  'year,count,extra\nA,1,x', 'year,count\nA', 'year,count\nA,1,x',
  'year,count\n ,1', 'year,count\nA,1\n A ,2', 'year,count\nA,',
  'year,count\nA,-1', 'year,count\nA,+1', 'year,count\nA,1.5', 'year,count\nA,1e3',
  'year,count\nA,NaN', 'year,count\nA,Infinity', 'year,count\nA,9007199254740992',
  'year,count\n"A,1', 'year,count\nA"B,1', 'year,count\n"A"x,1',
  'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n',
]) {
  test(`rejects malformed bucket CSV ${JSON.stringify(text)}`, () => {
    assert.throws(() => parseBuckets(text), /buckets\.csv/);
  });
}

test('rejects invalid UTF-8 and oversized bucket contents', () => {
  assert.throws(() => parseBuckets(Buffer.from([0xff])), /UTF-8/);
  assert.throws(() => parseBuckets(`label,count\n${'a'.repeat(1_000_000)},1`), /limit/);
});

test('the reserved buckets resource must refer to the root CSV', () => {
  const root = mkdtempSync(join(tmpdir(), 'bucket-resource-'));
  try {
    writeFileSync(join(root, 'input.csv'), 'value\nexample\n');
    writeFileSync(join(root, 'buckets.csv'), 'label,count\nexample,0\n');
    for (const resource of [
      { name: 'buckets', path: 'input.csv', format: 'csv' },
      { name: 'buckets', path: 'buckets.csv', format: 'json' },
    ]) {
      assert.ok(validateDataPackage({
        name: 'example', title: 'Example', description: 'Synthetic example.',
        keywords: ['stage:master'], resources: [{ ...resource, title: 'Summary' }],
      }, root).some((error) => error.includes('buckets')));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI validates optional root buckets even when not declared as a resource', () => {
  const root = mkdtempSync(join(tmpdir(), 'bucket-cli-'));
  const script = fileURLToPath(new URL('./validate-datapackage.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  try {
    writeFileSync(join(root, 'input.csv'), 'value\nexample\n');
    writeFileSync(join(root, 'datapackage.json'), JSON.stringify({
      name: 'example', title: 'Example', description: 'Synthetic example.',
      keywords: ['stage:master'], resources: [{ name: 'input', title: 'Input', path: 'input.csv' }],
    }));
    assert.match(run(), /valid/);
    writeFileSync(join(root, 'buckets.csv'), 'year,count\n001,0\n');
    assert.match(run(), /valid/);
    writeFileSync(join(root, 'buckets.csv'), 'year,count\nprivate-label,-1\n');
    assert.throws(run, (error) => {
      assert.match(error.stderr.toString(), /buckets\.csv.*row 2/);
      assert.doesNotMatch(error.stderr.toString(), /private-label/);
      return true;
    });
    rmSync(join(root, 'buckets.csv'));
    mkdirSync(join(root, 'buckets.csv'));
    assert.throws(run);
    rmSync(join(root, 'buckets.csv'), { recursive: true });
    symlinkSync(join(root, 'input.csv'), join(root, 'buckets.csv'));
    assert.throws(run);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
