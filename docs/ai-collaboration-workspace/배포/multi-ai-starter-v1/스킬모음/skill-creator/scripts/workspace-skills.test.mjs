// 배포본 수정: 복사된 프로젝트에 여러 스킬이 있어도 이름과 실제 개수로 검증합니다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { catalog, create, metadata, validate } from './workspace-skills.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = fs.realpathSync(os.tmpdir());
const fixtures = fs.mkdtempSync(path.join(tempRoot, 'workspace-skill-tests-'));
after(() => {
  const resolved = fs.realpathSync(fixtures);
  assert.equal(path.dirname(resolved), tempRoot, 'Cleanup must stay inside the intended temporary directory');
  assert(path.basename(resolved).startsWith('workspace-skill-tests-'), 'Cleanup must target this test run');
  fs.rmSync(resolved, { recursive: true, force: true });
  assert.equal(fs.existsSync(resolved), false, 'Test fixtures must be removed');
});
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtures, 'case-'));
  fs.mkdirSync(path.join(root, '스킬모음'));
  fs.writeFileSync(path.join(root, 'law.md'), '# Isolated test workspace\n');
  return root;
}
function body(root) {
  const file = path.join(root, 'body.md');
  fs.writeFileSync(file, '# 자기소개서 작성\n\n사용자의 지원 직무, 문항, 분량과 실제 경험을 확인한다. 확인되지 않은 경력과 성과는 지어내지 않는다. 초안을 작성하고 문항 부합성·사실·분량을 검수한다.\n');
  return file;
}
function seed(root, folder, name = path.basename(folder), extra = '') {
  const dir = path.join(root, '스킬모음', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "테스트 스킬"\n---\n\n# Test\n${extra}`);
  return dir;
}

test('self-introduction example creates in canonical local root and is rediscovered', () => {
  const root = fixture();
  const result = create({ workspace: root, name: 'cover-letter', description: '자기소개서 작성·수정 요청에 사용한다.', bodyFile: body(root) });
  assert.equal(result.path, path.join(root, '스킬모음/cover-letter/SKILL.md'));
  assert.equal(catalog(root)[0].name, 'cover-letter');
  assert.equal(metadata(fs.readFileSync(result.path, 'utf8')).description, '자기소개서 작성·수정 요청에 사용한다.');
  assert.equal(validate(root).count, 1);
});

test('existing skill is preserved byte for byte on a duplicate creation', () => {
  const root = fixture();
  const dir = seed(root, 'cover-letter');
  const file = path.join(dir, 'SKILL.md');
  const original = fs.readFileSync(file);
  assert.throws(() => create({ workspace: root, name: 'cover-letter', description: '다른 설명', bodyFile: body(root) }), /exists/);
  assert.deepEqual(fs.readFileSync(file), original);
});

test('existing folder without SKILL.md cannot be overwritten', () => {
  const root = fixture();
  const dir = path.join(root, '스킬모음/existing');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'valuable.txt'), 'keep');
  assert.throws(() => create({ workspace: root, name: 'existing', description: '테스트', bodyFile: body(root) }), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(dir, 'valuable.txt'), 'utf8'), 'keep');
});

test('path traversal and malformed names never create an outside directory', () => {
  const root = fixture();
  for (const name of ['../escape', 'x/y', 'UpperCase', '-first', 'a--b', 'a'.repeat(65)]) {
    assert.throws(() => create({ workspace: root, name, description: '테스트', bodyFile: body(root) }));
  }
  assert.deepEqual(fs.readdirSync(path.join(root, '스킬모음')), []);
  assert.equal(fs.existsSync(path.join(root, 'escape')), false);
});

test('hidden and ignored nested files are included in discovery', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, '.gitignore'), '스킬모음/\n');
  seed(root, '.hidden/nested');
  seed(root, 'visible');
  assert.deepEqual(catalog(root).map(item => item.name).sort(), ['nested', 'visible']);
});

test('invalid metadata and duplicate names fail visibly instead of disappearing', () => {
  const root = fixture();
  const dir = seed(root, 'broken');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Missing metadata');
  assert.throws(() => catalog(root), /frontmatter/);
  const duplicateRoot = fixture();
  seed(duplicateRoot, 'a/same');
  seed(duplicateRoot, 'b/same');
  assert.throws(() => catalog(duplicateRoot), /Duplicate local skill/);
});

function linkDirectory(target, link, context) {
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(error.code)) throw error;
    context.skip(`Directory links unavailable: ${error.code}`);
    return false;
  }
}

test('directory link escaping workspace is rejected', context => {
  const root = fixture();
  const other = fixture();
  const link = path.join(root, '스킬모음/outside');
  if (!linkDirectory(path.join(other, '스킬모음'), link, context)) return;
  try { assert.throws(() => catalog(root), /linked skill resource|escapes/); }
  finally { fs.unlinkSync(link); }
});

test('cyclic directory link fails visibly without recursive looping', context => {
  const root = fixture();
  const link = path.join(root, '스킬모음/loop');
  if (!linkDirectory(path.join(root, '스킬모음'), link, context)) return;
  try { assert.throws(() => catalog(root), /linked skill resource/); }
  finally { fs.unlinkSync(link); }
});

test('missing references fail and available references pass', () => {
  const root = fixture();
  const dir = seed(root, 'linked', 'linked', '[Read](references/rules.md)');
  assert.throws(() => validate(root), /Missing relative reference/);
  fs.mkdirSync(path.join(dir, 'references'));
  fs.writeFileSync(path.join(dir, 'references/rules.md'), '# Actual reference');
  assert.equal(validate(root).count, 1);
});

test('out-of-skill references fail rather than depending on unrelated files', () => {
  const root = fixture();
  seed(root, 'escape-link', 'escape-link', '[Read](../../law.md)');
  assert.throws(() => validate(root), /escapes skill/);
});

test('UTF-8 BOM, CRLF and folded descriptions can be read', () => {
  const text = '---\r\nname: example\r\ndescription: >-\r\n  한국어 설명\r\n  두 번째 줄\r\n---\r\n\r\n# Body\r\n';
  const root = fixture();
  const dir = seed(root, 'example');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '\uFEFF' + text);
  assert.equal(catalog(root)[0].description, '한국어 설명 두 번째 줄');
});

test('unfinished instructions and empty bodies cannot be published by create', () => {
  const root = fixture();
  for (const text of ['# TODO\n', '']) {
    const input = path.join(root, 'unfinished.md');
    fs.writeFileSync(input, text);
    assert.throws(() => create({ workspace: root, name: 'unfinished', description: '테스트', bodyFile: input }));
  }
  assert.deepEqual(fs.readdirSync(path.join(root, '스킬모음')), []);
});

test('CLI returns a failure exit code for an unknown option', () => {
  const script = fileURLToPath(new URL('./workspace-skills.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'catalog', '--unknown', 'value'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid option/);
});

test('CLI create and validate work end to end with Korean arguments and paths', () => {
  const root = fixture();
  const script = fileURLToPath(new URL('./workspace-skills.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [script, ...args, '--workspace', root], { cwd: path.join(workspace, '스킬모음'), encoding: 'utf8' });
  const created = run(['create', '--name', 'cover-letter', '--description', '자기소개서 작성과 검수', '--body-file', body(root)]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).path, path.join(root, '스킬모음/cover-letter/SKILL.md'));
  const checked = run(['validate']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).count, 1);
});

test('malformed UTF-8 and folder/name mismatch are reported', () => {
  const root = fixture();
  const dir = seed(root, 'broken');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), Buffer.from([0xc3, 0x28]));
  assert.throws(() => catalog(root), /encoding|encoded/i);
  const mismatch = fixture();
  seed(mismatch, 'folder', 'different-name');
  assert.throws(() => catalog(mismatch), /Folder and name differ/);
});

test('default root stays anchored to script when invoked from a nested directory', () => {
  const script = fileURLToPath(new URL('./workspace-skills.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'catalog'], { cwd: path.join(workspace, '스킬모음/skill-creator'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const entries = JSON.parse(result.stdout);
  assert(entries.some(item => item.path === path.join(workspace, '스킬모음/skill-creator/SKILL.md')));
});

test('current production skill and every documented relative reference validate', () => {
  const result = validate(workspace);
  assert.equal(result.status, 'passed');
  assert(result.skills.some(item => item.name === 'skill-creator'));
  assert(!result.skills.some(item => item.name === 'cover-letter'));
});

test('local absolute links are rejected across operating system path formats', () => {
  for (const href of ['C:/Users/example/rules.md', 'C:\\Users\\example\\rules.md', '/home/example/rules.md', '\\\\server\\share\\rules.md', 'file:///home/example/rules.md', '%2Fhome%2Fexample%2Frules.md']) {
    const root = fixture();
    seed(root, 'absolute-link', 'absolute-link', `[Read](${href})`);
    assert.throws(() => validate(root), /must be relative/);
  }
});

test('relative links with spaces and Unicode survive relocation while source URLs stay external', () => {
  const root = fixture();
  const dir = seed(root, 'portable-link', 'portable-link', '[Read](<references/한글 규칙.md>)\n[Source](https://example.com/documentation)');
  fs.mkdirSync(path.join(dir, 'references'));
  fs.writeFileSync(path.join(dir, 'references/한글 규칙.md'), '# Rules');
  assert.equal(validate(root).count, 1);
});

test('copied project discovers and creates skills from unrelated cwd using relative arguments', () => {
  const root = path.join(fixtures, '다른 환경 프로젝트 with spaces');
  fs.mkdirSync(root);
  fs.copyFileSync(path.join(workspace, 'law.md'), path.join(root, 'law.md'));
  fs.cpSync(path.join(workspace, '스킬모음'), path.join(root, '스킬모음'), { recursive: true });
  const script = path.join(root, '스킬모음/skill-creator/scripts/workspace-skills.mjs');
  const relativeScript = path.relative(fixtures, script);
  const run = args => spawnSync(process.execPath, [relativeScript, ...args], { cwd: fixtures, encoding: 'utf8' });
  const listed = run(['catalog']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).find(entry => entry.name === 'skill-creator')?.path, path.join(root, '스킬모음/skill-creator/SKILL.md'));
  const input = body(root);
  const created = run(['create', '--name', 'portable-writing', '--description', '이식성 검증', '--body-file', path.relative(fixtures, input)]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).path, path.join(root, '스킬모음/portable-writing/SKILL.md'));
  const checked = run(['validate', '--workspace', path.relative(fixtures, root)]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).count, JSON.parse(listed.stdout).length + 1);
  assert.equal(fs.existsSync(path.join(workspace, '스킬모음/portable-writing')), false);
});
