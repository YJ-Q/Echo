export function buildLexicalFeatures(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLowerCase();
  const features = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (const size of [2, 3]) {
      for (let index = 0; index <= run.length - size; index += 1) {
        features.add(run.slice(index, index + size));
      }
    }
  }
  return features;
}

function lexicalOverlap(query, content) {
  const queryFeatures = buildLexicalFeatures(query);
  const contentFeatures = buildLexicalFeatures(content);
  if (queryFeatures.size === 0) return 0;
  let matches = 0;
  for (const feature of queryFeatures) if (contentFeatures.has(feature)) matches += 1;
  return matches / queryFeatures.size;
}

export function rankMemoryRows(rows, { query, asOf, topK }) {
  return rows.map((row) => {
    const overlap = lexicalOverlap(query, row.content);
    const ageDays = Math.max(0, (new Date(asOf) - new Date(row.updated_at)) / 86400000);
    const recencyBucket = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.5 : 0;
    return { row, overlap, score: overlap * 0.6 + row.confidence * 0.3 + recencyBucket * 0.1 };
  }).filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at) || a.row.id.localeCompare(b.row.id))
    .slice(0, topK)
    .map(({ row, score }) => ({ ...row, score: Number(score.toFixed(6)), retrievalReason: 'lexical' }));
}
