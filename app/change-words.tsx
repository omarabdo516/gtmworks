'use client';
// How a proposed change to an Agent's settings is named (#19; design-reference: chgWhat): its new model, new core
// instructions, sub-agents, a setting's label, or its own key when it has no label; and a value as the card shows it.
// The proposal card in the chat (app/change-card.tsx) and the note in Settings (app/settings-proposal.tsx, #178) both
// name a proposal with these, so one proposal reads the same in both places.
import { useI18n } from '@/lib/i18n-client';
import { useCardText } from '@/app/agent-card';
import { settingLabelKey } from '@/lib/engine-setting-labels.mjs';
import type { ChangeProposalView } from '@/lib/conversations';

type Named = Pick<ChangeProposalView, 'change' | 'setting' | 'value'>;

export function useChangeWords() {
 const { t } = useI18n(); const { c, cb } = useCardText();
 const shown = (value: unknown) => value === true ? c('changeOn') : value === false ? c('changeOff') : String(value ?? '');
 // `unread`: a proposal read in part names what would change and nothing of its value.
 const what = (change: Named, unread = false) => change.change === 'model' ? (unread ? t('settingModel') : cb('changeModel', String(change.value)))
  : change.change === 'instructions' ? c('changeInstructions')
  : change.change === 'toolset' ? (change.setting === 'delegation' ? c('changeSubagents') : <bdi>{change.setting}</bdi>)
  : change.setting && settingLabelKey(change.setting) !== 'settingUnknown' ? t(settingLabelKey(change.setting)) : <bdi>{change.setting}</bdi>;
 return { what, shown };
}
