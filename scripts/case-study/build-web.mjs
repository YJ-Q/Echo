import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseEvidenceMap,
  parseCaseStudy,
  validateEvidenceRefs,
  validateSectionParity
} from "./lib/content-contract.mjs";
import { renderMarkdown } from "./lib/markdown-renderer.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const contentDir = path.join(root, "case-study/content");
const outputPath = path.join(root, "case-study/web/content.generated.js");
const requiredSections = [
  "overview", "unmet", "reframe", "evolution", "principles",
  "loop", "mvp", "system", "experience", "validation"
];

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error("Missing front matter");
  const meta = Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 1) throw new Error(`Invalid front matter line: ${line}`);
        return [
          line.slice(0, separator).trim(),
          stripQuotes(line.slice(separator + 1))
        ];
      })
  );
  for (const key of ["title", "subtitle", "role", "stage", "year"]) {
    if (!meta[key]) throw new Error(`Missing front matter key: ${key}`);
  }
  return { meta, body: markdown.slice(match[0].length) };
}

export function buildLanguageDocument(markdown) {
  const { meta, body } = parseFrontMatter(markdown);
  const markers = [...body.matchAll(/<!--\s*section:([a-z0-9-]+)\s*-->/g)];
  const sections = markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? body.length;
    const source = body.slice(start, end).trim();
    const evidenceIds = [...source.matchAll(
      /<!--\s*evidence:([EH]\d{3}(?:\s*,\s*[EH]\d{3})*)\s*-->/g
    )].flatMap((match) => match[1].split(",").map((value) => value.trim()));
    return {
      id: marker[1],
      html: renderMarkdown(source),
      evidenceIds: [...new Set(evidenceIds)]
    };
  });
  return { meta, sections };
}

function read(name) {
  return fs.readFileSync(path.join(contentDir, name), "utf8");
}

export function buildAllContent() {
  const zhText = read("case-study.zh.md");
  const enText = read("case-study.en.md");
  const evidence = parseEvidenceMap(read("evidence-map.md"));
  const errors = [
    ...validateSectionParity(zhText, enText),
    ...validateEvidenceRefs(zhText, evidence),
    ...validateEvidenceRefs(enText, evidence)
  ];

  for (const [lang, text] of [["zh", zhText], ["en", enText]]) {
    const actual = parseCaseStudy(text).sectionIds;
    if (JSON.stringify(actual) !== JSON.stringify(requiredSections)) {
      errors.push(`${lang} sections must be ${requiredSections.join(",")}; got ${actual.join(",")}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    zh: buildLanguageDocument(zhText),
    en: buildLanguageDocument(enText)
  };
}

export function writeWebContent() {
  const caseStudyContent = buildAllContent();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    `globalThis.caseStudyContent = ${JSON.stringify(caseStudyContent, null, 2)};\n`,
    "utf8"
  );
  console.log(`Built ${path.relative(root, outputPath)}`);
}

const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) writeWebContent();
