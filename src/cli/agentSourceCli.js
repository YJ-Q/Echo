import { readAgentSourceRegistry, writeAgentSourceRegistry, detectAgentSources, registerAgentSource, removeAgentSource, validateSource, registryPath, defaultSourcePaths } from '../agents/sourceRegistry.js';
import { resolveActiveSource } from '../agents/sourceRegistry.js';

const write = (stream, text) => stream.write(`${text}\n`);
export function runAgentSourceCli(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const options = { env };
  const loadRegistry = () => {
    const registry = readAgentSourceRegistry(options);
    if (registry?.ok === false) throw new Error(registry.error?.message ?? 'Unable to read agent source registry');
    return registry;
  };
  const command = argv[0];
  if (command === 'list') {
    let registry; try { registry = loadRegistry(); } catch (error) { write(stderr, `Error: ${error.message}`); return 1; }
    if (!registry.sources.length) { write(stdout, 'No agent sources registered. Run: margin agent detect'); return 0; }
    for (const source of registry.sources) {
      const active = resolveActiveSource(registry, source.agentType, options)?.sourceId === source.sourceId ? ' active' : '';
      const validation = validateSource(source).valid ? '' : ' (path unavailable)';
      const supported = Object.entries(source.capabilities ?? {}).filter(([, enabled]) => enabled).map(([name]) => name).join(',') || 'none';
      write(stdout, `${source.sourceId}\t${source.agentType}\t${source.name}\t${source.home}\t${source.origin}\t${source.enabled ? 'enabled' : 'disabled'}\tcapabilities:${supported}${active}${validation}`);
    }
    return 0;
  }
  if (command === 'detect') {
    let result; try { result = detectAgentSources(loadRegistry(), options); writeAgentSourceRegistry(result.registry, options); } catch (error) { write(stderr, `Error: ${error.message}`); return 1; }
    if (!result.detected.length) write(stdout, 'No supported Agent sources found');
    else result.detected.forEach((source) => write(stdout, `Detected ${source.agentType}: ${source.home}`));
    return 0;
  }
  if (command === 'add') {
    const type = argv[1]; const pathIndex = argv.indexOf('--path');
    const sourcePath = pathIndex >= 0 ? argv[pathIndex + 1] : defaultSourcePaths(options).find((candidate) => candidate.type === type)?.path;
    if (!type || !sourcePath) { write(stderr, 'Usage: margin agent add <type> [--path <home>]'); return 1; }
    try {
      const next = registerAgentSource(loadRegistry(), { type, path: sourcePath, origin: 'manual' });
      const source = next.sources.at(-1); writeAgentSourceRegistry(next, options);
      write(stdout, `Registered ${source.agentType}: ${source.sourceId}`);
      return 0;
    } catch (error) { write(stderr, `Error: ${error.message}`); return 1; }
  }
  if (command === 'remove') {
    let current; try { current = loadRegistry(); } catch (error) { write(stderr, `Error: ${error.message}`); return 1; }
    const id = argv[1];
    const source = current.sources.find((item) => item.id === id);
    if (!source) { write(stderr, 'Error: source not found'); return 1; }
    if (source.origin !== 'manual') { write(stderr, 'Error: only manual sources can be removed'); return 1; }
    writeAgentSourceRegistry(removeAgentSource(current, id), options); write(stdout, `Removed ${id}`); return 0;
  }
  write(stderr, 'Usage: margin agent <list|detect|add|remove>');
  return 1;
}

export { registryPath };
