'use client';
import { useSyncExternalStore } from 'react';
import { toast } from './toast';

// One draft for the Agent page in Settings (#161), shared by its fields and its save bar: every field the page edits is
// one key here, so a later field joins the same draft, the same bar and the same way out. The fields seed it with what
// the server read; the bar compares it with what was saved and is hidden until they differ. Nothing leaves the page
// while they differ: every way out asks this store first.
type Values = Record<string, string>;
type DraftState = { agent: string, saved: Values, draft: Values };

let state: DraftState | null = null;
// A save answers the draft it started from: the generation moves whenever another Agent is seeded, the server reads a new
// value, or Cancel puts the saved values back, so a late answer to an older draft is ignored rather than drawn.
let generation = 0;
let flashes = 0;
const listeners = new Set<() => void>();
let saveButton: HTMLElement | null = null;
let firstField: HTMLElement | null = null;

const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// A key only the draft holds (a voice picked where none was saved) is a change too.
const keysOf = (current: DraftState) => [...new Set([...Object.keys(current.saved), ...Object.keys(current.draft)])];
const differs = () => !!state && keysOf(state).some(key => state!.saved[key] !== state!.draft[key]);

// The page's fields seed the draft with what the server read, once per Agent, each section with its own keys only: a
// field that arrives later never wipes what another read, and coming back to the same Agent keeps what is saved. A key
// the reader has edited keeps the draft; a new value from the server is what Cancel goes back to.
/** @param {string} agent @param {Values} values */
export function seedDraft(agent: string, values: Values) {
 if (!state || state.agent !== agent) {
  state = { agent, saved: { ...values }, draft: { ...values } };
  generation += 1;
  emit();
  return;
 }
 const saved = { ...state.saved, ...values };
 const draft = { ...state.draft };
 let changed = false;
 let added = false;
 for (const key of Object.keys(values)) {
  // A key the draft never held (a section drawn later, such as Good morning's, #182) joins it as saved: no request in
  // flight carried it, so a save's answer still belongs to the draft and is not dropped.
  if (!Object.prototype.hasOwnProperty.call(state.saved, key) && !Object.prototype.hasOwnProperty.call(state.draft, key)) { draft[key] = values[key]; added = true; continue; }
  if (state.saved[key] === state.draft[key] && state.draft[key] !== values[key]) { draft[key] = values[key]; changed = true; }
  if (state.saved[key] !== values[key]) changed = true;
 }
 if (changed) generation += 1;
 if (changed || added) { state = { agent, saved, draft }; emit(); }
}

// The fields whose draft differs from what was saved, as the one object the save bar sends.
/** @param {string} agent @returns {Values} */
export function changedValues(agent: string) {
 const current = state;
 if (!current || current.agent !== agent) return {};
 return Object.fromEntries(keysOf(current).filter(key => current.saved[key] !== current.draft[key]).map(key => [key, current.draft[key]]));
}

/** @param {string} field @param {string} value */
export function setDraftValue(field: string, value: string) {
 if (!state) return;
 state = { ...state, draft: { ...state.draft, [field]: value } };
 emit();
}

/** Back to the values last saved, and the focus on the first field the page edits. */
export function restoreDraft() {
 if (!state) return;
 state = { ...state, draft: { ...state.saved } };
 generation += 1;
 emit();
 firstField?.focus();
}

// The Agent and the draft generation a request starts from. A request's answer is applied only while this still names the
// draft on screen: another Agent's page, a newer read or Cancel moves it on.
/** @param {string} agent @returns {{agent:string,generation:number}|null} */
export function draftStamp(agent: string) {
 return state?.agent === agent ? { agent, generation } : null;
}
/** @param {{agent:string,generation:number}|null} stamp */
export function isCurrentDraft(stamp: {agent:string,generation:number}|null) {
 return !!stamp && !!state && state.agent === stamp.agent && generation === stamp.generation;
}

// The Engine holds these values now: they are what was saved, and the submitted fields nothing changed since are unsaved
// no more. A field the person edited while the save waited keeps that edit and the bar stays; `sent` is the snapshot the
// request carried, so only a field whose draft still equals it takes the read-back. A response to a draft that moved on
// (a stamp that is no longer current) changes nothing.
/** @param {Values} saved @param {Values} [sent] @param {{agent:string,generation:number}|null} [stamp] */
export function commitDraft(saved: Values, sent: Values = {}, stamp: {agent:string,generation:number}|null = state ? { agent: state.agent, generation } : null) {
 if (!state || !isCurrentDraft(stamp)) return;
 const draft = { ...state.draft };
 for (const [key, value] of Object.entries(saved)) {
  if (!Object.prototype.hasOwnProperty.call(sent, key) || state.draft[key] === sent[key]) draft[key] = value;
 }
 state = { agent: state.agent, saved: { ...state.saved, ...saved }, draft };
 emit();
}

/** @param {HTMLElement|null} element */
export function registerSave(element: HTMLElement | null) { saveButton = element; }
/** @param {HTMLElement|null} element */
export function registerFirstField(element: HTMLElement | null) { firstField = element; }

// Every way out of the page asks this first. A draft that differs keeps the page, flashes the bar (a counter, so the
// same flash runs again) and puts the focus on Save, with the nudge.
/** @param {string} nudge @returns {boolean} true when the page stays */
export function holdLeave(nudge: string) {
 if (!differs()) return false;
 flashes += 1;
 emit();
 saveButton?.focus();
 toast(nudge);
 return true;
}

export function useDraftDirty(agent: string) { return useSyncExternalStore(subscribe, () => state?.agent === agent && differs(), () => false); }
// The whole draft for this Agent, the saved values beside it: the bar sends every key that differs in one request.
export function useDraftState(agent: string) { return useSyncExternalStore(subscribe, () => state?.agent === agent ? state : null, () => null); }
export function useBarFlash() { return useSyncExternalStore(subscribe, () => flashes, () => 0); }
/** @param {string} agent @param {string} field @param {string} fallback */
export function useDraftValue(agent: string, field: string, fallback: string) {
 return useSyncExternalStore(subscribe, () => state?.agent === agent ? state.draft[field] ?? fallback : fallback, () => fallback);
}
