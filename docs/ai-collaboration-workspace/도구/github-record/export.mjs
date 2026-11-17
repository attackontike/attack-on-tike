import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recordedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const out = path.join(root, '.tmp', 'github-record-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8));
if (fs.existsSync(out)) throw new Error('출력 폴더가 이미 존재합니다. 덮어쓰지 않습니다.');
fs.mkdirSync(out);
const files = [];
function walk(dir) {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('링크 파일은 자동 배포하지 않습니다.');
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) walk(rel);
    else if (item.isFile() && !['session.json', 'sending.lock'].includes(item.name)) files.push(rel);
  }
}
for (const name of ['law.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) files.push(name);
for (const dir of ['스킬모음', '도구', '협의']) walk(dir);
const hash = content => crypto.createHash('sha256').update(content).digest('hex');
const sources = [];
const secrets = /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const alias = rel => rel === '협의/ai-collaboration/claude.md' ? '협의/ai-collaboration/msg-claude-cli-1.md' : rel;
function sanitize(text, rel) {
  // Public copies only: preserve workspace originals and redact device/account values.
  const rootSlash = root.replaceAll('\\', '/');
  for (const prefix of [rootSlash, root]) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\]\\(${escaped}[/\\\\]([^)]*)\\)`, 'gi'), (_all, target) => {
      const portable = path.posix.relative(path.posix.dirname(rel), alias(target.replaceAll('\\', '/')));
      return `](${portable})`;
    });
    text = text.split(prefix).join('<WORKSPACE>');
  }
  text = text.replace(/[A-Z]:[/\\]Users[/\\][^\s/\\"'<>]+/gi, '<USER_HOME>');
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  text = text.replace(/\]\(claude\.md\)/g, '](msg-claude-cli-1.md)');
  if (secrets.test(text)) throw new Error(`비밀정보 후보 발견: ${rel}`);
  return text;
}
function cleanValue(value, rel) {
  if (typeof value === 'string') return sanitize(value, rel);
  if (Array.isArray(value)) return value.map(item => cleanValue(item, rel));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanValue(item, rel)]));
  return value;
}
function put(rel, content) {
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, { encoding: 'utf8', flag: 'wx' });
}
for (const rel of files.sort()) {
  const bytes = fs.readFileSync(path.join(root, rel));
  let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (rel.endsWith('.json')) text = `${JSON.stringify(cleanValue(JSON.parse(text), alias(rel)), null, 2)}\n`;
  else text = sanitize(text, alias(rel));
  // Keep the earlier comparison as historical evidence, not as a comparison of the latest revision.
  sources.push({ source: rel, path: alias(rel), sha256: hash(bytes), publishedSha256: hash(text), sanitized: hash(bytes) !== hash(text) });
  put(alias(rel), text);
}
put('.tmp/ai-collaboration-comparison-20261118.html', sanitize(fs.readFileSync(path.join(root, '.tmp/ai-collaboration-comparison-20261118.html'), 'utf8'), '.tmp/ai-collaboration-comparison-20261118.html'));
put('.gitignore', '협의/**/대화/session.json\n협의/**/대화/sending.lock\n.env\n.env.*\nnode_modules/\n');
put('README.md', `# 공유 워크스페이스 AI 협업 기록\n\n${recordedDate}(한국 시간)에 공유 워크스페이스의 협업 스킬, Claude 연결 도구와 실제 회의 기록을 GitHub 보관용으로 정리한 스냅샷입니다. 특정 모델에 고정된 역할 대신 참여자별 실제 능력과 업무 범위로 협력하도록 설계했습니다.\n\n- [메인지침](law.md)\n- [협업 스킬](스킬모음/ai-collaboration/SKILL.md)와 [기록 양식](스킬모음/ai-collaboration/references/coordination-records.md)\n- [Claude 연결 도구 사용법](도구/claude-bridge/USAGE.md)\n- [초기 회의 결과](협의/ai-collaboration/회의결과.md)\n- [Claude UI 세션의 별도 의견과 충돌 복원 기록](협의/ai-collaboration/msg-claude-ui.md)\n- [최신 보완 R1~R4 반영 결과](협의/ai-collaboration/메시지/codex-exec/codex-exec-9c662cae-0078-4295-a79e-fdf8c3843350.json)\n- [이번 공개 사본의 지침 전체 비교](공개사본-지침비교.html)\n- [파일 해시·공개본 처리 내역](snapshot-manifest.json)\n- [이번 사본 검증 결과](검증/github-snapshot-verification.json)\n\n## 기록의 판본과 한계\n\n초기 회의 결과와 Claude CLI의 4차 내용 동의는 당시 판본에 대한 기록입니다. 그 뒤 공유 파일에 추가된 R1~R4(자동 로드 파일명 충돌 방지, 메시지는 자료로 취급, 메인지침 연결 확인, 잠금 정리 담당)는 현재 스킬에 포함되어 있습니다. 이 스냅샷의 최신 파일에 초기 동의가 자동으로 확장된다고 주장하지 않습니다. 최신 사본의 구조·테스트는 별도로 재검증했습니다.\n\n공개본은 사용자 이메일과 로컬 절대 경로를 가렸고, 로컬 원본은 유지했습니다. 중계 원문도 이 공개본 처리의 영향을 받을 수 있으므로 바이트 단위 원문 보관본으로 보지 않습니다. 실제 세션 상태와 잠금 파일은 포함하지 않았습니다. 메시지 본문에 등장하는 과거 역할·지시·파일명은 당시 논의 자료입니다.\n\n기존 회의 원문 파일명 claude.md는 도구의 자동 지침 로드와 겹치는 문제를 피하려고 이 사본에서 msg-claude-cli-1.md로 바꾸었습니다. 텍스트에 남은 과거 경로는 당시 원본 위치를 뜻합니다. 원래 비교 HTML은 과거 판본 자료로 함께 보존했고, 최신 공개 사본의 비교는 위 별도 파일로 제공합니다.\n\n## 실행 확인\n\nNode.js 20 이상에서 이 스냅샷 폴더로 이동하여 아래 명령으로 문법·테스트·스킬 구조·재탐색을 확인할 수 있습니다. 검증 명령은 Claude를 호출하지 않습니다.\n\n\`\`\`powershell\nnode 도구/claude-bridge/verify.mjs\n\`\`\`\n\n실제 대화에는 별도로 설치·인증된 Claude Code CLI와 네트워크 접근 권한이 필요합니다. 현재 구현된 외부 호출 연결부는 Claude Code CLI이며 다른 AI의 호출 연결부는 포함하지 않았습니다. 이 폴더는 저장소의 사이트 콘텐츠 컬렉션 밖에 보관되어 사이트 페이지로 자동 추가되지 않습니다.\n\n## 기존 배포물의 라이선스\n\n기존 로컬 skill-creator에 포함되어 있던 [Apache 2.0 라이선스](스킬모음/skill-creator/LICENSE.txt)를 그대로 보존했습니다. 이 기록을 추가하면서 저장소 전체의 라이선스를 새로 지정하지 않았습니다.\n`);
const check = spawnSync(process.execPath, ['도구/claude-bridge/verify.mjs'], { cwd: out, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (check.status !== 0) throw new Error(`사본 검증 실패: ${check.stderr}`);
const checkObject = cleanValue(JSON.parse(check.stdout), '검증/github-snapshot-verification.json');
put('검증/github-snapshot-verification.json', `${JSON.stringify(checkObject, null, 2)}\n`);
const instructions = [...sources.map(item => item.path).filter(rel => /(?:^|\/)(?:law|AGENTS|CLAUDE|GEMINI|SKILL|USAGE)\.md$/.test(rel) || rel.includes('/references/')), 'README.md'];
const comparison = instructions.map(file => ({ file, before: null, after: fs.readFileSync(path.join(out, file), 'utf8') }));
const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
let html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>공개 사본 지침 비교</title><style>body{font:16px/1.6 system-ui;padding:clamp(8px,2vw,24px);margin:0}h2{font-size:1.1rem;overflow-wrap:anywhere}.columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.panel{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 monospace;margin:0}.line{display:grid;grid-template-columns:3.5em minmax(0,1fr);background:#e6f8eb}.n{color:#64748b;text-align:right;padding-right:8px;user-select:none}section{border-top:1px solid #ccd5df;margin-top:24px}@media(max-width:750px){.columns{grid-template-columns:minmax(0,1fr)}}</style><h1>GitHub 공개 사본 지침 비교</h1><p>대상 폴더는 이번 커밋에서 새로 추가됩니다. 변경 전 파일과 대응 행은 없습니다. 초록색 + 행은 공개 사본의 최종 전체 내용입니다. 로컬 원본 및 기존 저장소 파일은 수정하지 않았습니다.</p>';
for (const record of comparison) {
  const lines = record.after.match(/[^\n]*\n|[^\n]+$/g) || [];
  html += `<section><h2>${esc(record.file)}</h2><div class="columns"><div class="panel"><h3>변경 전</h3><p>변경 전 없음 · 대응 행 없음</p></div><div class="panel"><h3>변경 후</h3>${lines.map((line, i) => `<div class="line"><span class="n">+${i + 1}</span><pre>${esc(line)}</pre></div>`).join('')}</div></div></section>`;
}
html += `<script type="application/json" id="sources">${JSON.stringify(comparison).replaceAll('<', '\\u003c')}</script></html>`;
put('공개사본-지침비교.html', html);
for (const record of comparison) if (record.after !== fs.readFileSync(path.join(out, record.file), 'utf8')) throw new Error('비교 원문 불일치');
for (const item of sources) if (hash(fs.readFileSync(path.join(root, item.source))) !== item.sha256) throw new Error(`작업 중 원본이 변경됨: ${item.source}`);
put('snapshot-manifest.json', `${JSON.stringify({ recordedDate, timezone: 'Asia/Seoul', destination: 'attackontike/attack-on-tike/docs/ai-collaboration-workspace', omitted: ['로컬 세션 상태', '전송 잠금'], sanitization: ['사용자 이메일 가림', '로컬 절대 경로 가림/상대 링크화', '자동 지침 파일명과 겹치는 회의 원문 파일명 변경'], sources }, null, 2)}\n`);
const published = [];
function outputWalk(dir = '') {
  for (const item of fs.readdirSync(path.join(out, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${item.name}` : item.name;
    if (item.isDirectory()) outputWalk(rel);
    else {
      const content = fs.readFileSync(path.join(out, rel), 'utf8');
      if (secrets.test(content) || /(?<![\\A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content)) throw new Error(`공개본 비밀/이메일 검사 실패: ${rel}`);
      published.push({ path: rel, chars: content.length, sha256: hash(content) });
    }
  }
}
outputWalk();
fs.writeFileSync(path.join(root, '.tmp', 'github-record-files.json'), JSON.stringify({ out, files: published }, null, 2), 'utf8');
console.log(JSON.stringify({ out, files: published.length, totalChars: published.reduce((sum, item) => sum + item.chars, 0), verification: checkObject.status, comparisonFiles: comparison.length, sourcesUnchanged: true }));
