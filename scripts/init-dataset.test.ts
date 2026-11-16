import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import tooling from '../package.json' with { type: 'json' };

const script = fileURLToPath(new URL('./init-dataset.ts', import.meta.url));
const original = '{\n  "name": "example-dataset", "version": "1.0.0",\n  "custom": 9007199254740993, "sources": [{"version": "1.0.0"}]\n}\n';

function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], {
    encoding: 'utf8', stdio: 'pipe',
  }).trim();
}

function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dataset-init-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'datapackage.json'), original);
  writeFileSync(join(root, '.release-please-manifest.json'), '{".":"1.0.0"}\n');
  writeFileSync(join(root, 'CHANGELOG.md'), '# Inherited template history\n');
  writeFileSync(join(root, 'input.csv'), 'value\nEXAMPLE\n');
  writeFileSync(join(root, 'README.md'), '# Handwritten\n<!-- notes -->\nKeep this.\n');
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'remote', 'add', 'origin', 'https://example.invalid/lab/ds-example.git');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'Initial commit');
  return root;
}

function run(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', input: '', timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
}

function files(root: string) {
  return readdirSync(root).filter((name) => name !== '.git').sort()
    .map((name) => [name, readFileSync(join(root, name))]);
}

test('cleanup resets only inherited release state and preserves descriptor bytes except its root version', (t) => {
  const root = fixture(t);
  const head = git(root, 'rev-parse', 'HEAD');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'datapackage.json'), 'utf8'), original.replace('"version": "1.0.0"', '"version": "0.0.0"'));
  assert.equal(readFileSync(join(root, '.release-please-manifest.json'), 'utf8'), '{}\n');
  assert.ok(!existsSync(join(root, 'CHANGELOG.md')));
  assert.equal(readFileSync(join(root, 'input.csv'), 'utf8'), 'value\nEXAMPLE\n');
  assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# Handwritten\n<!-- notes -->\nKeep this.\n');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  const before = files(root);
  assert.equal(run(root).status, 0);
  assert.deepEqual(files(root), before, 'running cleanup twice must be harmless');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'Initialize dataset');
  assert.equal(run(root).status, 0, 'already-clean repositories remain a harmless no-op after committing');
  assert.deepEqual(files(root), before);
});

test('the package command runs manually without prompts or installed dependencies', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(script, join(root, 'scripts/init-dataset.ts'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: tooling.scripts }));
  const result = spawnSync('pnpm', ['--silent', 'init:dataset'], {
    cwd: root, encoding: 'utf8', input: '', timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(join(root, 'datapackage.json'), 'utf8')).version, '0.0.0');
});

for (const [name, alter, message] of [
  ['template origin', (root: string) => git(root, 'remote', 'set-url', 'origin', 'git@github.com:nus-dh/tpl-dataset.git'), /template repository/i],
  ['additional commits', (root: string) => git(root, 'commit', '--quiet', '--allow-empty', '-m', 'Dataset work'), /initial commit/i],
  ['release tags', (root: string) => git(root, 'tag', 'v1.0.0'), /tags/i],
  ['changed changelog', (root: string) => writeFileSync(join(root, 'CHANGELOG.md'), '# Dataset history\n'), /CHANGELOG.md/],
  ['changelog whitespace edits', (root: string) => writeFileSync(join(root, 'CHANGELOG.md'), '# Inherited template history\n\n'), /CHANGELOG.md/],
  ['changed manifest', (root: string) => writeFileSync(join(root, '.release-please-manifest.json'), '{".":"2.0.0"}'), /manifest/],
  ['duplicate root versions', (root: string) => writeFileSync(join(root, 'datapackage.json'), '{"version":"1.0.0","version":"1.0.0"}'), /exactly one root version/],
  ['changed release version', (root: string) => writeFileSync(join(root, 'datapackage.json'), original.replace('1.0.0', '2.0.0')), /version/i],
  ['malformed descriptor', (root: string) => writeFileSync(join(root, 'datapackage.json'), '{INVALID_PRIVATE_MARKER'), /datapackage.json/],
  ['malformed manifest', (root: string) => writeFileSync(join(root, '.release-please-manifest.json'), 'null'), /manifest/],
  ['invalid UTF-8', (root: string) => writeFileSync(join(root, 'datapackage.json'), Buffer.from([0xff])), /UTF-8/],
] as const) {
  test(`cleanup refuses ${name} before changing any files`, (t) => {
    const root = fixture(t);
    alter(root);
    const before = files(root);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.ok(!result.stderr.includes(root));
    assert.ok(!result.stderr.includes('INVALID_PRIVATE_MARKER'));
    assert.deepEqual(files(root), before);
  });
}

for (const filename of ['datapackage.json', '.release-please-manifest.json', 'CHANGELOG.md']) {
  for (const link of [symlinkSync, linkSync]) {
    test(`cleanup refuses linked ${filename} without changing its target`, (t) => {
      const root = fixture(t);
      const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dataset-init-outside-')));
      t.after(() => rmSync(outside, { recursive: true, force: true }));
      const target = join(outside, 'private');
      const originalFile = readFileSync(join(root, filename));
      writeFileSync(target, originalFile);
      rmSync(join(root, filename));
      link(target, join(root, filename));
      const before = files(root);
      const result = run(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /regular file.*symlink or hard link/i);
      assert.deepEqual(readFileSync(target), originalFile);
      assert.deepEqual(files(root), before);
    });
  }
}

test('cleanup refuses arbitrary arguments and non-repository directories', (t) => {
  const root = fixture(t);
  const before = files(root);
  const argument = run(root, '--force');
  assert.equal(argument.status, 1);
  assert.match(argument.stderr, /arguments/i);
  rmSync(join(root, '.git'), { recursive: true });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git/i);
  assert.deepEqual(files(root), before);
});

test('cleanup handles escaped root keys and CRLF without changing nested metadata or formatting', (t) => {
  const root = fixture(t);
  const text = original.replace('"version":', '"vers\\u0069on":').replaceAll('\n', '\r\n');
  writeFileSync(join(root, 'datapackage.json'), text);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'datapackage.json'), 'utf8'), text.replace(': "1.0.0"', ': "0.0.0"'));
});

test('cleanup accepts Git checkout line-ending conversion in the inherited changelog', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'CHANGELOG.md'), '# Inherited template history\r\n');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(root, 'CHANGELOG.md')));
});

test('cleanup refuses shallow clones even when only one commit is visible', (t) => {
  const source = fixture(t);
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'dataset-init-shallow-')));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'dataset');
  git(source, '-c', 'protocol.file.allow=always', 'clone', '--quiet', '--depth=1', pathToFileURL(source).href, root);
  const before = files(root);
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full clone/);
  assert.deepEqual(files(root), before);
});
