import test from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../scripts/case-study/check-privacy.mjs";

test("privacy scanner catches credentials and local user paths", () => {
  const findings = scanText(
    "sample.txt",
    "OPENAI_API_KEY=secret\nC:\\Users\\Example\\private\nsk-test-secret"
  );

  assert.deepEqual(
    findings.map((finding) => finding.pattern).sort(),
    ["api-key-assignment", "local-user-path", "secret-token"].sort()
  );
});

test("privacy scanner allows public case study terminology", () => {
  assert.deepEqual(
    scanText(
      "safe.md",
      "Margin uses a local provider fallback and anonymized scenarios."
    ),
    []
  );
});
