import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

for (const lang of ["zh", "en"]) {
  test(`${lang} PDF HTML has exactly 18 portfolio pages`, () => {
    const html = fs.readFileSync(
      new URL(`../case-study/pdf/margin-case-study.${lang}.html`, import.meta.url),
      "utf8"
    );
    assert.equal((html.match(/class="pdf-page/g) || []).length, 18);
    assert.match(html, /validation-layers\.svg/);
    assert.match(html, /page-number/);
  });

  test(`${lang} PDF artifact is a non-empty PDF`, () => {
    const pdf = fs.readFileSync(
      new URL(`../case-study/dist/margin-case-study.${lang}.pdf`, import.meta.url)
    );
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(pdf.length > 500_000);
  });

  test(`${lang} generated PDF HTML has no trailing whitespace`, () => {
    const html = fs.readFileSync(
      new URL(`../case-study/pdf/margin-case-study.${lang}.html`, import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(html, /[ \t]+$/m);
  });
}
