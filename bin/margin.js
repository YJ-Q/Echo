#!/usr/bin/env node
// Margin CLI V1 entry — wires the real handoff Core into the interactive runner.
// npm link / package install exposes this as the `margin` command.
import { discoverSessions, captureSession, generateHandoff } from '../src/core/handoff/index.js';
import { createPrompter, runMarginCli } from '../src/cli/margin/index.js';

const prompter = createPrompter({ input: process.stdin, output: process.stdout });

const exitCode = await runMarginCli({
  discoverSessions: () => discoverSessions(),
  captureSession,
  generateHandoff,
  prompt: (text) => prompter.ask(text),
  stdout: process.stdout,
  stderr: process.stderr,
});

prompter.close();
process.exitCode = exitCode;
