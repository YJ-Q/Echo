import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('current Margin audit distinguishes verified behavior from goals', async () => {
  const source = await read('docs/audit/current_margin_status.md');
  for (const term of ['chatService.js', 'memoryStore.js', '186', '会话历史', '长期记忆', '尚未集成']) {
    assert.match(source, new RegExp(term));
  }
});

test('Pi version audit contains reproducible upstream evidence', async () => {
  const source = await read('docs/architecture/pi_version_and_license.md');
  for (const term of ['earendil-works/pi', 'v0.84.2', '@earendil-works/pi-coding-agent', 'MIT', '22.19.0', '2026-08-20', '证据链接']) {
    assert.match(source, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('contribution boundary separates Pi, Margin, and unfinished work', async () => {
  const source = await read('docs/architecture/contribution_boundary.md');
  for (const term of ['Pi 原生能力', 'Margin 新增能力', '尚未实现', 'Agent loop', 'Session', '压缩', 'memory_search', 'memory_propose', 'state_update', 'action_update']) {
    assert.match(source, new RegExp(term));
  }
});

test('integration ADR records SDK decision, fallback, risks, and rollback', async () => {
  const source = await read('docs/architecture/integration_decision.md');
  for (const term of ['AgentSessionRuntime', 'RPC fallback', '否决方案', '风险', '回滚边界']) {
    assert.match(source, new RegExp(term));
  }
});
