import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { workspace } from './bridge.mjs';

const commands = [
  ['--check', '도구/claude-bridge/bridge.mjs'],
  ['--check', '도구/claude-bridge/verify.mjs'],
  ['--test', '도구/claude-bridge/bridge.test.mjs'],
  ['스킬모음/skill-creator/scripts/workspace-skills.mjs', 'validate'],
  ['스킬모음/skill-creator/scripts/workspace-skills.mjs', 'catalog'],
];
let passed = true;
const results = commands.map(args => {
  const result = spawnSync(process.execPath, args, { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.status !== 0 || result.error) passed = false;
  return { command: ['node', ...args], exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || null };
});
const report = JSON.stringify({ status: passed ? 'passed' : 'failed', checkedAt: new Date().toISOString(), results, build: '해당 없음: 컴파일이나 패키지 의존성이 없는 Node.js 모듈' }, null, 2);
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), `${report}\n`, 'utf8');
process.stdout.write(`${report}\n`);
if (!passed) process.exitCode = 1;
