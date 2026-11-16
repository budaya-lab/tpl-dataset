import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

class InitError extends Error {}
type ReleaseFile = 'datapackage.json' | '.release-please-manifest.json' | 'CHANGELOG.md';

function git(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch (cause) {
    throw new InitError('Could not verify local Git state. Run from a new template-derived repository.', { cause });
  }
}

function read(root: string, name: ReleaseFile, optional?: false): string;
function read(root: string, name: ReleaseFile, optional: true): string | undefined;
function read(root: string, name: ReleaseFile, optional = false): string | undefined {
  try {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new InitError(`${name} must be a regular file, not a symlink or hard link.`);
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  } catch (cause) {
    if (optional && cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined;
    if (cause instanceof InitError) throw cause;
    throw new InitError(`Could not read ${name} as a regular UTF-8 file.`, { cause });
  }
}

function object(text: string, name: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch (cause) {
    throw new InitError(`${name} must contain a JSON object.`, { cause });
  }
  throw new InitError(`${name} must contain a JSON object.`);
}

function resetVersion(text: string): string {
  // Locate the root value without reserializing other metadata or losing large integers.
  let depth = 0;
  const versions: { start: number; end: number }[] = [];
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
    const value = token[0];
    if (value === '{' || value === '[') depth++;
    else if (value === '}' || value === ']') depth--;
    else if (depth === 1 && JSON.parse(value) === 'version') {
      const end = token.index + value.length;
      const property = /^(\s*:\s*)("(?:[^"\\]|\\.)*")/.exec(text.slice(end));
      if (property) versions.push({ start: end + property[1].length, end: end + property[0].length });
    }
  }
  if (versions.length !== 1) throw new InitError('datapackage.json needs exactly one root version string.');
  const version = versions[0];
  return text.slice(0, version.start) + '"0.0.0"' + text.slice(version.end);
}

function main() {
  if (process.argv.length !== 2) throw new InitError('init:dataset accepts no arguments.');
  const root = realpathSync(process.cwd());
  if (realpathSync(git(root, 'rev-parse', '--show-toplevel').trim()) !== root) {
    throw new InitError('Run init:dataset from the Git repository root.');
  }
  const origin = git(root, 'remote', 'get-url', 'origin').trim();
  if (/(?:\/|:)tpl-dataset(?:\.git)?\/?$/i.test(origin)) {
    throw new InitError('Do not initialize the template repository itself. Create a dataset repository first.');
  }

  const descriptorText = read(root, 'datapackage.json');
  const manifestText = read(root, '.release-please-manifest.json');
  const changelog = read(root, 'CHANGELOG.md', true);
  const descriptor = object(descriptorText, 'datapackage.json');
  const manifest = object(manifestText, '.release-please-manifest.json');
  if (descriptor.version === '0.0.0' && Object.keys(manifest).length === 0 && changelog === undefined) {
    console.log('Dataset release state is already initialized; nothing changed.');
    return;
  }

  if (git(root, 'rev-parse', '--is-shallow-repository').trim() !== 'false' || git(root, 'rev-list', '--count', 'HEAD').trim() !== '1') {
    throw new InitError('Cleanup requires a full clone with only its initial commit.');
  }
  if (git(root, 'tag', '--list').trim()) throw new InitError('Cleanup refuses repositories with release tags.');
  const initial = object(git(root, 'show', 'HEAD:datapackage.json'), 'Initial datapackage.json');
  const initialManifest = object(git(root, 'show', 'HEAD:.release-please-manifest.json'), 'Initial manifest');
  const version = initial.version;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      Object.keys(initialManifest).length !== 1 || initialManifest['.'] !== version ||
      (descriptor.version !== version && descriptor.version !== '0.0.0') ||
      (Object.keys(manifest).length !== 0 && (Object.keys(manifest).length !== 1 || manifest['.'] !== version))) {
    throw new InitError('Release version and manifest must still match the inherited initial state.');
  }
  if (changelog !== undefined && changelog.replaceAll('\r\n', '\n') !== git(root, 'show', 'HEAD:CHANGELOG.md').replaceAll('\r\n', '\n')) {
    throw new InitError('CHANGELOG.md has changed; refusing to delete dataset history.');
  }
  const updated = resetVersion(descriptorText);
  try {
    if (updated !== descriptorText) writeFileSync(join(root, 'datapackage.json'), updated);
    if (Object.keys(manifest).length !== 0) writeFileSync(join(root, '.release-please-manifest.json'), '{}\n');
    if (changelog !== undefined) unlinkSync(join(root, 'CHANGELOG.md'));
  } catch (cause) {
    throw new InitError('Cleanup could not finish. Inspect release files and permissions before retrying.', { cause });
  }
  console.log('Dataset release state initialized. Replace example metadata and data before release.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof InitError ? error.message : 'Could not initialize dataset release state.');
  process.exitCode = 1;
}
