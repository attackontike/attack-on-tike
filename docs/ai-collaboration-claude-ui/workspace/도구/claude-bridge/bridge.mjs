import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultStore = path.join(workspace, '협의', 'ai-collaboration', '대화');

export function findClaude(env = process.env) {
  const candidates = [env.CLAUDE_BRIDGE_EXE];
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude'));
    if (process.platform === 'win32') candidates.push(path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  }
  if (process.platform === 'win32' && env.APPDATA) candidates.push(path.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  candidates.push(path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  const found = candidates.find(file => file && fs.existsSync(file) && fs.statSync(file).isFile());
  if (!found) throw new Error('Claude 실행 파일을 찾지 못했습니다. CLAUDE_BRIDGE_EXE에 실행 파일의 경로를 지정하세요.');
  return found;
}

export function runClaude(executable, args, input, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: workspace, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const collect = (stream, isError) => stream.on('data', chunk => {
      if (isError) errors += chunk.toString('utf8');
      else output += chunk.toString('utf8');
      if (Buffer.byteLength(output) + Buffer.byteLength(errors) > 8 * 1024 * 1024) { overflow = true; child.kill(); }
    });
    // setEncoding retains split multibyte Korean characters across chunks.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    collect(child.stdout, false);
    collect(child.stderr, true);
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('Claude 응답 시간 초과. 자동 재전송하지 않습니다. history와 Claude 세션을 확인하세요.'));
      if (overflow) return reject(new Error('Claude 출력 용량 한도 초과. 자동 재전송하지 않습니다.'));
      if (code !== 0) return reject(new Error(`Claude 종료 코드 ${code}: ${(errors || output).slice(0, 2000)}`));
      try {
        const result = JSON.parse(output);
        if (result.is_error || result.subtype !== 'success' || typeof result.result !== 'string' || !result.result.trim()) throw new Error(result.result || result.subtype || '빈 응답');
        if (typeof result.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(result.session_id)) throw new Error('유효한 session_id가 없습니다.');
        resolve(result);
      } catch (error) { reject(new Error(`Claude 응답 처리 실패: ${error.message}`)); }
    });
    child.stdin.end(input, 'utf8');
  });
}

export async function send(message, { store = defaultStore, execute = runClaude, executable, timeoutMs = 180000, from = 'local-agent', taskId = 'ai-collaboration' } = {}) {
  if (typeof message !== 'string' || !message.trim()) throw new Error('빈 메시지는 보낼 수 없습니다.');
  if (![from, taskId].every(value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value))) throw new Error('from과 taskId에는 소문자 영문, 숫자, 하이픈을 사용하세요.');
  fs.mkdirSync(store, { recursive: true });
  const lock = path.join(store, 'sending.lock');
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('다른 전송이 진행 중이거나 이전 전송의 잠금이 남아 있습니다. 자동으로 잠금을 탈취하지 않습니다.'); throw error; }
  const id = randomUUID();
  const entryFile = path.join(store, `${id}.json`);
  const stateFile = path.join(store, 'session.json');
  let entry;
  try {
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), id }));
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { sessionId: randomUUID(), established: false };
    if (!/^[0-9a-f-]{36}$/i.test(state.sessionId) || typeof state.established !== 'boolean') throw new Error('세션 상태 파일이 손상되었습니다.');
    // Persist the chosen ID before sending, including on a first-turn failure.
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
    entry = { schemaVersion: 1, id, taskId, sessionId: state.sessionId, via: 'claude-code-cli', sentAt: new Date().toISOString(), status: 'sending', from, to: 'claude-code-cli', message };
    fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2), { encoding: 'utf8', flag: 'wx' });
    const args = ['--print', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk'];
    args.push(state.established ? '--resume' : '--session-id', state.sessionId);
    const header = JSON.stringify({ schemaVersion: 1, from, to: 'claude-code-cli', taskId, messageId: id });
    const result = await execute(executable || findClaude(), args, `${header}\n\n${message}`, timeoutMs);
    if (result.session_id !== state.sessionId) throw new Error('요청한 세션과 응답 세션이 다릅니다.');
    entry.status = 'received';
    entry.receivedAt = new Date().toISOString();
    entry.reply = result.result;
    entry.replyFrom = 'claude-code-cli';
    entry.replyTo = id;
    entry.recordedBy = from;
    entry.costEstimateUsd = result.total_cost_usd ?? null;
    fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2), 'utf8');
    fs.writeFileSync(stateFile, JSON.stringify({ sessionId: result.session_id, established: true }, null, 2), 'utf8');
    return entry;
  } catch (error) {
    if (entry) { entry.status = 'failed'; entry.error = error.message; fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2), 'utf8'); }
    throw error;
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

export function history(store = defaultStore) {
  if (!fs.existsSync(store)) return [];
  return fs.readdirSync(store).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).map(name => {
    try { return JSON.parse(fs.readFileSync(path.join(store, name), 'utf8')); }
    catch (error) { return { id: name.slice(0, -5), status: 'corrupt', error: error.message }; }
  }).sort((a, b) => String(a.sentAt || '').localeCompare(String(b.sentAt || '')));
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'status') return { executable: findClaude(), state: fs.existsSync(path.join(defaultStore, 'session.json')) ? JSON.parse(fs.readFileSync(path.join(defaultStore, 'session.json'), 'utf8')) : null, store: defaultStore, locked: fs.existsSync(path.join(defaultStore, 'sending.lock')) };
  if (command === 'history') return history();
  if (command === 'send') {
    const options = {};
    while (rest.length) {
      const key = rest.shift();
      if (!['--file', '--from', '--task'].includes(key) || !rest.length || Object.hasOwn(options, key)) throw new Error('잘못된 전송 옵션');
      options[key] = rest.shift();
    }
    if (!options['--file']) throw new Error('--file이 필요합니다.');
    const entry = await send(fs.readFileSync(path.resolve(options['--file']), 'utf8').replace(/^\uFEFF/, ''), { from: options['--from'] || 'local-agent', taskId: options['--task'] || 'ai-collaboration' });
    const { message, ...summary } = entry;
    return summary;
  }
  throw new Error('사용법: node 도구/claude-bridge/bridge.mjs status | history | send --file <UTF-8 메시지 파일> [--from <참여자>] [--task <업무>]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
