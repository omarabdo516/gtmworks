// An Agent's thinking level (#179), as the Engine's own source states it: `hermes_constants.py` 1073 accepts
// `minimal`…`ultra` and treats `none` (also `false`/`disabled`) as thinking off, so the eight choices are `none` plus
// those seven. A profile with no value reads as `medium` (#179). The four the reference words keep its words and the line
// under the control (design-reference/app.js 198-203); the other four show the level's name and no line. Labels are
// message keys in both catalogues, never the raw config value.
export const effortLevels=Object.freeze(['none','minimal','low','medium','high','xhigh','max','ultra']);
/** The level an absent value reads as (the page's own reading, #179). */
export const effortDefault='medium';
const labels={none:'settingsEffortNone',minimal:'settingsEffortMinimal',low:'settingsEffortLow',medium:'settingsEffortMedium',
 high:'settingsEffortHigh',xhigh:'settingsEffortXhigh',max:'settingsEffortMax',ultra:'settingsEffortUltra'};
const hints={low:'settingsEffortLowHint',medium:'settingsEffortMediumHint',high:'settingsEffortHighHint',max:'settingsEffortMaxHint'};
/** @param {unknown} level */
export const effortLabelKey=level=>typeof level==='string'&&Object.hasOwn(labels,level)?labels[level]:'settingsEffortUnknown';
/** The line under the control: only the four the reference words have one. @param {unknown} level */
export const effortHintKey=level=>typeof level==='string'&&Object.hasOwn(hints,level)?hints[level]:null;
/** The value as one of the Engine's own levels, or null when it is none of them. @param {unknown} value */
export const knownEffort=value=>typeof value==='string'&&effortLevels.includes(value)?value:null;
