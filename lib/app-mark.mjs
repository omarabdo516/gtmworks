// The letter an app's or provider's tile shows when it has no logo (#577): one rule for every tile, the first letter of
// its name, uppercase; a name with no letter shows a dot.
/** @param {string} name */
export const markOf=name=>Array.from(name.trim())[0]?.toUpperCase()||'·';

// The mark of a model choice (design-reference: MODELS' logo): its maker's, also when another provider serves it, so the
// chat's "+" menu and an Agent's model choice draw the same mark for one model (#158, #620).
/** @type {[RegExp,string][]} */
const makers=[[/^(anthropic|claude)/,'claude'],[/^(openai|gpt|o\d)/,'openai'],[/^(google|gemini)/,'gemini']];
/** @param {{provider:string,model:string}} choice */
export const modelMarkOf=({provider,model})=>makers.find(([pattern])=>pattern.test(provider)||pattern.test(model))?.[1]??provider;
