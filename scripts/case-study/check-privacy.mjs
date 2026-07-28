import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATTERNS = [
  {
    name: "api-key-assignment",
    regex: /\b(?:OPENAI|ANTHROPIC|SILICONFLOW)_API_KEY\s*=\s*\S+/gi
  },
  {
    name: "secret-token",
    regex: /\bsk-[A-Za-z0-9_-]{8,}\b/g
  },
  {
    name: "local-user-path",
    regex: /\b[A-Za-z]:\\Users\\[^\\\s]+\\/gi
  },
  {
    name: "private-key",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  }
];

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".svg"
]);

export function scanText(file, text) {
  return PATTERNS.flatMap(({ name, regex }) => {
    regex.lastIndex = 0;
    return regex.test(text) ? [{ file, pattern: name }] : [];
  });
}

export function scanTextFiles(rootDir) {
  const findings = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["dist", ".tmp"].includes(entry.name)) {
          walk(full);
        }
      } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        findings.push(...scanText(full, fs.readFileSync(full, "utf8")));
      }
    }
  };

  walk(rootDir);
  return findings;
}

const invoked =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (invoked) {
  const target = path.resolve(process.argv[2] || "case-study");
  const findings = scanTextFiles(target);

  if (findings.length) {
    console.error(JSON.stringify(findings, null, 2));
    process.exitCode = 1;
  } else {
    console.log("Case Study privacy scan passed.");
  }
}
