import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

// Claude's OpenCode Go binding is deliberately narrower than a provider registry. It proves
// the current Claude route from CC Switch's current-provider pointer, the provider row, and the
// local proxy settings. The raw credential is an internal, non-enumerable value used only by the
// quota reader; it is never suitable for a DTO, telemetry, HANDOFF, or log message.

const DEFAULT_PROXY_ADDRESS = '127.0.0.1';
const DEFAULT_PROXY_PORT = 15721;
const OPEN_CODE_GO_HOST = 'opencode.ai';
const OPEN_CODE_GO_PATH = '/zen/go';

function string(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function parsedObject(value) {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return null; }
  }
  return object(value);
}

function profileHome({ env = process.env, homedir = os.homedir } = {}) {
  return string(env.USERPROFILE) || string(env.HOME) || homedir();
}

function sha256(value, length = 24) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

export function openCodeGoPoolIdentity({ providerType, credential } = {}) {
  const type = string(providerType);
  const secret = string(credential);
  if (!type || !secret) return null;
  return `quota-pool:${type}:${sha256(`${type}\0${secret}`)}`;
}

function configIdentity({ providerId, providerType, endpoint } = {}) {
  return `provider-config:${sha256(`${providerId}\0${providerType}\0${endpoint}`)}`;
}

function providerIdentity(providerId) {
  return `provider:${sha256(providerId)}`;
}

function openCodeGoEndpoint(value) {
  const endpoint = string(value);
  if (!endpoint) return null;
  try {
    const parsed = new URL(endpoint);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    if (parsed.protocol !== 'https:' || parsed.hostname !== OPEN_CODE_GO_HOST || normalizedPath !== OPEN_CODE_GO_PATH) return null;
    return parsed.toString().replace(/\/$/, '');
  } catch { return null; }
}

function loopbackProxy(value, proxyConfig) {
  const endpoint = string(value);
  if (!endpoint) return false;
  try {
    const parsed = new URL(endpoint);
    const expectedAddress = string(proxyConfig?.listen_address) || DEFAULT_PROXY_ADDRESS;
    const expectedPort = Number(proxyConfig?.listen_port ?? DEFAULT_PROXY_PORT);
    return parsed.protocol === 'http:'
      && (parsed.hostname === expectedAddress || (expectedAddress === DEFAULT_PROXY_ADDRESS && parsed.hostname === 'localhost'))
      && Number(parsed.port || 80) === expectedPort;
  } catch { return false; }
}

function enabled(value) { return value === true || value === 1 || value === '1'; }

function withCredential(context, credential) {
  const result = { ...context };
  // Keep the secret available to the adapter while making accidental JSON serialization safe.
  Object.defineProperty(result, 'credential', { value: credential, enumerable: false, writable: false });
  return Object.freeze(result);
}

function unavailable(reason) { return { available: false, reason }; }

// Pure binding proof. Tests can exercise all routing/security decisions without opening the
// user's database or placing a request with a real credential.
export function resolveClaudeOpenCodeGoBinding({
  ccSwitchSettings,
  providerRow,
  proxyConfig,
  claudeSettings,
} = {}) {
  const cc = object(ccSwitchSettings);
  const provider = object(providerRow);
  const proxy = object(proxyConfig);
  const claude = object(claudeSettings);
  const currentId = string(cc?.currentProviderClaude);
  const providerId = string(provider?.id);
  if (!currentId) return unavailable('missing_current_provider');
  if (!providerId || currentId !== providerId) return unavailable('provider_pointer_mismatch');
  if (string(provider?.app_type) !== 'claude' || !enabled(provider?.is_current)) return unavailable('provider_not_current');
  if (cc?.enableLocalProxy !== true) return unavailable('local_proxy_disabled');
  if (!enabled(proxy?.proxy_enabled) || !enabled(proxy?.enabled)) return unavailable('claude_proxy_disabled');
  if (!loopbackProxy(claude?.env?.ANTHROPIC_BASE_URL, proxy)) return unavailable('claude_proxy_route_mismatch');
  if (string(proxy?.listen_address) !== DEFAULT_PROXY_ADDRESS || Number(proxy?.listen_port) !== DEFAULT_PROXY_PORT) {
    return unavailable('unexpected_claude_proxy_listener');
  }

  const meta = parsedObject(provider.meta);
  const providerConfig = parsedObject(provider.settings_config);
  const providerEnv = object(providerConfig?.env);
  const providerType = string(meta?.usage_script?.codingPlanProvider)?.toLowerCase();
  if (providerType !== 'opencode_go') return unavailable('provider_not_opencode_go');
  const endpoint = openCodeGoEndpoint(providerEnv?.ANTHROPIC_BASE_URL);
  if (!endpoint) return unavailable('opencode_go_endpoint_mismatch');
  const token = string(providerEnv?.ANTHROPIC_AUTH_TOKEN);
  const apiKey = string(providerEnv?.ANTHROPIC_API_KEY);
  const credential = token || apiKey;
  if (!credential) return unavailable('missing_provider_credential');

  return withCredential({
    available: true,
    provider: 'opencode-go',
    providerType,
    providerName: string(provider.name) || 'OpenCode Go',
    providerIdentity: providerIdentity(providerId),
    configIdentity: configIdentity({ providerId, providerType, endpoint }),
    credentialSource: token
      ? 'cc-switch.providers.settings_config.env.ANTHROPIC_AUTH_TOKEN'
      : 'cc-switch.providers.settings_config.env.ANTHROPIC_API_KEY',
    endpoint,
    quotaPoolIdentity: openCodeGoPoolIdentity({ providerType, credential }),
    routeProof: 'cc-switch-current-provider+claude-loopback-proxy+opencode-go-config',
  }, credential);
}

function readJson(filePath) {
  try {
    return parsedObject(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch { return null; }
}

function readProviderState({ ccSwitchHome, claudeHome }) {
  const ccSwitchSettings = readJson(path.join(ccSwitchHome, 'settings.json'));
  const dbPath = path.join(ccSwitchHome, 'cc-switch.db');
  if (!ccSwitchSettings || !string(ccSwitchSettings.currentProviderClaude)) return unavailable('cc-switch_current_provider_unavailable');

  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const providerRow = db.prepare(`
      SELECT id, app_type, name, settings_config, category, meta, is_current
      FROM providers
      WHERE id = ? AND app_type = ?
    `).get(ccSwitchSettings.currentProviderClaude, 'claude');
    const proxyConfig = db.prepare(`
      SELECT app_type, proxy_enabled, listen_address, listen_port, enabled
      FROM proxy_config
      WHERE app_type = ?
    `).get('claude');
    const baseSettings = readJson(path.join(claudeHome, 'settings.json')) || {};
    const localSettings = readJson(path.join(claudeHome, 'settings.local.json')) || {};
    const claudeSettings = {
      ...baseSettings,
      ...localSettings,
      env: { ...object(baseSettings.env), ...object(localSettings.env) },
    };
    return resolveClaudeOpenCodeGoBinding({ ccSwitchSettings, providerRow, proxyConfig, claudeSettings });
  } catch (error) {
    return unavailable(error?.code === 'SQLITE_CANTOPEN' ? 'cc-switch_database_unavailable' : 'cc-switch_state_unavailable');
  } finally {
    try { db?.close(); } catch { /* read-only cleanup */ }
  }
}

export function readActiveClaudeOpenCodeGoBinding({ env = process.env, homedir = os.homedir, claudeHome, ccSwitchHome } = {}) {
  const profile = profileHome({ env, homedir });
  const resolvedClaudeHome = string(claudeHome) || path.join(profile, '.claude');
  const resolvedCcSwitchHome = string(ccSwitchHome) || string(env.CC_SWITCH_HOME) || path.join(profile, '.cc-switch');
  return readProviderState({ ccSwitchHome: resolvedCcSwitchHome, claudeHome: resolvedClaudeHome });
}
