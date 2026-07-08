function clampConfidence(value) {
  const normalized = Number.isFinite(value) ? value : 0.5;
  return Math.min(Math.max(normalized, 0.1), 1);
}

export function mergeProfileSignal(existing, incoming) {
  const incomingConfidence = clampConfidence(incoming?.confidence);

  if (!existing) {
    return {
      value: incoming.value,
      confidence: incomingConfidence
    };
  }

  const existingConfidence = clampConfidence(existing.confidence);

  if (incoming?.force && existing.value !== incoming.value) {
    return {
      value: incoming.value,
      confidence: incomingConfidence
    };
  }

  if (existing.value === incoming.value) {
    return {
      value: existing.value,
      confidence: clampConfidence(Math.max(existingConfidence, incomingConfidence) + 0.08)
    };
  }

  const incomingMuchLower = incomingConfidence <= existingConfidence - 0.2;
  const existingHighlyTrusted = existingConfidence >= 0.85 && incomingConfidence < existingConfidence;
  const incomingStrongEnough = incomingConfidence >= existingConfidence + 0.15;
  const incomingOverrideStrength = incomingConfidence >= 0.92;

  if (incomingMuchLower || existingHighlyTrusted) {
    return {
      value: existing.value,
      confidence: existingConfidence
    };
  }

  if (incomingStrongEnough || incomingOverrideStrength) {
    return {
      value: incoming.value,
      confidence: incomingConfidence
    };
  }

  return {
    value: existing.value,
    confidence: existingConfidence
  };
}

export { clampConfidence };
