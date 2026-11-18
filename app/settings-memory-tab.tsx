'use client';
import { useI18n } from '@/lib/i18n-client';
import { holdLeave } from './settings-draft';

// The Memory tab is not built yet; drawn, disabled, saying Soon. Pressed while the draft differs it keeps the page, as
// every way out does (design-reference: sovDirty), and gives the save bar its nudge.
export function MemoryTab({label,soon}:{label:string,soon:string}) {
 const {t}=useI18n();
 return <button type="button" role="tab" id="sov-tab-memory" aria-selected="false" aria-disabled="true" tabIndex={-1} title={soon}
  onClick={()=>{ holdLeave(t('settingsSaveFirst')); }}>{label}</button>;
}
