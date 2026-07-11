import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssPath = new URL("../frontend/src/index.css", import.meta.url);

test("three-page visual system keeps the approved paper tokens", async () => {
  const css = await readFile(cssPath, "utf8");
  for (const token of [
    "--ink: #34312c",
    "--muted-ink: #746d63",
    "--paper: #f8f4ea",
    "--paper-deep: #eee7d9",
    "--paper-edge: #d8cfbf",
    "--accent: #9a7442",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("shared paper components and focused workspaces have stable style hooks", async () => {
  const css = await readFile(cssPath, "utf8");
  for (const className of ["paper-note", "conversation-annotations", "growth-workspace", "trace-workspace"]) {
    assert.match(css, new RegExp(`\\.${className}\\b`));
  }
  assert.match(css, /html\[data-motion="reduced"\]/);
});

test("homepage annotations reuse the vellum already painted into the notebook shell", async () => {
  const css = await readFile(cssPath, "utf8");
  assert.match(css, /\.outline-page\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.outline-page::before\s*\{[^}]*content:\s*none;/s);
});
