import { useSyncExternalStore } from 'react';

// The page a person is opening right now through one of the app's links (a click or Enter, lib/link), by its path, until
// it has landed or the link stops waiting for it. Prefetches never count: only a link the person activated. The frame
// (app/frame.tsx) draws that page's loading frame from the press (#771).
let opening: string | null = null;
const listeners = new Set<() => void>();
export const pageBeingOpened = () => opening;
export function setPageBeingOpened(path: string | null) {
  if (opening === path) return;
  opening = path;
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const usePageBeingOpened = () => useSyncExternalStore(subscribe, pageBeingOpened, () => null);
