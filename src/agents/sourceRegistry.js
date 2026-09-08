import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const AGENT_TYPES = ['codex', 'claude', 'pi'];
export const AGENT_CAPABILITIES = Object.freeze(['sessions', 'handoff', 'apiUsage', 'quota', 'executionStatus', 'attentionStatus', 'subscriptionQuota']);
// Margin support, not an assertion about an agent product. Stubs stay false.
const capabilitiesFor = (type) => Object.freeze({
  sessions: true,
  handoff: type === 'codex' || type === 'pi',
  apiUsage: type === 'codex',
  quota: type === 'codex',
  executionStatus: type === 'codex',
  attentionStatus: false,
  // Structured OpenCode Go quota reader, verified live. Still data-driven at read time: the
  // capability is about the source having a verified reader, not about any specific window value.
  // Added only to Pi so Codex/Claude capability objects keep their exact prior shape.
  ...(type === 'pi' ? { subscriptionQuota: true } : {}),
});
const supportFor = (type) => type === 'codex' ? 'Full support' : 'Session discovery';
const cleanPath = (value) => path.resolve(String(value ?? '').trim());
const sourceId = (type, sourcePath) => `${type}-${createHash('sha256').update(`${type}:${sourcePath.toLowerCase()}`).digest('hex').slice(0, 12)}`;

export function registryPath({ env = process.env, homedir = os.homedir } = {}) {
  const profile = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
  return path.join(profile, '.margin', 'agent-sources.json');
}

function normalizeSource(value) {
  const type = typeof value?.agentType === 'string' ? value.agentType : value?.type;
  const rawPath = value?.home ?? value?.path;
  if (!value || !AGENT_TYPES.includes(type) || typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const sourcePath = cleanPath(rawPath);
  const origin = value.origin === 'auto' ? 'auto' : 'manual';
  const id = typeof value.sourceId === 'string' && value.sourceId.trim() ? value.sourceId : (typeof value.id === 'string' ? value.id : sourceId(type, sourcePath));
  return { id, sourceId: id, type, agentType: type,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : `${type === 'codex' ? 'Codex' : type === 'claude' ? 'Claude' : 'Pi'} source`,
    path: sourcePath, home: sourcePath, origin, registration: origin, detected: origin === 'auto', manual: origin === 'manual', enabled: value.enabled !== false,
    capabilities: capabilitiesFor(type), supportLevel: supportFor(type) };
}

export function readAgentSourceRegistry(options = {}) {
  const target = registryPath(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || (parsed.sources !== undefined && !Array.isArray(parsed.sources))) throw new TypeError('invalid_agent_source_registry');
    return { ok: true, version: 1, sources: (parsed.sources ?? []).map(normalizeSource).filter(Boolean) };
  } catch (error) {
    // A profile with no registry is the normal first-run case.  Anything else is
    // deliberately not treated as an empty registry: detection must never overwrite a
    // user's corrupt or temporarily unreadable configuration.
    if (error?.code === 'ENOENT') return { ok: true, version: 1, sources: [] };
    return { ok: false, version: 1, sources: [], error: { code: 'registry_unreadable', message: error?.message ?? 'Unable to read agent source registry' } };
  }
}

export function writeAgentSourceRegistry(registry, options = {}) {
  const target = registryPath(options);
  const sources = (registry?.sources ?? []).map(normalizeSource).filter(Boolean);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Adapter startup performs best-effort detection in every process.  A direct write lets a
  // reader in another test/host observe a truncated JSON document between open/write/close.
  // Write beside the target and publish with one rename so readers see either the old complete
  // registry or the new complete registry, never an intermediate buffer.
  const temporary = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, sources }, null, 2), 'utf8');
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* preserve the original write error */ }
    throw error;
  }
  return { version: 1, sources };
}

export function registerAgentSource(registry, { type, path: sourcePath, name, origin = 'manual', enabled = true }) {
  if (!AGENT_TYPES.includes(type)) throw new TypeError('invalid_agent_type');
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new TypeError('invalid_agent_source_path');
  const normalizedPath = cleanPath(sourcePath);
  const id = sourceId(type, normalizedPath);
  const source = normalizeSource({ id, type, path: normalizedPath, name, origin, enabled });
  const existing = (registry?.sources ?? []).map(normalizeSource).filter(Boolean).find((item) => item.id === id);
  // Detection is additive convenience.  It must not turn a disabled/manual/custom-labelled
  // record into an enabled auto/default record merely because it found the same directory.
  const preserved = origin === 'auto' && existing?.origin === 'manual' ? existing : source;
  const others = (registry?.sources ?? []).map(normalizeSource).filter(Boolean).filter((item) => item.id !== id);
  return { version: 1, sources: [...others, preserved] };
}

export function removeAgentSource(registry, id) {
  return { version: 1, sources: (registry?.sources ?? []).map(normalizeSource).filter((source) => source && source.id !== id) };
}

export function validateSource(source) {
  try { return fs.statSync(source.path).isDirectory() ? { valid: true } : { valid: false, reason: 'Path is not a directory' }; }
  catch { return { valid: false, reason: 'Path does not exist' }; }
}

export function defaultSourcePaths({ env = process.env, homedir = os.homedir } = {}) {
  const profile = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
  return [
    { type: 'codex', path: env.CODEX_HOME?.trim() || path.join(profile, '.codex'), name: 'Codex' },
    { type: 'claude', path: env.CLAUDE_HOME?.trim() || path.join(profile, '.claude'), name: 'Claude' },
    { type: 'pi', path: env.PI_HOME?.trim() || path.join(profile, '.pi'), name: 'Pi' },
  ];
}

// Detection only registers directories that are actually present. It never deletes manual
// choices; an auto record remains a convenience cache for CLI and Electron parity.
export function detectAgentSources(registry, options = {}) {
  let next = registry ?? { version: 1, sources: [] };
  const detected = [];
  for (const candidate of defaultSourcePaths(options)) {
    const source = normalizeSource({ ...candidate, origin: 'auto' });
    if (validateSource(source).valid) { next = registerAgentSource(next, source); detected.push(source); }
  }
  return { registry: next, detected };
}

// Explicit manual registration wins. Otherwise an auto record matching CODEX_HOME wins,
// followed by the normal detected default. This is deliberately shared by all hosts.
export function resolveActiveSource(registry, type, options = {}) {
  const sources = (registry?.sources ?? []).map(normalizeSource).filter((source) => source?.type === type && source.enabled);
  const manual = sources.filter((source) => source.origin === 'manual');
  if (manual.length) return manual[manual.length - 1];
  const envPath = type === 'codex' ? options.env?.CODEX_HOME : type === 'claude' ? options.env?.CLAUDE_HOME : type === 'pi' ? options.env?.PI_HOME : null;
  if (typeof envPath === 'string' && envPath.trim()) {
    const wanted = cleanPath(envPath);
    const match = sources.find((source) => source.path === wanted);
    if (match) return match;
  }
  return sources[sources.length - 1] ?? null;
}
