import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultWorkspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function readUtf8(file) {
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)).replace(/^\uFEFF/, '');
}

function scalar(value) {
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error('Unclosed quoted metadata');
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[\[\]{&*!]|:\s|\s#/.test(value)) throw new Error('Unsupported YAML scalar; use a quoted string or a YAML-aware validator');
  return value;
}

export function metadata(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Missing YAML frontmatter');
  const result = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!field) continue;
    if (Object.hasOwn(result, field[1])) throw new Error(`Duplicate metadata field: ${field[1]}`);
    let value = field[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      value = block.join(value.startsWith('>') ? ' ' : '\n').trim();
    } else value = scalar(value);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Empty ${field[1]}`);
    result[field[1]] = value;
  }
  if (!result.name || !namePattern.test(result.name) || result.name.length > 64) throw new Error('Invalid or missing name');
  if (!result.description || result.description.length > 1024) throw new Error('Invalid or missing description');
  const body = text.slice(match[0].length).trim();
  if (!body) throw new Error('Empty skill body');
  if (/\b(?:TODO|TBD|FIXME)\b|\[INSERT\b/.test(body)) throw new Error('Unfinished scaffold in body');
  return { ...result, body };
}

function workspacePaths(workspace) {
  const root = fs.realpathSync(workspace);
  if (!fs.statSync(path.join(root, 'law.md')).isFile()) throw new Error('Workspace requires law.md');
  const requestedSkills = path.join(root, '스킬모음');
  const skills = fs.realpathSync(requestedSkills);
  if (!within(root, skills)) throw new Error('Skill root escapes workspace');
  if (!fs.statSync(skills).isDirectory()) throw new Error('Skill root is not a directory');
  return { root, skills };
}

function walk(directory, allowedRoot, files = []) {
  // Do not follow reparse points/symlinks silently: discovery must not loop or escape.
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Review linked skill resource explicitly: ${file}`);
    if (!within(allowedRoot, fs.realpathSync(file))) throw new Error(`Resource escapes root: ${file}`);
    if (item.isDirectory()) walk(file, allowedRoot, files);
    else if (item.isFile()) files.push(file);
  }
  return files;
}

export function catalog(workspace = defaultWorkspace) {
  const { skills } = workspacePaths(workspace);
  const files = walk(skills, skills).filter(file => path.basename(file) === 'SKILL.md').sort();
  const names = new Set();
  return files.map(file => {
    try {
      const { name, description } = metadata(readUtf8(file));
      if (path.basename(path.dirname(file)) !== name) throw new Error('Folder and name differ');
      if (names.has(name)) throw new Error(`Duplicate local skill name: ${name}`);
      names.add(name);
      return { name, description, path: file };
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  });
}

export function validate(workspace = defaultWorkspace) {
  const entries = catalog(workspace);
  for (const entry of entries) {
    const folder = path.dirname(entry.path);
    for (const file of walk(folder, folder).filter(file => file.endsWith('.md'))) {
      const source = readUtf8(file).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        let href = match[1].trim().replace(/^<|>$/g, '');
        if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
        href = decodeURIComponent(href.split('#')[0]);
        if (/^(?:[a-z]:|[\\/]|~[\\/]|file:)/i.test(href)) throw new Error(`Local reference must be relative: ${file} -> ${href}`);
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) throw new Error(`Unsupported reference scheme: ${file} -> ${href}`);
        if (href.includes('\\')) throw new Error(`Use forward slashes in portable document links: ${file} -> ${href}`);
        const target = path.resolve(path.dirname(file), href);
        if (!within(folder, target)) throw new Error(`Relative reference escapes skill: ${file} -> ${href}`);
        if (!fs.existsSync(target)) throw new Error(`Missing relative reference: ${file} -> ${href}`);
      }
    }
  }
  return { status: 'passed', count: entries.length, skills: entries };
}

export function create({ workspace = defaultWorkspace, name, description, bodyFile }) {
  const { skills } = workspacePaths(workspace);
  const body = readUtf8(bodyFile).trim();
  const content = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`;
  metadata(content);
  if (catalog(workspace).some(entry => entry.name === name)) throw new Error('Skill name already exists');
  const destination = path.resolve(skills, name);
  if (!within(skills, destination) || path.dirname(destination) !== skills) throw new Error('Invalid destination');
  // mkdir without recursive prevents overwriting an existing folder, even if SKILL.md is missing.
  fs.mkdirSync(destination);
  const file = path.join(destination, 'SKILL.md');
  fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
  // Validate references and rediscovery before reporting success. Leave a failed artifact for repair.
  validate(workspace);
  if (!catalog(workspace).some(entry => entry.path === file)) throw new Error('Rediscovery failed');
  return { status: 'created-and-rediscovered', path: file };
}

function main(args) {
  const command = args.shift();
  const options = {};
  const allowed = new Set(['--workspace', '--name', '--description', '--body-file']);
  while (args.length) {
    const key = args.shift();
    if (!allowed.has(key) || !args.length || Object.hasOwn(options, key)) throw new Error(`Invalid option: ${key}`);
    options[key] = args.shift();
  }
  const workspace = options['--workspace'] || defaultWorkspace;
  if (command !== 'create' && Object.keys(options).some(key => key !== '--workspace')) throw new Error('Creation options require create');
  if (command === 'catalog') return catalog(workspace);
  if (command === 'validate') return validate(workspace);
  if (command === 'create') {
    for (const key of ['--name', '--description', '--body-file']) if (!options[key]) throw new Error(`Required: ${key}`);
    return create({ workspace, name: options['--name'], description: options['--description'], bodyFile: options['--body-file'] });
  }
  throw new Error('Usage: workspace-skills.mjs catalog|validate|create [--workspace path] [--name name --description text --body-file file]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
