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

const REQUIRED_JOB_SECTIONS = [
  "简历项目描述",
  "60 秒项目介绍",
  "5 分钟面试讲述稿",
  "高频追问与回答",
  "投递链接组合"
];

const FORBIDDEN_PORTFOLIO_CLAIMS = [
  /用户(?:留存率|满意度)\s*(?:为|达到|提升)/i,
  /(?:retention|satisfaction)\s+(?:reached|increased|improved)/i,
  /(?:我们团队|带领团队|our team|led (?:a|the) team)/i,
  /[“"][^”"\n]{4,}[”"]\s*(?:——|—|--?)\s*(?:用户|受访者|user|participant)/i,
  /(?:用户)?(?:留存率|满意度|转化率|付费率)\s*(?:为|达到|提升|增长)?\s*\d+(?:\.\d+)?%?/i,
  /(?:retention|satisfaction|conversion|paid conversion)\s*(?:rate)?\s*(?:was|reached|increased|improved)?\s*\d+(?:\.\d+)?%?/i,
  /(?:商业收入|营收|GMV|revenue|ARR|MRR)\s*(?:为|达到|增长|was|reached|increased)?\s*[\d一二三四五六七八九十百千万]+/i
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateRecruiterSummary(summary, evidenceRows) {
  const errors = [];
  const resources = summary?.resources;
  const knownEvidence = new Set(evidenceRows.map((row) => row.id));

  if (resources?.fullCaseAnchor !== "overview") {
    errors.push("Recruiter fullCaseAnchor must be overview");
  }
  if (resources?.pdf?.zh !== "../dist/margin-case-study.zh.pdf") {
    errors.push("Recruiter Chinese PDF path is invalid");
  }
  if (resources?.pdf?.en !== "../dist/margin-case-study.en.pdf") {
    errors.push("Recruiter English PDF path is invalid");
  }
  if (resources?.github !== "https://github.com/YJ-Q/Echo") {
    errors.push("Recruiter GitHub URL is invalid");
  }

  for (const lang of ["zh", "en"]) {
    const quickRead = summary?.[lang]?.quickRead;
    if (!quickRead) {
      errors.push(`Missing recruiter language: ${lang}`);
      continue;
    }
    for (const key of ["label", "title", "summary"]) {
      if (!isNonEmptyString(quickRead[key])) {
        errors.push(`Missing recruiter field: ${lang}.quickRead.${key}`);
      }
    }
    if (!isNonEmptyString(quickRead.problem?.title)
      || !isNonEmptyString(quickRead.problem?.body)) {
      errors.push(`Missing recruiter problem: ${lang}`);
    }
    if (!Array.isArray(quickRead.decisions)
      || quickRead.decisions.length !== 3) {
      errors.push(`Recruiter decisions must contain 3 items: ${lang}`);
    } else {
      for (const decision of quickRead.decisions) {
        if (!isNonEmptyString(decision.title)
          || !isNonEmptyString(decision.body)) {
          errors.push(`Invalid recruiter decision copy: ${lang}`);
        }
        if (!Array.isArray(decision.evidenceIds)
          || decision.evidenceIds.length === 0) {
          errors.push(`Recruiter decision evidence must be a non-empty array: ${lang}`);
        } else {
          for (const id of decision.evidenceIds) {
            if (!isNonEmptyString(id) || !knownEvidence.has(id)) {
              errors.push(`Unknown recruiter evidence id: ${id}`);
            }
          }
        }
      }
    }
    if (!isNonEmptyString(quickRead.delivery?.title)
      || !isNonEmptyString(quickRead.delivery?.body)
      || !Array.isArray(quickRead.delivery?.items)
      || quickRead.delivery.items.length < 4) {
      errors.push(`Invalid recruiter delivery: ${lang}`);
    }
    const evidence = quickRead.evidence;
    for (const key of [
      "title",
      "body",
      "implemented",
      "scenarioValidated",
      "hypothesis"
    ]) {
      if (!isNonEmptyString(evidence?.[key])) {
        errors.push(`Missing recruiter evidence field: ${lang}.${key}`);
      }
    }
  }

  const serialized = JSON.stringify(summary);
  if (FORBIDDEN_PORTFOLIO_CLAIMS.some((pattern) => pattern.test(serialized))) {
    errors.push("Forbidden portfolio claim in recruiter summary");
  }

  return [...new Set(errors)];
}

export function validateJobApplication(markdown) {
  const errors = [];
  for (const section of REQUIRED_JOB_SECTIONS) {
    if (!markdown.includes(`## ${section}`)) {
      errors.push(`Missing job application section: ${section}`);
    }
  }
  const questions = [...markdown.matchAll(/^### Q\d+\./gm)];
  if (questions.length !== 8) {
    errors.push(`Job application must contain 8 questions; got ${questions.length}`);
  }
  if (FORBIDDEN_PORTFOLIO_CLAIMS.some((pattern) => pattern.test(markdown))) {
    errors.push("Forbidden portfolio claim in job application");
  }
  return errors;
}
