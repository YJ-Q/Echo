const CLASSIFICATIONS = new Set([
  "Implemented",
  "Scenario-validated",
  "Hypothesis"
]);

export function parseEvidenceMap(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*[EH]\d{3}\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const [id, claim, classification, sourceCell, sectionCell] = cells;
      if (!CLASSIFICATIONS.has(classification)) {
        throw new Error(`Invalid classification for ${id}: ${classification}`);
      }
      return {
        id,
        claim,
        classification,
        sources: sourceCell.split("<br>").map((value) => value.trim()).filter(Boolean),
        sections: sectionCell.split(",").map((value) => value.trim()).filter(Boolean)
      };
    });
}

export function parseCaseStudy(markdown) {
  const sectionIds = [...markdown.matchAll(/<!--\s*section:([a-z0-9-]+)\s*-->/g)]
    .map((match) => match[1]);
  const evidenceIds = [...markdown.matchAll(/<!--\s*evidence:([EH]\d{3}(?:\s*,\s*[EH]\d{3})*)\s*-->/g)]
    .flatMap((match) => match[1].split(",").map((value) => value.trim()));
  return { sectionIds, evidenceIds };
}

export function validateEvidenceRefs(documentText, evidenceRows) {
  const known = new Set(evidenceRows.map((row) => row.id));
  return [...new Set(parseCaseStudy(documentText).evidenceIds)]
    .filter((id) => !known.has(id))
    .map((id) => `Unknown evidence id: ${id}`);
}

export function validateSectionParity(zhText, enText) {
  const zh = parseCaseStudy(zhText).sectionIds;
  const en = parseCaseStudy(enText).sectionIds;
  return JSON.stringify(zh) === JSON.stringify(en)
    ? []
    : [`Section mismatch: zh=${zh.join(",")} en=${en.join(",")}`];
}
