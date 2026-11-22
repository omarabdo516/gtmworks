// The letter an app's or provider's tile shows when it has no logo (#577): one rule for every tile, the first letter of
// its name, uppercase; a name with no letter shows a dot.
/** @param {string} name */
export const markOf=name=>Array.from(name.trim())[0]?.toUpperCase()||'·';
