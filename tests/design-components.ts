import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { Page } from '@playwright/test';

// The components DESIGN.md names, read from the drawn page (#808): each component's front-matter values, resolved for a
// theme and a language, against the computed styles of the element that draws it. Nothing is compared as a picture.

type Design = Record<string, Record<string, unknown>>;
type Typography = { fontFamily: string, fontSize?: string, fontWeight?: string | number, lineHeight?: string | number, letterSpacing?: string };
export type Theme = 'light' | 'dark';
export type Language = 'en' | 'ar';
// A component's values as CSS: background, text colour, radius, padding, height, width, shadow and the font.
export type Expected = Partial<Record<'backgroundColor' | 'color' | 'borderRadius' | 'padding' | 'height' | 'width' | 'boxShadow' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing', string>>;

export const design = load(readFileSync('DESIGN.md', 'utf8').match(/^---\n([\s\S]*?)\n---\n/)![1]) as Design;

/** One front-matter reference ({section.name}) or literal, as its value in a theme; a dark value is the name with -dark. */
const resolve = (value: unknown, theme: Theme): string => String(value).replace(/\{(\w+)\.([\w-]+)\}/g, (_, section: string, name: string) => {
  const found = theme === 'dark' && design[section]?.[`${name}-dark`] !== undefined ? design[section][`${name}-dark`] : design[section]?.[name];
  if (found === undefined) throw new Error(`DESIGN.md has no ${section}.${name}`);
  return resolve(found, theme);
});

/**
 * A component's values in a theme and a language. In Arabic the English sans stack is Vazirmatn's
 * (`var(--font-arabic), sans-serif`, DESIGN.md Typography); the reference's own face is the same in both.
 */
export function expected(name: string, theme: Theme, language: Language): Expected {
  const component = design.components?.[name] as Record<string, unknown> | undefined;
  if (!component) throw new Error(`DESIGN.md names no component ${name}`);
  const values: Expected = {};
  for (const [property, value] of Object.entries(component)) {
    if (property === 'typography') {
      const key = String(value).match(/^\{typography\.([\w-]+)\}$/)?.[1];
      const type = key ? design.typography?.[key] as Typography | undefined : undefined;
      if (!type) throw new Error(`components.${name}.typography names no typography: ${value}`);
      const family = String(type.fontFamily);
      values.fontFamily = language === 'ar' && family === (design.typography.body as Typography | undefined)?.fontFamily ? 'var(--font-arabic), sans-serif' : family;
      if (type.fontSize !== undefined) values.fontSize = String(type.fontSize);
      if (type.fontWeight !== undefined) values.fontWeight = String(type.fontWeight);
      if (type.lineHeight !== undefined) values.lineHeight = String(type.lineHeight);
      if (type.letterSpacing !== undefined) values.letterSpacing = String(type.letterSpacing);
      continue;
    }
    const css = ({ backgroundColor: 'backgroundColor', textColor: 'color', rounded: 'borderRadius', padding: 'padding', height: 'height', shadow: 'boxShadow' } as const)[property as 'backgroundColor'];
    if (property === 'size') { values.width = values.height = resolve(value, theme); continue; }
    if (!css) throw new Error(`components.${name}.${property} is no property the component check reads`);
    values[css] = resolve(value, theme);
  }
  return values;
}

/**
 * Every way the first visible element a selector finds differs from a component's values, one sentence each naming the
 * component and the property. Each value is set on a hidden probe beside the element, so a token or a font stack
 * resolves where the element sits, and the two computed values are compared; colours are compared as painted pixels.
 */
export async function differences(page: Page, component: string, selector: string, values: Expected): Promise<string[]> {
  return page.evaluate(([component, selector, values]) => {
    const element = [...document.querySelectorAll<HTMLElement>(selector)].find(found => found.getClientRects().length);
    if (!element) return [`${component}: nothing on the page draws ${selector}`];
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;border:0 solid transparent;';
    (element.parentElement ?? document.body).append(probe);
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const pixel = (colour: string) => {
      canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = colour; canvas.fillRect(0, 0, 1, 1);
      return [...canvas.getImageData(0, 0, 1, 1).data];
    };
    const drawn = getComputedStyle(element);
    const problems: string[] = [];
    const say = (property: string, want: string, got: string) => problems.push(`${component} (${selector}) ${property}: DESIGN.md says ${want}, the page draws ${got}`);
    try {
      // An em or unitless line height and letter spacing resolve against the element's own size when the type names none.
      probe.style.fontSize = values.fontSize ?? drawn.fontSize;
      for (const [property, value] of Object.entries(values) as [string, string][]) {
        if (property === 'height' || property === 'width') {
          probe.style[property] = value;
          const size = element.getBoundingClientRect()[property], want = parseFloat(getComputedStyle(probe)[property]);
          if (Math.abs(size - want) > 0.5) say(property, `${value} (${want}px)`, `${size}px`);
          continue;
        }
        (probe.style as unknown as Record<string, string>)[property] = value;
        const want = getComputedStyle(probe);
        if (property === 'backgroundColor' || property === 'color') {
          const [a, b] = [pixel(want[property]), pixel(drawn[property])];
          if (a.some((channel, index) => Math.abs(channel - b[index]) > 1)) say(property, `${value} (${want[property]})`, drawn[property]);
        } else if (property === 'borderRadius' || property === 'padding') {
          const sides = property === 'padding' ? ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const : ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'] as const;
          const [a, b] = [sides.map(side => want[side]).join(' '), sides.map(side => drawn[side]).join(' ')];
          if (a !== b) say(property, `${value} (${a})`, b);
        } else {
          const key = property as 'boxShadow';
          if (want[key] !== drawn[key]) say(property, `${value} (${want[key]})`, drawn[key]);
        }
      }
    } finally { probe.remove(); }
    return problems;
  }, [component, selector, values] as const);
}

// Where each component DESIGN.md names is drawn, on the seed at 1440 wide: the page, the element that draws it and, for
// a component whose text is a child (a stat's figure), the element that draws its type. A -hover component is its
// component's element under the pointer; open makes a dialog appear.
export type Placement = { path: string, selector: string, text?: string, hover?: boolean, open?: (page: Page) => Promise<void> };
const board = '/c/rs-learning/work/board';
export const placements: Record<string, Placement> = {
  button: { path: '/c/rs-learning/settings/members', selector: 'main button[name="op"][value="update"]' },
  'button-hover': { path: '/c/rs-learning/settings/members', selector: 'main button[name="op"][value="update"]', hover: true },
  'button-primary': { path: '/c/rs-learning/projects', selector: 'main button.primary' },
  'button-toolbar-primary': { path: board, selector: 'main [data-toolbar-primary]' },
  input: { path: '/c/rs-learning/projects', selector: 'main input:not([type=hidden]):not([type=checkbox])' },
  panel: { path: '/c/rs-learning/usage', selector: 'main section.panel' },
  'board-card': { path: board, selector: 'main .kcard' },
  'nav-item': { path: '/c/rs-learning/home', selector: '.sb-item:not([aria-current])' },
  'nav-item-hover': { path: '/c/rs-learning/home', selector: '.sb-item:not([aria-current])', hover: true },
  'nav-group-label': { path: '/c/rs-learning/home', selector: '.sb-label' },
  'column-title': { path: board, selector: 'main .col:not(:has(.dot--waiting)) .col__name' },
  'table-header': { path: '/c/rs-learning/work/list', selector: 'main .table th' },
  'label-chip': { path: `${board}/1`, selector: 'main .label-chip' },
  avatar: { path: '/c/rs-learning/agents', selector: 'main .avatar' },
  stat: { path: '/c/rs-learning/home', selector: 'main .stat', text: 'main .stat strong:not(.unavailable)' },
  dialog: { path: '/c/rs-learning/home', selector: '.gw.modal', open: async page => { await page.locator('.sb-add').first().click(); } },
};
const typeProperties = new Set(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']);
/** A component's values split between its element and the element that draws its text. */
export const split = (placement: Placement, values: Expected): [string, Expected][] => {
  if (!placement.text) return [[placement.selector, values]];
  const box = Object.fromEntries(Object.entries(values).filter(([property]) => !typeProperties.has(property)));
  const type = Object.fromEntries(Object.entries(values).filter(([property]) => typeProperties.has(property)));
  return [[placement.selector, box], [placement.text, type]];
};
