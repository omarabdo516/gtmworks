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
let flashes = 0;
const listeners = new Set<() => void>();
let saveButton: HTMLElement | null = null;
let firstField: HTMLElement | null = null;

const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const differs = () => !!state && Object.keys(state.saved).some(key => state!.saved[key] !== state!.draft[key]);
const same = (a: Values, b: Values) => Object.keys(a).every(key => a[key] === b[key]) && Object.keys(b).every(key => a[key] === b[key]);
const noChanges: Values = {};
let changedCache: { state: DraftState, values: Values } | null = null;

// The page's fields seed the draft with what the server read, once per Agent. Coming back to the same Agent keeps what
// is saved; a new Agent (or a read that changed under no edit) starts from the new values. Each field seeds its own keys,
// so the fields that come next (#162's voice) join this draft instead of replacing what another field seeded.
/** @param {string} agent @param {Values} values */
export function seedDraft(agent: string, values: Values) {
 if (state && state.agent === agent) {
  const saved = { ...state.saved, ...values };
  // A field added while another is unsaved joins with its read value, and the person's own edits stay.
  const draft = differs() ? { ...values, ...state.draft } : { ...saved };
  if (same(state.saved, saved) && same(state.draft, draft)) return;
  state = { agent, saved, draft };
  emit();
  return;
 }
 state = { agent, saved: { ...values }, draft: { ...values } };
 emit();
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
 emit();
 firstField?.focus();
}

/** The Engine kept these fields: only the ones the save named, as the save sent only what changed. */
/** @param {Values} kept */
export function commitPatch(kept: Values) {
 if (!state) return;
 state = { agent: state.agent, saved: { ...state.saved, ...kept }, draft: { ...state.draft, ...kept } };
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
export function useBarFlash() { return useSyncExternalStore(subscribe, () => flashes, () => 0); }
/** The fields whose draft differs from what was saved, with the draft's value: what a save sends. */
export function useDraftChanges(agent: string) {
 return useSyncExternalStore(subscribe, () => {
  if (!state || state.agent !== agent) return noChanges;
  if (changedCache?.state !== state) {
   /** @type {Values} */
   const values: Values = {};
   for (const key of Object.keys(state.draft)) if (state.draft[key] !== state.saved[key]) values[key] = state.draft[key];
   changedCache = { state, values };
  }
  return changedCache.values;
 }, () => noChanges);
}
/** @param {string} agent @param {string} field @param {string} fallback */
export function useDraftValue(agent: string, field: string, fallback: string) {
 return useSyncExternalStore(subscribe, () => state?.agent === agent ? state.draft[field] ?? fallback : fallback, () => fallback);
}
