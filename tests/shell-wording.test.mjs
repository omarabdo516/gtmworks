import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ar = JSON.parse(readFileSync('lib/messages/ar.json', 'utf8'));
const en = JSON.parse(readFileSync('lib/messages/en.json', 'utf8'));

// The empty states and notes of the new shell and the Agent Conversation speak the reference's Egyptian Arabic
// (PRODUCT.md).
const emptyStates = ['conversationNoAgent', 'noChatsYet', 'agentEmptyChat', 'viewOnly', 'viewOnlyLead', 'nothingWaitingOnYou', 'conversationRunLost', 'conversationReplyFailed'];
// Modern Standard Arabic forms the reference never uses in its interface.
const standard = /(^|[\s،.])(لم|لن|ليس|لا يوجد|يستطيع|يمكنك|يمكن|هذه|هذا|بهذه|بهذا|أي)(?=[\s،.]|$)|يُ/;

test('the shell and Conversation empty states are worded in Egyptian Arabic, in both catalogues', () => {
 for (const key of emptyStates) {
  assert.ok(en[key], `${key}: missing in English`);
  assert.ok(ar[key], `${key}: missing in Arabic`);
  assert.doesNotMatch(ar[key], standard, `${key}: "${ar[key]}" is not Egyptian`);
 }
});
