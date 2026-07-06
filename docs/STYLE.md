# Echo Desktop Style Guide

This guide defines the visual direction for Echo's desktop MVP.

The chosen direction is the light-dominant grayscale variant: a quiet white main canvas, black navigation rail, gray structure, and cool blue active states. It keeps a slight retro digital feeling through dotted texture, thin borders, compact controls, and precise spacing, but the product should remain readable and calm for daily use.

## Design Principles

- Echo should feel like a focused desktop companion, not a chatbot window.
- Follow Apple-style interface discipline: clear hierarchy, strong alignment, restrained surfaces, native-feeling controls, and generous breathing room around important content.
- The interface should make the next small action obvious without becoming a task manager.
- Use contrast, spacing, hierarchy, and motion instead of decoration.
- Keep the visual system mostly black, white, and gray, with blue reserved for active, selected, or actionable states.
- Prefer dense but breathable layouts over large hero-style surfaces. Detail belongs in secondary panels, not in the first visual layer.
- The UI should feel stable, quiet, and long-lived.
- Use native UI primitives as the base layer wherever possible, then apply Echo styling through tokens.
- Do not use emoji in the interface. When a symbol is needed, use an icon from the approved icon library.

## Visual Direction

Echo should combine three qualities:

- Apple-like structure: balanced layout, careful spacing, precise alignment, and readable typography.
- Desktop productivity clarity: information density is useful, but the page must never feel crowded.
- Subtle digital memory texture: dotted surfaces, mono metadata, and thin dividers are accents, not the main event.

The visual priority is:

1. Readability
2. Clear next action
3. Spatial balance
4. Direct visual signals
5. Quiet personality
6. Decorative texture

## Information Density

Echo should not explain everything with text. Prefer compact visual instruments supported by short labels.

Rules:

- Each status panel should contain one primary visual signal and one short explanatory line.
- Replace repeated descriptive text with bars, waveforms, step segments, counters, or compact grids.
- Keep body copy short. A panel should rarely need more than two text lines after its title.
- Use text to clarify state meaning, not to duplicate what the visual already shows.
- The right workspace should feel like an instrument panel, not a report.
- Conversation text may stay natural, but status panels should be concise and highly scannable.

## Layout

Desktop uses a fixed three-column structure:

- Left navigation rail
- Center Echo conversation stream
- Right status workspace

Recommended desktop frame:

- Minimum width: `1280px`
- Ideal width: `1440px` to `1728px`
- Minimum height: `800px`

Column sizing:

- Left navigation: `72px` collapsed, `220px` expanded if labels are needed
- Center conversation: flexible, minimum `560px`
- Right workspace: `340px` to `400px`
- Outer app padding: `16px`
- Column gap: `12px`

The center conversation area owns the visual focus. The right workspace should feel persistent and useful, but secondary.

Composition rules:

- Align all major columns to the same top and bottom edges.
- Keep the center column visually calmer than the side panels; the conversation should not fight the right workspace.
- Use progressive disclosure: show the current state and next action first, then expose memory, profile, and event details on expansion.
- Avoid filling every available area. Leave quiet space around the current Echo response and the next action.
- Major panels should form a clear vertical rhythm; avoid staggered, uneven panel heights unless the content requires it.

## Color Palette

Use a restrained grayscale base with one blue accent family.

### Core

```css
--color-black: #050608;
--color-ink: #111318;
--color-graphite: #242832;
--color-gray-900: #1c1f26;
--color-gray-700: #4b5565;
--color-gray-500: #7d8594;
--color-gray-300: #c9ced8;
--color-gray-200: #e5e8ee;
--color-gray-100: #f2f4f7;
--color-white: #ffffff;
```

### Blue Accent

```css
--color-blue: #2563eb;
--color-blue-hover: #1d4ed8;
--color-blue-soft: #dbeafe;
--color-blue-line: #93c5fd;
--color-blue-ink: #0f3d91;
```

### State Signal Colors

State colors should stay within the black, white, gray, and blue system. Different states are represented by blue intensity, gray contrast, rhythm, amplitude, and line style rather than unrelated hues.

```css
--state-quiet: #7d8594;
--state-focused: #2563eb;
--state-motivated: #1d4ed8;
--state-anxious: #0f3d91;
--state-distracted: #4b5565;
--state-neutral: #9ca3af;
```

Rules:

- Avoid green/yellow/red emotion palettes in the core UI.
- Anxious states may use sharper, higher-frequency blue waveforms instead of warning colors.
- Quiet or neutral states should use lower-contrast gray-blue lines.
- Distracted states should use broken or irregular gray-blue rhythm, not a new color family.

### Semantic

```css
--surface-app: #f2f4f7;
--surface-main: #ffffff;
--surface-subtle: #f8fafc;
--surface-inverse: #050608;
--border-subtle: #e5e8ee;
--border-strong: #c9ced8;
--text-primary: #111318;
--text-secondary: #4b5565;
--text-muted: #7d8594;
--text-inverse: #ffffff;
--accent: #2563eb;
```

Avoid purple, beige, orange, green, and decorative gradients.

## Typography

Use a system-first sans serif for readability, with an optional monospace layer for small metadata and retro digital details.

Primary font stack:

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  Inter,
  "SF Pro Display",
  "Segoe UI",
  "PingFang SC",
  "Microsoft YaHei",
  sans-serif;
```

Monospace font stack:

```css
font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;
```

Type scale:

- App title: `24px / 32px`, weight `650`
- Page title: `20px / 28px`, weight `650`
- Section title: `14px / 20px`, weight `650`
- Body: `14px / 22px`, weight `400`
- Small body: `13px / 20px`, weight `400`
- Metadata: `11px / 16px`, weight `500`, monospace optional
- Button: `13px / 18px`, weight `600`

Rules:

- Do not scale font size with viewport width.
- Letter spacing should be `0` for normal text.
- Use uppercase only for tiny metadata labels.
- Do not use oversized display text inside panels.
- Prefer Apple-like typographic restraint: fewer sizes, clearer weights, and consistent line height.
- Chinese text should use the same hierarchy as English text; do not compensate with larger sizes.

## Spacing

Use a 4px token base, composed into an Apple-like 8px layout rhythm.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
```

Recommended spacing:

- App shell padding: `16px`
- Primary panel padding: `20px`
- Standard panel padding: `16px`
- Compact panel padding: `12px`
- Gap between major columns: `12px`
- Gap between stacked panels: `12px`
- Gap between form controls: `8px`
- Conversation message vertical gap: `14px`
- Section header to content gap: `10px`
- Page title to first section gap: `16px`
- Dense metadata rows: `6px` to `8px`

Spacing rules:

- Important content needs more space around it than secondary metadata.
- Avoid equal visual weight everywhere. The page should have primary, secondary, and tertiary zones.
- If a panel has more than three dense rows, add either grouping, dividers, or collapse behavior.

## Radius

Echo should feel precise, not bubbly.

```css
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
```

Usage:

- Buttons: `6px`
- Inputs: `6px`
- Panels: `8px`
- Small chips: `4px`
- Avoid radii above `8px` unless a platform shell requires it.

## Borders And Shadows

Prefer borders over heavy shadows.

```css
--border-width: 1px;
--shadow-subtle: 0 1px 2px rgba(17, 19, 24, 0.06);
--shadow-panel: 0 12px 30px rgba(17, 19, 24, 0.08);
```

Rules:

- Main panels use `1px` solid borders.
- Use shadows only to separate floating overlays, popovers, and modals.
- Avoid glowing blue shadows except for rare focused states.

## Texture

The D variant uses a subtle dotted digital texture.

Recommended texture:

```css
.dotted-surface {
  background-image: radial-gradient(rgba(37, 99, 235, 0.13) 1px, transparent 1px);
  background-size: 16px 16px;
}
```

Rules:

- Use dotted texture only on large background surfaces or quiet empty states.
- Do not place texture behind dense body text.
- Keep opacity low enough that the interface remains clean.
- Texture is optional. If it competes with Apple-like clarity, remove it.

## Component Foundation

Use native UI as the foundation layer.

Preferred approach:

- Start with native HTML controls for inputs, buttons, text areas, dialogs, menus, and form states.
- Use a headless/native-oriented component library only when it improves accessibility and keyboard behavior.
- Recommended options: Radix UI, Ariakit, React Aria, or shadcn/ui built on Radix primitives.
- Keep Echo's visual styling in design tokens, not hard-coded per component.

Rules:

- Do not replace standard controls with custom canvas or decorative widgets.
- Menus, popovers, dialogs, tabs, switches, checkboxes, and tooltips must support keyboard navigation.
- Native focus behavior must remain visible and consistent.
- Platform conventions should win over novelty when there is a conflict.

## Icons

Do not use emoji anywhere in the UI.

Approved icon approach:

- Use `lucide-react` as the default icon library.
- Use icon-only buttons for common actions such as send, complete, dismiss, settings, search, collapse, expand, and refresh.
- Use text labels beside icons when the action is not immediately obvious.
- Use tooltips for icon-only controls.

Icon sizing:

- Navigation icon: `20px`
- Inline icon: `16px`
- Button icon: `16px` to `18px`
- Status icon: `14px` to `16px`

Rules:

- Icons inherit current text color unless the state requires blue.
- Do not use multi-color icons.
- Do not use icons as decoration when they do not clarify meaning.

## Left Navigation

The navigation rail should be black and compact.

Structure:

- Echo mark at the top
- Primary icons: Echo, Learn, Actions, Reflections
- Secondary controls near bottom: settings, theme, connection status

Colors:

- Background: `--color-black`
- Inactive icon/text: `#9ca3af`
- Active item: white text/icon on blue accent or blue left indicator
- Hover: `rgba(255,255,255,0.08)`

Interaction:

- Icon buttons should be `40px` square.
- Active state must be visually clear.
- Use tooltips for icon-only controls.

## Center Conversation

The center column is the primary workspace.

Sections:

- Top status header
- Conversation stream
- Input composer

Conversation message style:

- User messages: right-aligned or clearly marked, white/gray surface
- Echo messages: left-aligned, slightly stronger structure, calm text block
- Metadata row: emotion, intent, tags, timestamp

Composer:

- Fixed at bottom of center column
- Text input height: `44px` minimum
- Send button: icon button with blue active state
- Quick actions above or beside input: `Done`, `Stuck`, `Continue`, `Plan today`

Do not make chat bubbles overly rounded or playful.

## Right Status Workspace

The right panel explains where we are and what to do next.

Recommended stack:

1. Current State
2. Next Action
3. Learning Line
4. Action Queue
5. Memory / Reflection preview

Panel style:

- White or subtle gray surface
- Thin border
- Small title row
- Clear primary value
- Compact metadata

The Next Action panel is the strongest visual element on the right side. It may use a blue top border, blue action button, or blue selected state.

Right workspace text limits:

- Current State: state name, heartbeat visual, one sentence maximum.
- Focus: focus name, progress bar, percent or step count.
- Next Action: action title, one short detail, one primary button.
- Learning Line: topic, segmented progress, current step label.
- Memory: item count, compact grid or sparkline, optional disclosure action.

## State Visualizations

Echo's state system should use lightweight, animated visual instruments. These are part of the product identity and are not decorative charts.

### Heartbeat State

Use a heartbeat waveform in the Current State panel to represent the user's emotional/contextual state.

Structure:

- Left side: state label, such as `Quiet`, `Focused`, `Motivated`, `Anxious`, or `Distracted`.
- Right side: animated heartbeat waveform.
- Bottom or adjacent line: one short status explanation.

Recommended dimensions:

- Panel height: `88px` to `104px`
- Waveform width: `72px` to `120px`
- Waveform height: `24px` to `40px`
- Stroke width: `1.5px` to `2px`

State mapping:

- `Quiet`: low amplitude, slow frequency, soft gray-blue line.
- `Focused`: medium amplitude, steady frequency, clear blue line.
- `Motivated`: slightly higher amplitude, steady forward rhythm, stronger blue.
- `Anxious`: sharp peaks, higher frequency, darker blue, slightly tighter spacing.
- `Distracted`: irregular broken rhythm, lower contrast, interrupted segments.
- `Neutral`: flat or near-flat pulse with muted gray.

Animation rules:

- Animate the waveform with a subtle left-to-right draw or pulse.
- Loop duration should range from `1.4s` to `3.2s` depending on state.
- Keep motion small; the waveform should feel alive, not alarming.
- Respect reduced motion by showing a static waveform.
- Do not use red, warning flashes, glow storms, or medical-device realism.

Implementation notes:

- Prefer SVG or canvas for the waveform.
- Use Framer Motion or CSS stroke-dash animation.
- Keep waveform data deterministic per state so the UI feels stable.

### Focus Progress

Use a visual progress bar in the Focus panel to show the current execution line.

Structure:

- Focus title, such as `JavaScript basics` or `Report + Meeting Prep`.
- Horizontal progress bar.
- Percent, step count, or remaining unit aligned to the right.

Recommended dimensions:

- Bar height: `8px`
- Track color: `--color-gray-200`
- Fill color: `--color-blue`
- Radius: `4px`
- Width: full panel minus label area

Rules:

- The progress bar should be visible without reading the text.
- If the focus is uncertain, show an indeterminate blue-gray shimmer bar.
- If there are multiple focus signals, show only the active one and hide secondary details behind disclosure.
- Do not add long explanations under the bar.

### Learning Segments

Learning Line should use segmented progress rather than paragraphs.

Structure:

- Topic title.
- Step count, such as `Step 3 of 6`.
- Segmented progress row.
- Current step name.

Rules:

- Done segments: blue.
- Current segment: blue with stronger border or subtle pulse.
- Pending segments: light gray.
- Keep each segment fixed width so state changes do not shift layout.

### Memory Grid

Memory should use a compact grid, density strip, or small sparkline to represent accumulated memories.

Rules:

- Use small square cells in gray and blue.
- Blue cells can indicate recently active or relevant memories.
- Show count text, such as `56 items`, but avoid listing memory content in the primary panel.
- Detailed memory content belongs in an expanded view or a dedicated Memory page.

## Components

### Buttons

Primary:

```css
background: #2563eb;
color: #ffffff;
border: 1px solid #2563eb;
border-radius: 6px;
```

Secondary:

```css
background: #ffffff;
color: #111318;
border: 1px solid #c9ced8;
border-radius: 6px;
```

Ghost:

```css
background: transparent;
color: #4b5565;
border: 1px solid transparent;
```

Rules:

- Use icons for common actions where possible.
- Text buttons are acceptable for clear commands such as `Start`, `Done`, `Dismiss`.
- Button height should be `32px` or `36px`.
- Primary actions should be visually obvious, but only one primary action should appear in a local panel.
- Follow native desktop expectations for hover, pressed, disabled, and focus states.

### Chips

Use chips for emotion, tags, intent, and status.

- Height: `24px`
- Radius: `4px`
- Padding: `0 8px`
- Font: `11px` or `12px`
- Active chip may use blue soft background.

### Inputs

- Height: `40px` to `44px`
- Border: `1px solid --border-strong`
- Focus border: blue
- Background: white
- Placeholder: muted gray

### Progress / Steps

Learning steps should look like a compact vertical sequence.

- Current step: blue indicator
- Done step: dark check or filled neutral mark
- Pending step: gray border
- Step rows should not resize when state changes.
- Prefer segmented progress over long step descriptions in compact panels.
- The full step description should appear only after expansion or in the center conversation flow.

### Data-Lite Instruments

Use data-lite instruments before full charts.

Preferred instruments:

- Heartbeat waveform for current emotional/contextual state.
- Horizontal progress bar for focus.
- Segmented bar for learning progress.
- Compact square grid for memory density.
- Tiny sparkline for recent reflection or activity rhythm.

Rules:

- Instruments should be readable at a glance without legends.
- Every instrument needs a short text label nearby for accessibility.
- Use tooltips or expanded panels for detailed data.
- Do not make instruments look like financial dashboards or medical monitors.

### Charts

Charts are optional and should appear only when they clarify memory, emotion, action, or learning patterns.

Approved chart libraries:

- Recharts for standard React charts.
- Nivo when richer responsive charts are needed.
- Apache ECharts when advanced interaction or dense data is required.

Chart rules:

- Use grayscale as the base and blue as the main highlight.
- Do not introduce extra categorical colors unless the data absolutely requires comparison.
- Charts should be visually secondary to the current state and next action.
- Keep chart panels balanced with neighboring content; avoid one oversized chart that dominates the workspace.
- Use concise labels, direct legends, and readable tooltips.
- Prefer simple trend lines, compact bars, and small multiples over complex dashboards.
- Empty chart states should use skeletons or a short neutral message.

## States

Loading:

- Use skeleton rows or quiet pulsing gray blocks.
- Avoid large spinners.
- Skeleton screens are preferred for initial page load, state panels, conversation history, learning steps, and action queues.
- Skeletons should match final layout dimensions to prevent layout shift.

Empty:

- Use one concise prompt.
- Optional subtle dotted background.

Error:

- Use neutral error copy.
- Red is allowed only for destructive or blocking errors; avoid making red part of the core palette.

Offline / disconnected:

- Use gray status by default.
- Use blue only when connected or actively syncing.

## Motion

Motion should be minimal, purposeful, and native-feeling.

- Hover transition: `120ms ease`
- Panel/content transition: `160ms ease`
- Avoid bouncy easing.
- Do not animate background texture.

Approved animation approach:

- CSS transitions for simple hover, focus, and active states.
- Framer Motion for panel entrance, list reordering, disclosure sections, and subtle layout transitions.
- AutoAnimate may be used for simple list transitions when Framer Motion would be too heavy.

Motion rules:

- Use animation to clarify continuity, not to entertain.
- Keep most transitions between `120ms` and `220ms`.
- Ambient state animations may be slower, usually `1.4s` to `3.2s`.
- Respect reduced motion preferences.
- Avoid springy, playful, or elastic motion.
- Avoid long page-level animations on app start.
- Heartbeat and progress animations should pause when their panel is not visible.

## Accessibility

- Body text contrast should meet WCAG AA.
- Interactive targets should be at least `32px` high, preferably `40px`.
- Focus states must be visible with a blue outline or border.
- Do not rely on color alone for status; include icon, label, or shape.
- Native semantics should be preserved for buttons, inputs, lists, tabs, and dialogs.
- Tooltips cannot be the only way to understand a critical action.

## Content Tone

UI labels should be short and direct.

Preferred labels:

- Echo
- Now
- Current state
- Next action
- Learning line
- Memory
- Reflections
- Continue
- Done
- Stuck
- Dismiss

Avoid:

- Marketing copy
- Long onboarding explanations
- Generic assistant phrasing
- Overly motivational text
- Emoji

## Do Not

- Do not use purple, beige, orange, green, or colorful gradients.
- Do not create a hero landing page.
- Do not use large rounded cards.
- Do not nest cards inside cards.
- Do not make the UI look like a social feed.
- Do not turn the right panel into a data-heavy analytics dashboard.
- Do not hide the next action behind navigation.
- Do not let decorative texture reduce readability.
- Do not use emoji as icons, labels, empty states, or decorative markers.
- Do not build custom controls when native or accessible headless primitives cover the use case.
- Do not introduce charts without a clear user decision or reflection benefit.
