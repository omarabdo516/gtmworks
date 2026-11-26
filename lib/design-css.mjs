import { designTokens } from './design-tokens.mjs';

// The design system's values for HTML the server writes itself, outside the app's stylesheets (the Owner's Engine
// dashboard's refusal page and its way back, #869, #871): each read from lib/design-tokens.mjs, DESIGN.md's front matter,
// by its token's name, so no such page carries a value of its own (#808).

/** @param {Record<string,unknown>} section @param {string} name @param {string} what */
function valueOf(section,name,what) {
 const value=section[name];
 if(value===undefined) throw new Error(`DESIGN.md has no ${what} ${name}`);
 return String(value);
}

/** A colour in light and dark: its light value and its `-dark` one, of which the page's colour scheme picks one.
 * @param {string} name */
export function colour(name) {
 const light=valueOf(designTokens.colors,name,'colour'), dark=designTokens.colors[`${name}-dark`];
 return dark===undefined?light:`light-dark(${light}, ${dark})`;
}
/** A radius. @param {string} name */
export const radius=name=>valueOf(designTokens.rounded,name,'radius');
/** A step of the spacing scale. @param {string} name */
export const space=name=>valueOf(designTokens.spacing,name,'spacing step');
/** A shadow, in light (a shadow with a `-dark` value is for the app's own scopes). @param {string} name */
export const shadow=name=>valueOf(designTokens.shadows,name,'shadow');
/** A font size of the type scale (a `gw-fs-*` entry). @param {string} name */
export const fontSize=name=>valueOf(designTokens.typography[name]??{},'fontSize','font size');
/** A font weight of the type scale (a `gw-fw-*` entry). @param {string} name */
export const fontWeight=name=>valueOf(designTokens.typography[name]??{},'fontWeight','font weight');
