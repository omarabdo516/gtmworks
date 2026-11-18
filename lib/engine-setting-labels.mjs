// The label of each Engine setting on gtmworks's list (#125), as a message key in both catalogues. Kept apart from the
// list and the Engine driver so the Activity log, which the browser draws, can name a setting without loading the
// driver (lib/engine-settings.mjs keeps the list and the calls).
export const settingLabels=Object.freeze({
 model:'settingModel',
 'delegation.model':'settingSubagentModel',
 'delegation.provider':'settingSubagentProvider',
 'delegation.max_concurrent_children':'settingSubagentLimit',
 'delegation.reasoning_effort':'settingSubagentEffort',
 'delegation.max_spawn_depth':'settingSubagentDepth',
 'memory.memory_enabled':'settingMemoryOn',
 'memory.memory_char_limit':'settingMemorySize',
 'memory.write_approval':'settingMemoryApproval',
 'skills.write_approval':'settingSkillsApproval',
 'display.personality':'settingPersonality',
 timezone:'settingTimezone',
 'agent.reasoning_effort':'settingReasoningEffort',
 'tts.speed':'settingVoiceSpeed',
 'stt.language':'settingSpeechLanguage',
});

/** @param {unknown} key */
export const settingLabelKey=key=>typeof key==='string'&&Object.hasOwn(settingLabels,key)?settingLabels[key]:'settingUnknown';
