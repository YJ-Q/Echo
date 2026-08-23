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

const DEFAULT_RETRIEVAL = Object.freeze({ lexicalWeight: 0.55, semanticWeight: 0.25, confidenceWeight: 0.15, recencyWeight: 0.05 });

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) return 0;
  if ([...left, ...right].some((value) => !Number.isFinite(value))) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

export function rankMemoryRows(rows, { query, asOf, topK, queryVector, embeddingModel, retrievalConfig = DEFAULT_RETRIEVAL }) {
  return rows.map((row) => {
    const overlap = lexicalOverlap(query, row.content);
    const semantic = row.embeddingModel === embeddingModel ? cosineSimilarity(queryVector, row.embeddingVector) : 0;
    const ageDays = Math.max(0, (new Date(asOf) - new Date(row.updated_at)) / 86400000);
    const recencyBucket = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.5 : 0;
    const score = overlap * retrievalConfig.lexicalWeight + semantic * retrievalConfig.semanticWeight +
      row.confidence * retrievalConfig.confidenceWeight + recencyBucket * retrievalConfig.recencyWeight;
    const retrievalReason = overlap > 0 && semantic > 0 ? 'hybrid' : semantic > 0 ? 'semantic' : 'lexical';
    return { row, overlap, semantic, score, retrievalReason };
  }).filter((entry) => entry.overlap > 0 || entry.semantic > 0)
    .sort((a, b) => b.score - a.score || b.row.updated_at.localeCompare(a.row.updated_at) || a.row.id.localeCompare(b.row.id))
    .slice(0, topK)
    .map(({ row, score, retrievalReason }) => ({ ...row, score: Number(score.toFixed(6)), retrievalReason }));
}
