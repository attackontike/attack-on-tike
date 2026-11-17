import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { send, history, runClaude } from './bridge.mjs';

function isolated(t) {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bridge-test-'));
  t.after(() => fs.rmSync(store, { recursive: true, force: true }));
  return store;
}

test('첫 전송과 후속 전송은 같은 세션을 사용하고 한국어와 인용문을 그대로 보존한다', async t => {
  const store = isolated(t);
  const calls = [];
  const execute = async (_exe, args, message) => {
    calls.push({ args, message });
    return { session_id: args.at(-1), result: '실제 반환값 모의 응답', subtype: 'success' };
  };
  const message = '안녕 "Claude"\n$(실행 금지) `literal`';
  await send(message, { store, executable: 'mock', execute });
  await send('두 번째 질문', { store, executable: 'mock', execute });
  assert.equal(calls[0].message.split('\n\n').slice(1).join('\n\n'), message);
  assert.equal(calls[0].args.at(-2), '--session-id');
  assert.equal(calls[1].args.at(-2), '--resume');
  assert.equal(calls[0].args.at(-1), calls[1].args.at(-1));
  assert.equal(history(store).length, 2);
  assert.ok(history(store).every(entry => entry.status === 'received'));
});

test('진행 중인 전송의 잠금을 다른 전송이 탈취하지 않는다', async t => {
  const store = isolated(t);
  fs.writeFileSync(path.join(store, 'sending.lock'), 'another sender');
  await assert.rejects(send('전송', { store }), /다른 전송/);
  assert.equal(fs.readFileSync(path.join(store, 'sending.lock'), 'utf8'), 'another sender');
});

test('실패 기록을 보존하고 자동 재시도하지 않으며 잠금을 해제한다', async t => {
  const store = isolated(t);
  let calls = 0;
  await assert.rejects(send('질문', { store, executable: 'mock', execute: async () => { calls++; throw new Error('인증 실패'); } }), /인증 실패/);
  assert.equal(calls, 1);
  assert.equal(history(store)[0].status, 'failed');
  assert.equal(fs.existsSync(path.join(store, 'sending.lock')), false);
});

test('세션이 달라진 응답을 성공으로 저장하지 않는다', async t => {
  const store = isolated(t);
  await assert.rejects(send('질문', { store, executable: 'mock', execute: async () => ({ session_id: 'wrong', result: '답변' }) }), /응답 세션이 다릅니다/);
  assert.equal(history(store)[0].status, 'failed');
});

test('실제 자식 프로세스에서 JSON 및 한국어 응답을 받는다', async t => {
  const store = isolated(t);
  const fixture = path.join(store, 'child.cjs');
  fs.writeFileSync(fixture, 'let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>input+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({subtype:"success",session_id:"11111111-1111-4111-8111-111111111111",result:input})));');
  const result = await runClaude(process.execPath, [fixture], '한글 메시지\n"인용"');
  assert.equal(result.result, '한글 메시지\n"인용"');
});

test('시간 초과와 잘못된 JSON을 성공으로 처리하지 않는다', async t => {
  const store = isolated(t);
  const fixture = path.join(store, 'wait.cjs');
  fs.writeFileSync(fixture, 'setTimeout(()=>{},10000);');
  await assert.rejects(runClaude(process.execPath, [fixture], '질문', 100), /시간 초과/);
  const invalid = path.join(store, 'invalid.cjs');
  fs.writeFileSync(invalid, 'process.stdout.write("not-json");');
  await assert.rejects(runClaude(process.execPath, [invalid], '질문'), /응답 처리 실패/);
});

test('세 번째 AI의 발신자·업무·메시지 ID를 실제 전달 본문에 넣는다', async t => {
  const store = isolated(t);
  let received;
  const entry = await send('새 AI 참여', { store, from: 'agent-c', taskId: 'meeting-3', executable: 'mock', execute: async (_exe, args, input) => {
    received = input;
    return { session_id: args.at(-1), result: '수신 확인' };
  } });
  const header = JSON.parse(received.split('\n')[0]);
  assert.equal(header.from, 'agent-c');
  assert.equal(header.taskId, 'meeting-3');
  assert.equal(header.messageId, entry.id);
  assert.equal(entry.replyTo, entry.id);
  assert.equal(entry.recordedBy, 'agent-c');
});

test('손상된 로그가 있어도 나머지 대화 기록을 읽을 수 있다', async t => {
  const store = isolated(t);
  fs.writeFileSync(path.join(store, '11111111-1111-4111-8111-111111111111.json'), '{broken');
  await send('정상 메시지', { store, executable: 'mock', execute: async (_exe, args) => ({ session_id: args.at(-1), result: '정상 응답' }) });
  const entries = history(store);
  assert.equal(entries.length, 2);
  assert.ok(entries.some(entry => entry.status === 'corrupt'));
  assert.ok(entries.some(entry => entry.status === 'received'));
});
