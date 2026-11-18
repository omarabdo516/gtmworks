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

// The page's fields seed the draft with what the server read, once per Agent. Coming back to the same Agent keeps what
// is saved; a new Agent (or a read that changed under no edit) starts from the new values.
/** @param {string} agent @param {Values} values */
export function seedDraft(agent: string, values: Values) {
 if (state && state.agent === agent) {
  if (!differs() && !same(state.saved, values)) { state = { agent, saved: { ...values }, draft: { ...values } }; emit(); }
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

/** The Engine holds these values now: they are what was saved, and nothing is unsaved. */
/** @param {Values} saved */
export function commitDraft(saved: Values) {
 if (!state) return;
 state = { agent: state.agent, saved: { ...saved }, draft: { ...saved } };
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
/** @param {string} agent @param {string} field @param {string} fallback */
export function useDraftValue(agent: string, field: string, fallback: string) {
 return useSyncExternalStore(subscribe, () => state?.agent === agent ? state.draft[field] ?? fallback : fallback, () => fallback);
}
