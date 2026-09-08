import { createElement } from 'react';

// Inline SVG icon set for the Margin surface.
// All icons: 14×14px rendered, 24×24 viewBox, 1.5px stroke, currentColor.
// No external icon library — paths sourced from Lucide (MIT).

function svgAttrs() {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    className: 'margin-icon',
  };
}

export function IconChevronDown() {
  return createElement('svg', svgAttrs(),
    createElement('polyline', { points: '6 9 12 15 18 9' }));
}

export function IconChevronUp() {
  return createElement('svg', svgAttrs(),
    createElement('polyline', { points: '18 15 12 9 6 15' }));
}

export function IconPin() {
  return createElement('svg', svgAttrs(),
    createElement('line', { x1: '12', y1: '17', x2: '12', y2: '22' }),
    createElement('path', { d: 'M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z' }));
}

export function IconMinus() {
  return createElement('svg', svgAttrs(),
    createElement('line', { x1: '5', y1: '12', x2: '19', y2: '12' }));
}

export function IconX() {
  return createElement('svg', svgAttrs(),
    createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
    createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' }));
}

export function IconGear() {
  return createElement('svg', svgAttrs(),
    createElement('circle', { cx: '12', cy: '12', r: '3' }),
    createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }));
}
