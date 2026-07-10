# Margin Interaction Directions

Date: 2026-07-10

Status: Direction A selected on 2026-07-10

## Shared Motion Rules

Every direction should feel like something happening on paper rather than a generic application transition.

- Use motion to reveal continuity, not to reward clicks.
- Keep movement small: generally within 2-6 px.
- Use `120ms` for direct feedback, `220ms` for settling, and `320-420ms` for a deliberate trace.
- Avoid infinite pulsing, bouncing, confetti, elastic easing, and large page-flip effects.
- Respect `prefers-reduced-motion` and keep every state understandable without animation.
- Do not animate the raster notebook shell itself unless its visual layers are first separated.

## Direction A - Ink Appears

The interface behaves as if fresh ink is being added to an existing page.

- New conversation paragraphs fade in with a 3 px rise and a short line-by-line stagger.
- The active learning dot fills once while its vertical thread draws to the next node.
- Switching sections briefly softens the old writing, then reveals the new writing from top to bottom.
- The selected paper tab darkens and shifts 2 px toward the page.

Strengths:

- Closest to the Margin ink-and-trace language.
- Works well with text-heavy content.
- Can be implemented without splitting the generated notebook image.

Risks:

- Too much stagger would slow down reading.
- Repeated ink reveals must be limited to genuinely new content.

## Direction B - Paper Settles

The interface emphasizes the physical notebook and the feeling of placing or turning a sheet.

- Section changes use a subtle 4 px lateral drift, tiny rotation, and shadow settle.
- Notes enter as if placed on the page, then lose their lifted shadow.
- The ribbon can make one small settling movement when the window first opens.
- Tabs compress slightly on press before returning to their paper shape.

Strengths:

- Most tactile and visually noticeable.
- Reinforces the desktop-object quality of the application.

Risks:

- The notebook material is one raster image, so strong page movement can expose the illusion.
- More motion and shadow work increases visual and rendering cost.

## Direction C - The Line Returns

The interface treats lines, underlines, and timeline threads as the main carrier of continuity.

- On section change, a hairline briefly extends from the selected tab toward the page content.
- Returning to a learning line retraces only the current segment and settles on the active dot.
- A remembered phrase receives one quiet highlight sweep rather than moving the whole paragraph.
- Sending a message extends the input underline, then releases it as the new response appears.

Strengths:

- Most semantically connected to Margin's idea of keeping the live line visible.
- Quiet, accessible, and unlikely to compete with reading.
- Lowest risk with the current raster notebook shell.

Risks:

- Less immediately noticeable than paper motion.
- Requires careful line placement to avoid looking decorative.

## Decision

Direction A, Ink Appears, is the selected interaction language. New writing, current learning nodes, section content, and tab emphasis should use restrained ink-like reveals.

Direction B should remain limited to material settling where a real independent paper layer exists. Direction C is retained as a reference, but line motion must not become an additional competing interaction system.
