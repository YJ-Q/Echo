import { parse } from 'acorn';

const unwrap = n => n?.type === 'AwaitExpression' ? n.argument : n;
const member = n => n?.type === 'MemberExpression' && !n.computed
  && n.object.type === 'Identifier' ? `${n.object.name}.${n.property.name}` : '';

function literal(n) {
  if (n?.type === 'Literal' && !n.regex && !n.bigint) return n.value;
  if (n?.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis[0].value.cooked;
  if (n?.type === 'UnaryExpression' && n.operator === '-' && typeof literal(n.argument) === 'number') return -literal(n.argument);
  if (n?.type === 'ArrayExpression') return n.elements.map(literal);
  if (n?.type === 'ObjectExpression') {
    const value = Object.create(null);
    for (const p of n.properties) {
      if (p.type !== 'Property' || p.computed || p.method || p.kind !== 'init') throw Error('Dynamic object');
      value[p.key.name ?? p.key.value] = literal(p.value);
    }
    return value;
  }
  throw Error('Nonliteral argument');
}

function tool(n, source) {
  n = unwrap(n);
  const name = member(n?.callee);
  if (n?.type !== 'CallExpression' || !name.startsWith('tools.')) return null;
  let args, unresolved;
  try { args = literal(n.arguments[0]); } catch { unresolved = 'Arguments are dynamic; not evaluated'; }
  return { name: name.slice(6), args, unresolved, codeRange: [n.start, n.end], code: source.slice(n.start, n.end) };
}

// Recognize only emitted, unconditional top-level calls. Never eval/Function/vm.
// Branches, arbitrary callbacks, aliasing and dynamic code are not execution evidence.
export function unwrapExec(source) {
  const slots = [], variables = new Map(), warnings = [];
  let ast;
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); }
  catch (e) { return { slots, warnings: [`JavaScript parse failed at ${e.pos}`], reliable: false }; }
  for (const statement of ast.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const d of statement.declarations) {
        const init = unwrap(d.init);
        if (d.id.type === 'Identifier' && init?.type === 'CallExpression'
          && ['Promise.all', 'Promise.allSettled'].includes(member(init.callee))
          && init.arguments[0]?.type === 'ArrayExpression') {
          const ops = init.arguments[0].elements.map(n => tool(n, source));
          if (ops.every(Boolean)) variables.set(d.id.name, ops);
          else warnings.push('Unsupported parallel expression');
        } else warnings.push('Unsupported variable declaration');
      }
    } else if (statement.type === 'ExpressionStatement') {
      const e = unwrap(statement.expression);
      if (e?.type === 'CallExpression' && e.callee.type === 'Identifier' && e.callee.name === 'text') {
        slots.push(tool(e.arguments[0], source));
      } else if (e?.type === 'CallExpression' && e.callee.type === 'MemberExpression'
        && member(e.callee).endsWith('.forEach') && e.arguments[0]?.name === 'text'
        && variables.has(e.callee.object.name)) slots.push(...variables.get(e.callee.object.name));
      else warnings.push('Unsupported execution/emission shape');
    } else warnings.push(`Unsupported statement ${statement.type}`);
  }
  return { slots, warnings, reliable: warnings.length === 0 };
}

// Parse concatenated JSON values ONLY at the start of tool-emitted text.
function jsonValues(text) {
  const values = [];
  let i = 0;
  while (i < text.length) {
    while (/\s/.test(text[i] || '') && i < text.length) i++;
    if (i === text.length) break;
    if (!['{', '['].includes(text[i])) throw Error('Non-JSON or truncated emitted output');
    const start = i, stack = [];
    let quoted = false, escaped = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) { i++; break; } }
    }
    if (stack.length || quoted) throw Error('Truncated JSON value');
    values.push(JSON.parse(text.slice(start, i)));
  }
  return values;
}

export function decodeOutput(output) {
  const blocks = Array.isArray(output) ? output.filter(x => typeof x.text === 'string').map(x => x.text)
    : [typeof output === 'string' ? output : JSON.stringify(output)];
  const values = [], warnings = [];
  let cellId = null, completed = false;
  for (let block of blocks) {
    if (/^Script (?:completed|running|failed)/.test(block)) {
      const id = block.match(/^Script running with cell ID (\S+)/);
      if (id) cellId = id[1];
      if (/^Script completed/.test(block)) completed = true;
      const start = block.indexOf('Output:\n');
      block = start >= 0 ? block.slice(start + 8) : '';
    }
    if (!block.trim()) continue;
    try { values.push(...jsonValues(block)); }
    catch (e) { warnings.push(e.message); }
  }
  return { values, warnings, cellId, completed };
}

export function patchEdits(patch) {
  const edits = [];
  let current;
  for (const line of patch.split(/\r?\n/)) {
    const m = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (m) { current = { action: m[1].toLowerCase(), path: m[2], added: [], removed: [], context: [] }; edits.push(current); }
    else if (current && line.startsWith('*** Move to: ')) current.moveTo = line.slice(13);
    else if (current && !line.startsWith('***')) {
      if (line.startsWith('+')) current.added.push(line.slice(1));
      else if (line.startsWith('-')) current.removed.push(line.slice(1));
      else if (line.startsWith(' ')) current.context.push(line.slice(1));
    }
  }
  return edits;
}

// A bounded, anchored recognizer; quoted command text inside node -e is not a test run.
export function commandKinds(command) {
  const c = command.trim();
  const test = /^(?:&\s*)?(?:"[^"]*(?:node|npm|pnpm|npx|pytest)[^"]*"|[^\s]*(?:node(?:\.exe)?|npm(?:\.cmd)?|pnpm|npx|pytest))\s+(?:--test(?:\s|$)|(?:run\s+)?test(?:\s|$)|vitest\b|jest\b)/i.test(c)
    || /^(?:pytest|cargo\s+test|go\s+test)(?:\s|$)/i.test(c);
  return { shell: true, test, git: /^(?:git)(?:\s|$)/i.test(c),
    possibleWrite: /(?:Set-Content|Add-Content|Out-File|writeFile(?:Sync)?|\bsed\s+-i\b|\btee\b)/i.test(c) };
}

export function operationOutcome(value, name) {
  if (value?.status === 'fulfilled') value = value.value;
  else if (value?.status === 'rejected') return { status: 'failed', confidence: 'Confirmed', reason: 'Promise rejected', value };
  if (value?.isError === true) return { status: 'failed', confidence: 'Confirmed', reason: 'Explicit tool error', value };
  if (typeof value?.exit_code === 'number') return { status: value.exit_code === 0 ? 'succeeded' : 'failed',
    confidence: 'Confirmed', reason: `exit_code=${value.exit_code}`, value };
  if (value?.session_id !== undefined) return { status: 'running', confidence: 'Confirmed', reason: 'Process handle returned', value };
  if (name === 'apply_patch' && typeof value === 'string' && /^Success\. Updated the following files:/m.test(value))
    return { status: 'succeeded', confidence: 'Confirmed', reason: 'Explicit patch success result', value };
  return { status: 'unknown', confidence: 'Uncertain', reason: 'No explicit success/failure in result', value };
}
