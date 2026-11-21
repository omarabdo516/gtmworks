'use client';
// How a proposed change to an Agent's settings is named (#19, #484; design-reference: chgWhat): its new model, new core
// instructions, sub-agents, a setting's label, or its own key when it has no label; and a value as the card shows it.
// The proposal card in the chat (app/change-card.tsx), its board card in "Waiting on you" and the note in Settings
// (app/settings-proposal.tsx, #178) all name a proposal with these, so one proposal reads the same in every place.
import { useI18n } from '@/lib/i18n-client';
import { useCardText } from '@/app/agent-card';
import { settingLabelKey } from '@/lib/engine-setting-labels.mjs';
import type { ChangeProposalView } from '@/lib/conversations';

type Named = Pick<ChangeProposalView, 'change' | 'setting' | 'value'>;
// A model as the Agent's profile's Engine lists it (lib/engine-settings.mjs readModels).
export type ModelChoice = { provider: string, providerName: string, model: string };

// A model travels as "provider/model" (lib/engine-settings.mjs). The card names it by the model the Engine lists and its
// provider by the name the Engine gives it, where the Engine lists that model; otherwise by the parts of its id.
export function modelParts(value: unknown) {
 const text = String(value ?? ''); const slash = text.indexOf('/');
 const provider = slash > 0 ? text.slice(0, slash) : ''; const model = slash > 0 ? text.slice(slash + 1) : text;
 const listed = (choices: ModelChoice[]) => choices.find(choice => choice.provider === provider && choice.model === model);
 return { provider, model, providerName: (choices: ModelChoice[]) => listed(choices)?.providerName || provider };
}

export function useChangeWords() {
 const { t } = useI18n(); const { c, cb } = useCardText();
 const shown = (value: unknown) => value === true ? c('changeOn') : value === false ? c('changeOff') : String(value ?? '');
 const model = (value: unknown) => <bdi dir="ltr">{modelParts(value).model}</bdi>;
 const label = (setting: string | null) => setting && settingLabelKey(setting) !== 'settingUnknown' ? t(settingLabelKey(setting)) : <bdi>{setting}</bdi>;
 // `unread`: a proposal read in part names what would change and nothing of its value.
 const what = (change: Named, unread = false) => change.change === 'model' ? (unread ? t('settingModel') : cb('changeModel', model(change.value)))
  : change.change === 'instructions' ? c('changeInstructions')
  : change.change === 'toolset' ? (change.setting === 'delegation' ? c('changeSubagents') : <bdi>{change.setting}</bdi>)
  : label(change.setting);
 // The board card's title in "Waiting on you" (design-reference: the c-chg-* cards' titles): the change as a question.
 const question = (change: Named & { agent: string }, unread = false) => unread ? cb('changeBoardAny', change.agent)
  : change.change === 'model' ? cb('changeBoardModel', change.agent, model(change.value))
  : change.change === 'instructions' ? cb('changeBoardInstructions', change.agent)
  : change.change === 'toolset' && change.setting === 'delegation' ? cb(change.value === false ? 'changeBoardSubagentsOff' : 'changeBoardSubagentsOn', change.agent)
  : cb('changeBoardSetting', label(change.setting), change.agent, shown(change.value));
 return { what, shown, model, question };
}
