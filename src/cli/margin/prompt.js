// Minimal readline/promises wrapper. The only interaction the CLI needs is a
// line prompt that cleanly cancels when the user presses Ctrl+C (SIGINT) or the
// input stream ends (EOF), so the runner can emit a clear exit instead of
// hanging. No TUI, no third-party dependency.

import { createInterface } from 'node:readline/promises';

// Returned (not thrown) when the user aborts or the stream closes mid-prompt.
export const CANCELLED = Symbol('margin.cli.cancelled');

export function createPrompter({ input, output }) {
  const rl = createInterface({ input, output, terminal: Boolean(input?.isTTY) });
  // readline emits SIGINT for a terminal Ctrl+C; closing the interface then
  // fires `close`, which aborts any pending question below.
  rl.on('SIGINT', () => { rl.close(); });

  return Object.freeze({
    async ask(text) {
      const controller = new AbortController();
      const onClose = () => controller.abort();
      rl.once('close', onClose);
      try {
        const answer = await rl.question(text, { signal: controller.signal });
        return answer;
      } catch (error) {
        if (error?.name === 'AbortError') return CANCELLED;
        throw error;
      } finally {
        rl.off('close', onClose);
      }
    },
    close() { rl.close(); },
  });
}
