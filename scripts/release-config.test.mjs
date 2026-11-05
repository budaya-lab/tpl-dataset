import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function readJson(path) {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
}

test('Release Please targets the Data Package version with its JSON updater', () => {
  const config = readJson('release-please-config.json');
  const release = config.packages['.'];
  assert.equal(release['release-type'], 'simple');
  assert.equal(release['initial-version'], '0.1.0');
  assert.deepEqual(release['extra-files'], [
    { type: 'json', path: 'datapackage.json', jsonpath: '$.version' },
  ]);
});

test('the Data Package contains a version string for Release Please to replace', () => {
  const descriptor = readJson('datapackage.json');
  assert.equal(typeof descriptor.version, 'string');
  assert.match(descriptor.version, /^\d+\.\d+\.\d+$/);
});
