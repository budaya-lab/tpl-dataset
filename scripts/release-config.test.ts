import assert from 'node:assert/strict';
import { test } from 'node:test';

import descriptor from '../datapackage.json' with { type: 'json' };
import config from '../release-please-config.json' with { type: 'json' };

test('Release Please targets the Data Package version with its JSON updater', () => {
  const release = config.packages['.'];
  assert.equal(release['release-type'], 'simple');
  assert.equal(release['initial-version'], '0.1.0');
  assert.deepEqual(release['extra-files'], [
    { type: 'json', path: 'datapackage.json', jsonpath: '$.version' },
  ]);
});

test('the Data Package contains a version string for Release Please to replace', () => {
  assert.equal(typeof descriptor.version, 'string');
  assert.match(descriptor.version, /^\d+\.\d+\.\d+$/);
});
