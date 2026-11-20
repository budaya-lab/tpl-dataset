import assert from 'node:assert/strict';
import { test } from 'node:test';

import descriptor from '../datapackage.json' with { type: 'json' };
import config from '../release-please-config.json' with { type: 'json' };
import manifest from '../package.json' with { type: 'json' };

test('uses the published Penjaga v2 validator and renamed CLI', () => {
  assert.equal(manifest.scripts.validate, 'penjaga-validate');
  assert.deepEqual(Object.keys(manifest.devDependencies).filter((name) => name.endsWith('/validator')), ['@penjaga/validator']);
  assert.equal(manifest.devDependencies['@penjaga/validator'],
    'https://github.com/budaya-lab/penjaga/releases/download/v2.0.0/penjaga-validator-2.0.0.tgz');
});

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
