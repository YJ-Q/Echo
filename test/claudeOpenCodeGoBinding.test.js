import assert from 'node:assert/strict';
import test from 'node:test';
import { adapterFor } from '../src/agents/adapters.js';
import { openCodeGoPoolIdentity, resolveClaudeOpenCodeGoBinding } from '../src/resources/claudeOpenCodeGoBinding.js';
import { resetOpenCodeGoQuotaCache } from '../src/resources/opencodeGoQuota.js';

const SECRET = 'synthetic-opencode-go-credential-only-in-memory';
const NOW = Date.parse('2026-09-08T06:00:00.000Z');

function bindingState(overrides = {}) {
  const providerDefaults = {
    id: 'provider-a', app_type: 'claude', name: 'OpenCode Go', is_current: 1,
    meta: { usage_script: { enabled: true, codingPlanProvider: 'opencode_go' }, apiFormat: 'openai_responses' },
    settings_config: { env: { ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go', ANTHROPIC_AUTH_TOKEN: SECRET } },
  };
  return {
    ccSwitchSettings: { currentProviderClaude: 'provider-a', enableLocalProxy: true, ...overrides.ccSwitchSettings },
    providerRow: { ...providerDefaults, ...overrides.providerRow,
      meta: overrides.providerRow?.meta ?? providerDefaults.meta,
      settings_config: overrides.providerRow?.settings_config ?? providerDefaults.settings_config },
    proxyConfig: { app_type: 'claude', proxy_enabled: 1, enabled: 1, listen_address: '127.0.0.1', listen_port: 15721, ...overrides.proxyConfig },
    claudeSettings: { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721' }, ...overrides.claudeSettings },
  };
}

function proveBinding(overrides = {}) {
  return resolveClaudeOpenCodeGoBinding(bindingState(overrides));
}

const usageBody = (rolling = 14) => ({ usage: {
  rolling: { status: 'ok', percent: rolling, resetsAt: '2026-09-08T10:36:05.906Z' },
  weekly: { status: 'ok', percent: 7, resetsAt: '2026-09-14T00:00:00.000Z' },
  monthly: { status: 'ok', percent: 3, resetsAt: '2026-10-07T16:11:13.906Z' },
} });

test('Claude binding proves current CC Switch provider, proxy route, endpoint, and credential source without exposing credential', () => {
  const result = proveBinding();
  assert.equal(result.available, true);
  assert.equal(result.providerType, 'opencode_go');
  assert.equal(result.provider, 'opencode-go');
  assert.equal(result.endpoint, 'https://opencode.ai/zen/go');
  assert.equal(result.credentialSource, 'cc-switch.providers.settings_config.env.ANTHROPIC_AUTH_TOKEN');
  assert.match(result.providerIdentity, /^provider:[0-9a-f]{24}$/);
  assert.match(result.configIdentity, /^provider-config:[0-9a-f]{24}$/);
  assert.match(result.quotaPoolIdentity, /^quota-pool:opencode_go:[0-9a-f]{24}$/);
  assert.equal(result.routeProof, 'cc-switch-current-provider+claude-loopback-proxy+opencode-go-config');
  assert.equal(result.credential, SECRET);
  assert.equal(Object.keys(result).includes('credential'), false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test('Claude binding rejects a non-current, non-Go, or non-proxied provider instead of guessing', () => {
  assert.equal(proveBinding({ ccSwitchSettings: { currentProviderClaude: 'provider-b' } }).reason, 'provider_pointer_mismatch');
  assert.equal(proveBinding({ providerRow: { is_current: 0 } }).reason, 'provider_not_current');
  assert.equal(proveBinding({ providerRow: { meta: { usage_script: { codingPlanProvider: 'anthropic' } } } }).reason, 'provider_not_opencode_go');
  assert.equal(proveBinding({ claudeSettings: { env: { ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go' } } }).reason, 'claude_proxy_route_mismatch');
  assert.equal(proveBinding({ providerRow: { settings_config: { env: { ANTHROPIC_BASE_URL: 'https://example.invalid', ANTHROPIC_AUTH_TOKEN: SECRET } } } }).reason, 'opencode_go_endpoint_mismatch');
  assert.equal(proveBinding({ providerRow: { settings_config: { env: { ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go' } } } }).reason, 'missing_provider_credential');
});

test('same provider type and credential produce the same non-reversible pool identity; different credentials do not', () => {
  assert.equal(openCodeGoPoolIdentity({ providerType: 'opencode_go', credential: 'same' }), openCodeGoPoolIdentity({ providerType: 'opencode_go', credential: 'same' }));
  assert.notEqual(openCodeGoPoolIdentity({ providerType: 'opencode_go', credential: 'same' }), openCodeGoPoolIdentity({ providerType: 'opencode_go', credential: 'different' }));
  assert.notEqual(openCodeGoPoolIdentity({ providerType: 'opencode_go', credential: 'same' }), openCodeGoPoolIdentity({ providerType: 'other', credential: 'same' }));
});

test('Claude adapter reuses Go quota reader and emits only provider quota DTO fields', async () => {
  resetOpenCodeGoQuotaCache();
  const source = { path: 'synthetic-claude-home', sourceId: 'claude-test', id: 'claude-test', type: 'claude', enabled: true };
  let receivedCredential;
  const result = await adapterFor('claude').collectResourceSnapshot(source, {
    now: NOW,
    revision: 'rev-claude',
    resolveClaudeProvider: () => proveBinding(),
    fetchGoQuota: async (credential) => { receivedCredential = credential; return { ok: true, body: usageBody() }; },
  });
  assert.equal(receivedCredential, SECRET);
  const agent = result.agents[0];
  assert.equal(agent.agent, 'claude-code');
  assert.equal(agent.provider, 'opencode-go');
  assert.equal(agent.subscriptionQuota, true);
  assert.deepEqual(agent.resources.map((resource) => [resource.window, resource.remaining]), [['5h', 86], ['7d', 93], ['M', 97]]);
  assert.equal(agent.resources.every((resource) => resource.agent === 'claude-code'), true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(result), /credential|api[_-]?key/i);
});

test('Claude non-Go binding and CC Switch failure stay unavailable without using Pi credential', async () => {
  let fetchCalls = 0;
  const source = { path: 'synthetic-claude-home', sourceId: 'claude-nogo', id: 'claude-nogo', type: 'claude', enabled: true };
  const result = await adapterFor('claude').collectResourceSnapshot(source, {
    resolveClaudeProvider: () => ({ available: false, reason: 'provider_not_opencode_go' }),
    fetchGoQuota: async () => { fetchCalls += 1; return { ok: true, body: usageBody() }; },
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.agents[0].unavailable, true);
  assert.deepEqual(result.agents[0].resources, []);
  assert.equal(result.agents[0].provider, undefined);
});

test('Claude Go quota uses LKG + stale on a temporary failure and invalidates by credential', async () => {
  resetOpenCodeGoQuotaCache();
  const source = { path: 'synthetic-claude-home', sourceId: 'claude-lkg', id: 'claude-lkg', type: 'claude', enabled: true };
  const good = await adapterFor('claude').collectResourceSnapshot(source, {
    now: NOW, resolveClaudeProvider: () => proveBinding(), fetchGoQuota: async () => ({ ok: true, body: usageBody(14) }),
  });
  assert.equal(good.agents[0].resources.find((resource) => resource.window === '5h').remaining, 86);
  const stale = await adapterFor('claude').collectResourceSnapshot(source, {
    now: NOW + 70_000, resolveClaudeProvider: () => proveBinding(), fetchGoQuota: async () => ({ ok: false, reason: 'http_500' }),
  });
  assert.equal(stale.agents[0].stale, true);
  assert.equal(stale.agents[0].resources.find((resource) => resource.window === '5h').remaining, 86);
  assert.equal(stale.agents[0].resources.find((resource) => resource.window === '5h').stale, false);
  const changed = await adapterFor('claude').collectResourceSnapshot(source, {
    now: NOW + 71_000,
    resolveClaudeProvider: () => proveBinding({ providerRow: { settings_config: { env: { ANTHROPIC_BASE_URL: 'https://opencode.ai/zen/go', ANTHROPIC_AUTH_TOKEN: 'different-synthetic-key' } } } }),
    fetchGoQuota: async () => ({ ok: false, reason: 'http_401' }),
  });
  assert.equal(changed.agents[0].unavailable, true);
  assert.deepEqual(changed.agents[0].resources, []);

  const switchedProvider = await adapterFor('claude').collectResourceSnapshot(source, {
    now: NOW + 72_000,
    resolveClaudeProvider: () => proveBinding({ ccSwitchSettings: { currentProviderClaude: 'provider-b' }, providerRow: { id: 'provider-b' } }),
    fetchGoQuota: async () => ({ ok: false, reason: 'http_500' }),
  });
  assert.equal(switchedProvider.agents[0].unavailable, true, 'provider/config switch must not reuse another binding LKG');
  assert.deepEqual(switchedProvider.agents[0].resources, []);
});
