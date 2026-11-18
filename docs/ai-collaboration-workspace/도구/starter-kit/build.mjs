import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(workspace, '배포', 'multi-ai-starter-v1');
if (fs.existsSync(out)) throw new Error('배포 폴더가 이미 존재합니다. 기존 결과를 덮어쓰지 않습니다.');
fs.mkdirSync(out, { recursive: true });
const records = [];
const sourceHashes = new Map();
const digest = content => crypto.createHash('sha256').update(content).digest('hex');
function source(file) {
  const bytes = fs.readFileSync(path.join(workspace, file));
  sourceHashes.set(file, digest(bytes));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function put(file, content, before = null) {
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  if (file.endsWith('.md') || file.endsWith('.txt')) records.push({ file, before, after: content });
}
function replaceOnce(text, old, replacement) {
  if (!text.includes(old)) throw new Error(`수정 기준을 찾지 못했습니다: ${old.slice(0, 80)}`);
  return text.replace(old, replacement);
}
function copyTree(dir) {
  for (const item of fs.readdirSync(path.join(workspace, dir), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('링크 파일은 자동 복사하지 않습니다.');
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) copyTree(file);
    else if (item.isFile()) {
      const text = source(file);
      let after = text;
      if (file.endsWith('/workspace-skills.test.mjs')) {
        after = '// 배포본 수정: 복사된 프로젝트에 여러 스킬이 있어도 이름과 실제 개수로 검증합니다.\n' + replaceOnce(text, "JSON.parse(listed.stdout)[0].path", "JSON.parse(listed.stdout).find(entry => entry.name === 'skill-creator')?.path");
        after = replaceOnce(after, 'assert.equal(JSON.parse(checked.stdout).count, 2);', 'assert.equal(JSON.parse(checked.stdout).count, JSON.parse(listed.stdout).length + 1);');
      }
      put(file, after, text);
    }
  }
}
copyTree('스킬모음');
const lawBefore = source('law.md');
let law = lawBefore.slice(0, lawBefore.indexOf('## 제8조')).trimEnd();
if (law === lawBefore.trimEnd()) throw new Error('GitHub 프로젝트 설정을 분리하지 못했습니다.');
law = replaceOnce(law, '5. 계획과 선정한 스킬의 절차에 따라 작업하며, 범위가 바뀌면 스킬 적용 여부와 계획을 다시 검토합니다.', '5. 계획과 선정한 스킬의 절차에 따라 작업하며, 범위가 바뀌면 스킬 적용 여부와 계획을 다시 검토합니다. 두 개 이상의 AI 세션이 같은 업무를 협의·분담·검토·인계하면 로컬 ai-collaboration 스킬을 기본으로 읽고 적용합니다. 단일 AI의 독립 작업에 다중 협업을 강제하지 않습니다.');
law += `\n\n## 제8조 [프로젝트별 GitHub 기록]\n1. 새 프로젝트의 GitHub 게시 대상은 기본적으로 지정되어 있지 않습니다. 사용자가 저장소와 대상 경로 또는 브랜치를 지정한 경우에만 해당 범위에 게시합니다. 이 패키지 제작 워크스페이스의 저장소나 이전 프로젝트의 게시 허가를 자동으로 이어받지 않습니다.\n2. 사용자가 후속 업데이트도 요청했다면 검증 후 같은 위치에 반영하고, 기존 파일과 다른 AI의 변경을 보존합니다. 최신 원격 판본을 확인하며 강제 푸시는 사용하지 않습니다.\n3. 비밀정보·개인 이메일·장치별 절대 경로·실행 세션 상태·잠금 파일은 게시하지 않습니다. 공개용 사본을 가공하면 로컬 원본과 구분합니다. 게시 실패는 로컬 완료와 구분하여 보고합니다.\n4. 이 방침은 AI가 업무를 수행할 때 적용합니다. 별도로 설치하고 검증하지 않은 상시 감시나 자동 동기화가 실행 중이라고 표현하지 않습니다.\n`;
put('law.md', law, lawBefore);
for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
  const before = source(file);
  put(file, `# ${file}\n\n이 파일이 있는 프로젝트 루트의 [law.md](law.md)를 먼저 읽고 적용합니다. 하위 폴더에서 작업하더라도 기준 루트는 이 파일이 있는 위치입니다.\n\n로컬 스킬은 루트의 스킬모음 폴더에서 직접 탐색합니다. 두 개 이상의 AI 세션이 같은 업무에 참여하면 [ai-collaboration](스킬모음/ai-collaboration/SKILL.md)을 기본 적용하고 [기록 양식](스킬모음/ai-collaboration/references/coordination-records.md)을 사용합니다. 스킬 생성·수정에는 [로컬 skill-creator](스킬모음/skill-creator/SKILL.md)를 읽습니다. 환경의 자동 스킬 목록에 보이지 않아도 직접 읽습니다.\n`, before);
}
const workflowPath = '스킬모음/skill-creator/references/workspace-workflow.md';
const workflowFile = path.join(out, workflowPath);
const workflowBefore = fs.readFileSync(workflowFile, 'utf8');
const workflowAfter = '> 배포본 수정: 특정 제작 세션에만 해당하던 예시 안내 한 항목을 제외했습니다. 나머지 생성·검증 절차는 유지했습니다.\n\n' + workflowBefore.replace(/^- 사용자 사례를 실제 스킬 생성 요청으로 오해하지 않는다\.[^\r\n]*\r?\n/m, '');
fs.writeFileSync(workflowFile, workflowAfter, 'utf8');
records.find(record => record.file === workflowPath).after = workflowAfter;

for (const file of ['도구/claude-bridge/bridge.mjs', '도구/claude-bridge/bridge.test.mjs', '도구/claude-bridge/verify.mjs']) {
  let text = source(file);
  if (file.endsWith('/bridge.mjs')) {
    text = replaceOnce(text, "const defaultStore = path.join(workspace, '협의', 'ai-collaboration', '대화');", `export function storeForTask(taskId = 'default', root = workspace) {\n  if (typeof taskId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(taskId)) throw new Error('잘못된 업무 ID');\n  return path.join(root, '협의', taskId, '대화');\n}`);
    text = replaceOnce(text, 'store = defaultStore, execute = runClaude', 'store, execute = runClaude');
    text = replaceOnce(text, "taskId = 'ai-collaboration'", "taskId = 'default'");
    text = replaceOnce(text, '  fs.mkdirSync(store, { recursive: true });', '  store ??= storeForTask(taskId);\n  fs.mkdirSync(store, { recursive: true });');
    text = replaceOnce(text, 'history(store = defaultStore)', 'history(store = storeForTask())');
    const start = text.indexOf('async function main(args)');
    const end = text.indexOf('\nif (process.argv[1]', start);
    if (start < 0 || end < 0) throw new Error('CLI 진입점이 없습니다.');
    text = text.slice(0, start) + `async function main(args) {
  const [command, ...rest] = args;
  if (!['status', 'history', 'send'].includes(command)) throw new Error('사용법: status|history [--task ID] 또는 send --file 메시지.txt [--from ID] [--task ID]');
  const options = {};
  while (rest.length) {
    const key = rest.shift();
    const allowed = command === 'send' ? ['--file', '--from', '--task'] : ['--task'];
    if (!allowed.includes(key) || !rest.length || Object.hasOwn(options, key)) throw new Error('잘못된 옵션');
    options[key] = rest.shift();
  }
  const taskId = options['--task'] || 'default';
  const store = storeForTask(taskId);
  const stateFile = path.join(store, 'session.json');
  if (command === 'status') return { taskId, executable: findClaude(), state: fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null, store, locked: fs.existsSync(path.join(store, 'sending.lock')) };
  if (command === 'history') return history(store);
  if (!options['--file']) throw new Error('--file이 필요합니다.');
  const entry = await send(fs.readFileSync(path.resolve(options['--file']), 'utf8').replace(/^\\uFEFF/, ''), { store, from: options['--from'] || 'local-agent', taskId });
  const { message, ...summary } = entry;
  return summary;
}
` + text.slice(end);
  }
  if (file.endsWith('/bridge.test.mjs')) {
    text = replaceOnce(text, "import { send, history, runClaude } from './bridge.mjs';", "import { send, history, runClaude, storeForTask, workspace } from './bridge.mjs';\nimport { spawnSync } from 'node:child_process';");
    text += `
test('다른 업무는 세션이 분리되고 같은 업무는 이어진다', async t => {
  const root = isolated(t);
  const execute = async (_exe, args) => ({ session_id: args.at(-1), result: '수신' });
  const first = await send('a 시작', { store: storeForTask('task-a', root), taskId: 'task-a', executable: 'mock', execute });
  const other = await send('b 시작', { store: storeForTask('task-b', root), taskId: 'task-b', executable: 'mock', execute });
  const next = await send('a 계속', { store: storeForTask('task-a', root), taskId: 'task-a', executable: 'mock', execute });
  assert.notEqual(first.sessionId, other.sessionId);
  assert.equal(first.sessionId, next.sessionId);
  assert.equal(history(storeForTask('task-a', root)).length, 2);
  assert.equal(history(storeForTask('task-b', root)).length, 1);
});
test('업무 ID로 저장 경로를 벗어날 수 없다', () => {
  for (const id of ['../escape', '/abs', 'A', '', 'a/b']) assert.throws(() => storeForTask(id), /업무 ID/);
});
test('CLI 상태 조회도 지정한 업무만 확인하며 세션을 생성하지 않는다', () => {
  const result = spawnSync(process.execPath, [path.join(workspace, '도구/claude-bridge/bridge.mjs'), 'status', '--task', 'status-test'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, CLAUDE_BRIDGE_EXE: process.execPath } });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.store, storeForTask('status-test'));
  assert.equal(status.taskId, 'status-test');
  assert.equal(fs.existsSync(status.store), false);
});
`;
  }
  if (file.endsWith('/verify.mjs')) text = replaceOnce(text, "  ['--test', '도구/claude-bridge/bridge.test.mjs'],", "  ['--test', '도구/claude-bridge/bridge.test.mjs'],\n  ['--test', '스킬모음/skill-creator/scripts/workspace-skills.test.mjs'],");
  put(file, text);
}
const usageBefore = source('도구/claude-bridge/USAGE.md');
put('도구/claude-bridge/USAGE.md', `# 선택형 Claude 연결 도구\n\nNode.js 20 이상과 설치·인증된 Claude Code CLI가 필요합니다. 공통 협업 스킬은 이 도구 없이도 공유 파일 방식으로 사용할 수 있습니다.\n\n프로젝트 루트에서 실행합니다.\n\n\`\`\`powershell\nnode 도구/claude-bridge/verify.mjs\nnode 도구/claude-bridge/bridge.mjs status --task project-start\nnode 도구/claude-bridge/bridge.mjs send --file Claude-회의요청.txt --from codex-1 --task project-start\nnode 도구/claude-bridge/bridge.mjs history --task project-start\n\`\`\`\n\n배포본은 업무 ID별로 저장 폴더와 세션을 분리합니다. 경로는 프로젝트 루트 아래 협의/<업무ID>/대화이며, 기본 업무 ID는 default입니다. 같은 업무는 세션을 이어가고 다른 업무는 별도 세션을 만듭니다. 발신자는 --from으로 구분합니다. ID는 인증 정보가 아닌 자기 선언입니다.\n\n전송 로그에는 요청·응답 원문과 대응 ID·기록자·세션을 남깁니다. 협업 의사결정 메시지는 별도로 기록합니다. CLI의 권한 검사를 우회하지 않으며, 자동 재전송은 하지 않습니다. 기본 제한 시간은 180초입니다. 시간 초과 뒤에는 실제 도달 여부를 먼저 확인합니다. 강제 종료 후 남은 잠금은 생성자와 진행 중인 전송을 확인한 뒤 메인지침에 따라 정리합니다.\n\n호출된 Claude는 전용 CLI 세션이며 기존 화면 대화와 동일하지 않습니다. 대화 전용 호출이므로 내장 파일·실행 도구와 MCP 서버를 제공하지 않습니다. 검토 자료와 실제 검증 결과를 메시지에 포함해야 합니다. 준비된 [초기 요청](../../Claude-회의요청.txt)에는 패키지 지침이 포함되어 있습니다. 일반 CLI의 기존 시작 설정은 적용될 수 있습니다.\n\n실행 파일은 PATH와 일반 설치 위치에서 찾습니다. 발견되지 않으면 CLAUDE_BRIDGE_EXE에 실제 실행 파일 경로를 지정합니다. 인증 정보는 소스나 메시지에 넣지 않습니다. 네트워크·세션 저장 권한이 차단되면 실행 환경의 정식 승인 절차를 사용합니다.\n\n원리는 [Claude 공식 프로그램 실행 안내](https://code.claude.com/docs/en/headless)를 따릅니다. 다른 제품 호출 연결부는 포함하지 않았습니다. 자세한 운영은 [사용 가이드](../../사용가이드.md)를 참고합니다.\n`, usageBefore);
const guide = source('도구/starter-kit/assets/사용가이드.md');
put('사용가이드.md', guide);
put('시작문.txt', '이 프로젝트 루트의 law.md를 먼저 읽고, 로컬 스킬모음을 직접 탐색해라.\n두 개 이상의 AI 세션이 참여하면 ai-collaboration 스킬과 기록 양식을 기본 적용해라.\n고유 참여자 ID·실제 세션·가능한 작업·제약을 선언하고, 역할·파일별 작성자·검증 담당을 협의하여 수락을 기록해라.\n협의/<업무ID>/현황.md에 목표·완료 조건·범위·다음 행동을 기록하고 합의된 범위부터 실행해라.\n\n이 시작문 다음에 사용자가 전달한 실제 업무 목표와 완료 조건을 적용해라. 아직 목표가 없으면 먼저 필요한 목표·범위를 확인해라.\n');
const coreSkill = fs.readFileSync(path.join(out, '스킬모음/ai-collaboration/SKILL.md'), 'utf8');
put('Claude-회의요청.txt', '이 요청은 새로운 프로젝트의 초기 협업 절차 검토입니다. 도구가 없는 전용 CLI 세션으로 참여한다는 점을 밝히고, 아래에 제공한 본문만을 검토하세요. 파일을 읽거나 테스트했다고 주장하지 마세요. 아직 실제 업무 목표와 참여자가 지정되지 않았으므로 가능한 검토 역할과 시작 시 확인할 항목만 제안하세요. 파일 수정·외부 호출·역할 대리 승인은 하지 마세요.\n\n--- 메인지침 ---\n' + law + '\n--- 협업 스킬 ---\n' + coreSkill);
put('.gitignore', '.env\n.env.*\n!.env.example\nnode_modules/\n.tmp/\n협의/**/대화/\n');
put('README.md', '# 멀티AI 프로젝트 시작 패키지\n\n[사용 가이드](사용가이드.md)를 읽고 [공통 시작문](시작문.txt)을 각 AI에 전달합니다. 폴더 자체를 새 프로젝트 루트로 사용하거나 내용물을 새 프로젝트 루트로 복사합니다. 기존 파일이 있으면 덮어쓰지 않고 병합합니다.\n\n과거 회의·특정 GitHub 대상·기존 세션은 포함하지 않았습니다. 협업 스킬과 스킬크리에이터를 포함하고, 선택형 Claude 도구는 업무별 세션을 분리합니다. 지침 변경은 [비교 HTML](변경비교.html)에서 확인할 수 있습니다.\n');

const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function rows(before, after) {
  const a = (before || '').match(/[^\n]*\n|[^\n]+$/g) || [];
  const b = after.match(/[^\n]*\n|[^\n]+$/g) || [];
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  const equal = (i, j) => a[i].replaceAll('\r\n', '\n') === b[j].replaceAll('\r\n', '\n');
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = equal(i, j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const output = []; let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && equal(i, j)) output.push([++i, a[i - 1], ++j, b[j - 1], 'same']);
    else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) output.push([null, null, ++j, b[j - 1], 'added']);
    else output.push([++i, a[i - 1], null, null, 'removed']);
  }
  return output;
}
let html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>멀티AI 배포본 변경 비교</title><style>body{font:16px/1.6 system-ui;margin:0;padding:clamp(8px,2vw,24px)}h1{font-size:1.5rem}h2{font-size:1.1rem;overflow-wrap:anywhere}.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.cell{display:grid;grid-template-columns:3.5em minmax(0,1fr);min-width:0}.n{text-align:right;padding-right:8px;color:#64748b;user-select:none}pre{margin:0;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 monospace}.added .after{background:#e5f7eb}.removed .before{background:#ffe8e8}section{margin-top:28px;border-top:1px solid #ccd5df}@media(max-width:750px){.row{grid-template-columns:minmax(0,1fr)}.before:before{content:"변경 전";grid-column:1/-1;color:#64748b}.after:before{content:"변경 후";grid-column:1/-1;color:#64748b}}</style><h1>원본 → 새 프로젝트 배포본</h1><p>제작 워크스페이스의 원본은 유지했습니다. 원본과 배포본의 전체 지침을 함께 표시합니다. 신규 파일은 변경 전 없음으로 표시합니다. 초록색은 추가, 붉은색은 삭제이며 줄 번호는 각 판본의 위치입니다.</p>';
for (const record of records) {
  html += `<section><h2>${esc(record.file)}</h2>${record.before === null ? '<p>변경 전 없음 · 신규 파일</p>' : ''}<div class="row"><strong>변경 전 · 원본</strong><strong>변경 후 · 배포본</strong></div>`;
  for (const [left, a, right, b, kind] of rows(record.before, record.after)) html += `<div class="row ${kind}"><div class="cell before"><span class="n">${left ?? '—'}</span><pre>${a === null ? '대응 행 없음' : esc(a)}</pre></div><div class="cell after"><span class="n">${right ?? '—'}</span><pre>${b === null ? '대응 행 없음' : esc(b)}</pre></div></div>`;
  html += '</section>';
}
html += `<script type="application/json" id="sources">${JSON.stringify(records).replaceAll('<', '\\u003c')}</script></html>`;
put('변경비교.html', html);
for (const record of records) if (record.after !== fs.readFileSync(path.join(out, record.file), 'utf8')) throw new Error('비교 최종 원문 불일치');
for (const [file, hash] of sourceHashes) if (digest(fs.readFileSync(path.join(workspace, file))) !== hash) throw new Error(`원본 동시 변경: ${file}`);
const result = spawnSync(process.execPath, ['도구/claude-bridge/verify.mjs'], { cwd: out, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (result.status !== 0) throw new Error(`배포본 검증 실패: ${result.stdout}\n${result.stderr}`);
const report = JSON.parse(result.stdout);
function portableReport(value) {
  if (typeof value === 'string') return value.split(JSON.stringify(out).slice(1, -1)).join('<PACKAGE_ROOT>').split(out).join('<PACKAGE_ROOT>');
  if (Array.isArray(value)) return value.map(portableReport);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portableReport(item)]));
  return value;
}
put('검증결과.json', JSON.stringify(portableReport(report), null, 2) + '\n');
const inventory = [];
function inventoryWalk(dir = '') {
  for (const item of fs.readdirSync(path.join(out, dir), { withFileTypes: true })) {
    const file = dir ? `${dir}/${item.name}` : item.name;
    if (item.isDirectory()) inventoryWalk(file);
    else inventory.push({ path: file, sha256: digest(fs.readFileSync(path.join(out, file))) });
  }
}
inventoryWalk();
put('package-manifest.json', JSON.stringify({ package: 'multi-ai-starter', version: 1, files: inventory, sourceFilesRead: [...sourceHashes.keys()], validation: 'passed', instructionComparisonCount: records.length, automaticGithubPublishing: false }, null, 2) + '\n');
console.log(JSON.stringify({ out, files: inventory.length + 1, validation: report.status, comparisons: records.length }));
