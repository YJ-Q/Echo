const meaningful = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

// Presentation normalization only: preserve the author's words while making a first prompt
// usable as a one-line title. It deliberately never edits the native session content.
export function normalizeDisplayTitle(value, maxLength = 120) {
  let text = meaningful(value);
  if (!text) return null;
  text = text.replace(/^\s*```(?:[\w-]+)?\s*\r?\n?/, '').replace(/\r?\n?\s*```\s*$/, '');
  text = text.replace(/^\s*\\?#(?:#+)?\s+/, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export function titleDto({ nativeTitle, metadataTitle, firstUserMessage, nativeSessionId }) {
  const native = normalizeDisplayTitle(nativeTitle);
  if (native) return { displayTitle: native, titleSource: 'native' };
  const metadata = normalizeDisplayTitle(metadataTitle);
  if (metadata) return { displayTitle: metadata, titleSource: 'metadata' };
  const first = normalizeDisplayTitle(firstUserMessage);
  if (first) return { displayTitle: first, titleSource: 'first-user-message' };
  return { displayTitle: `Untitled session · ${String(nativeSessionId).slice(0, 8)}`, titleSource: 'fallback-id' };
}
