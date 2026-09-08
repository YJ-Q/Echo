import fs from 'node:fs';
import path from 'node:path';

const MAX_MARKDOWN_BYTES = 1_000_000;

// Shared persistence boundary for CLI and HTTP. The returned path is only
// reported after the exact UTF-8 payload was read back from the target.
export function saveHandoffArtifact({ repo, markdown }) {
  if (typeof repo !== 'string' || !repo.trim()) throw new TypeError('invalid_handoff_repo');
  if (typeof markdown !== 'string' || !markdown.trim()) throw new TypeError('invalid_handoff_markdown');
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) throw new RangeError('handoff_markdown_too_large');
  if (!fs.statSync(repo).isDirectory()) throw new TypeError('invalid_handoff_repo');

  const dir = path.join(repo, '.margin');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'HANDOFF.md');
  fs.writeFileSync(filePath, markdown, 'utf8');
  if (!fs.statSync(filePath).isFile() || fs.readFileSync(filePath, 'utf8') !== markdown) {
    throw new Error('Handoff write could not be verified');
  }
  return filePath;
}
