// Lane colour palettes, including colour-vision-deficiency safe options.
import type { ColorMode } from '../store/settings';

export interface LanePalette { lanes: [string, string, string]; swipe: string; accent: string }

export function laneColorsFor(mode: ColorMode, theme: [string, string, string]): LanePalette {
  switch (mode) {
    case 'classic': return { lanes: ['#29d3ff', '#ff3df0', '#ffe03d'], swipe: '#ffffff', accent: '#ff3df0' };
    case 'deuteranopia':
    case 'protanopia': return { lanes: ['#3b8bff', '#ffb000', '#3b8bff'], swipe: '#ffffff', accent: '#ffb000' };
    case 'tritanopia': return { lanes: ['#ff4d6d', '#2ee6d6', '#ff4d6d'], swipe: '#ffffff', accent: '#2ee6d6' };
    case 'highContrast': return { lanes: ['#ffffff', '#ffe600', '#ffffff'], swipe: '#00e5ff', accent: '#ffe600' };
    case 'theme':
    default: {
      const [c1, , c3] = theme;
      // guarantee readable, bright lane colours even for dark theme colours
      return { lanes: [brighten(c1), brighten(c3), brighten(c1)], swipe: '#ffffff', accent: brighten(c1) };
    }
  }
}

function brighten(hex: string): string {
  const v = parseInt(hex.replace('#', ''), 16);
  let r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum < 110) {
    const k = (110 - lum) / 255 + 0.25;
    r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k);
  }
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
