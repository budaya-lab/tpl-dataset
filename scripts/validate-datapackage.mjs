import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateBuckets } from './validate-buckets.mjs';

const packageName = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const resourceName = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const stageLabels = JSON.parse(readFileSync(new URL('../stage.config.json', import.meta.url), 'utf8'));
const stageNames = isObject(stageLabels) ? Object.entries(stageLabels) : [];
if (stageNames.length === 0 || stageNames.some(([name, label]) =>
  !/^[a-z][a-z0-9-]*$/.test(name) || typeof label !== 'string' || !label.trim()
)) {
  throw new Error('Invalid stage.config.json: expected nonempty stage names and labels');
}
const stages = new Set(stageNames.map(([name]) => `stage:${name}`));
const stageRequirement = `keywords must contain exactly one of ${[...stages].join(', ')}`;
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTextFields(entry, fields) {
  return fields.every((field) => entry[field] === undefined || isText(entry[field]));
}

function validMetadataList(value, minItems, validEntry) {
  return Array.isArray(value) && value.length >= minItems && value.every((entry) =>
    isObject(entry) && Object.keys(entry).length > 0 && validEntry(entry));
}

function validDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, , , offsetHour, offsetMinute] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1 && Number(month) <= 12 &&
    Number(day) >= 1 && Number(day) <= daysInMonth &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 &&
    (offsetHour === undefined || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59));
}

function validateResourcePath(path, root, errors, format) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\') || isAbsolute(path)) {
    errors.push('resource paths must be nonempty relative POSIX paths');
    return;
  }
  const segments = (path.endsWith('/') ? path.slice(0, -1) : path).split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    errors.push(`unsafe resource path: ${path}`);
    return;
  }
  const file = resolve(root, ...segments);
  const fromRoot = relative(root, file);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    errors.push(`resource path escapes the repository: ${path}`);
    return;
  }
  try {
    const realFile = realpathSync(file);
    const realRoot = realpathSync(root);
    const realRelative = relative(realRoot, realFile);
    if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
      errors.push(`resource path resolves outside the repository: ${path}`);
      return;
    }
    const stat = statSync(realFile);
    if (stat.isDirectory()) {
      if (format !== undefined) errors.push(`directory resources must omit format: ${path}`);
    } else if (!stat.isFile() || path.endsWith('/')) {
      errors.push(`resource path must reference a file or directory without a trailing slash on files: ${path}`);
    }
  } catch {
    errors.push(`resource path does not exist: ${path}`);
  }
}

export function validateDataPackage(data, root = process.cwd()) {
  if (!isObject(data)) return ['datapackage.json must be a JSON object'];

  const errors = [];
  if (typeof data.name !== 'string' || !packageName.test(data.name)) {
    errors.push('name must be a lowercase package identifier using letters, digits, dots, underscores, or hyphens');
  }
  if (!isText(data.title)) {
    errors.push('title must be nonempty text');
  }
  if (!isText(data.description)) {
    errors.push('description must be nonempty text');
  }
  if (data.keywords === undefined) {
    errors.push(stageRequirement);
  } else if (!Array.isArray(data.keywords) || data.keywords.some((keyword) => typeof keyword !== 'string')) {
    errors.push('keywords must be an array of strings');
  } else {
    const stageKeywords = data.keywords.filter((keyword) => keyword.startsWith('stage:'));
    if (stageKeywords.length !== 1 || !stages.has(stageKeywords[0])) {
      errors.push(stageRequirement);
    }
  }
  if (data.created !== undefined && !validDateTime(data.created)) {
    errors.push('created must be an RFC 3339 date-time when provided');
  }
  if (data.contributors !== undefined && !validMetadataList(data.contributors, 1, (contributor) =>
    validTextFields(contributor, ['title', 'path', 'email', 'givenName', 'familyName', 'organization']) &&
    (contributor.roles === undefined || (Array.isArray(contributor.roles) && contributor.roles.length > 0 && contributor.roles.every(isText)))
  )) {
    errors.push('contributors must be a nonempty array of nonempty objects; supplied text fields and roles must be nonblank strings, with roles in a nonempty array');
  }
  if (data.licenses !== undefined && !validMetadataList(data.licenses, 1, (license) =>
    validTextFields(license, ['name', 'path', 'title']) &&
    (isText(license.name) || isText(license.path)) &&
    (license.name === undefined || /^[A-Za-z0-9._-]+$/.test(license.name))
  )) {
    errors.push('licenses must be a nonempty array of objects with a license name or path; names must be identifiers and supplied fields must be nonblank text');
  }
  if (data.sources !== undefined && !validMetadataList(data.sources, 0, (source) =>
    validTextFields(source, ['title', 'path', 'email', 'version'])
  )) {
    errors.push('sources must be an array of nonempty objects with nonblank text for supplied title, path, email and version fields');
  }
  if (!Array.isArray(data.resources) || data.resources.length === 0) {
    errors.push('resources must contain at least one resource');
  } else {
    const names = new Set();
    for (const resource of data.resources) {
      if (!isObject(resource)) {
        errors.push('each resource must be an object');
        continue;
      }
      if (typeof resource.name !== 'string' || !resourceName.test(resource.name)) {
        errors.push('each resource needs a valid lowercase name');
      } else if (names.has(resource.name)) {
        errors.push(`resource names must be unique: ${resource.name}`);
      } else {
        names.add(resource.name);
      }
      if (!isText(resource.title)) {
        errors.push('each resource needs a nonempty title');
      }
      if (resource.count !== undefined && (!Number.isSafeInteger(resource.count) || resource.count < 0)) {
        errors.push(`resource ${resource.name ?? '(unnamed)'} count must be a non-negative safe integer`);
      }
      if (resource.name === 'buckets' && (resource.path !== 'buckets.csv' || (resource.format !== undefined && resource.format !== 'csv'))) {
        errors.push('the buckets resource must reference root buckets.csv with CSV format');
      }
      if (resource.data !== undefined || resource.path === undefined) {
        errors.push(`resource ${resource.name ?? '(unnamed)'} must reference local file path(s)`);
        continue;
      }
      const paths = Array.isArray(resource.path) ? resource.path : [resource.path];
      if (paths.length === 0) {
        errors.push(`resource ${resource.name ?? '(unnamed)'} must include at least one path`);
        continue;
      }
      for (const path of paths) validateResourcePath(path, resolve(root), errors, resource.format);
    }
  }
  return [...errors, ...validateBuckets(resolve(root))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const data = JSON.parse(readFileSync('datapackage.json', 'utf8'));
    const errors = validateDataPackage(data);
    if (errors.length) {
      console.error(errors.map((error) => `datapackage.json: ${error}`).join('\n'));
      process.exitCode = 1;
    } else {
      console.log('datapackage.json: valid');
    }
  } catch (error) {
    console.error(`datapackage.json: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
