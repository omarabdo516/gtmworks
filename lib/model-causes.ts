// A Run's recorded end that a retry cannot fix (#422, #457, #530): the Company has no model at all (`noModel`), or its
// model call was refused for no credit (`noCredit`), a refused key or sign-in (`keyRefused`), or a model the provider
// does not have (`modelMissing`). A Conversation, a channel and a Card note read it from the outcome their Run, or their
// handover's leg, closed with (lib/engine.mjs `endOf`), and say what to fix instead of that the reply failed.
export type ModelCause='noModel'|'noCredit'|'keyRefused'|'modelMissing';
const causes:Record<string,ModelCause>={no_model:'noModel',no_credit:'noCredit',key_refused:'keyRefused',model_missing:'modelMissing'};
export const modelCauseOf=(outcome:string|null|undefined):ModelCause|null=>outcome&&Object.hasOwn(causes,outcome)?causes[outcome]:null;
export const isModelCause=(value:string):value is ModelCause=>Object.values(causes).includes(value as ModelCause);
