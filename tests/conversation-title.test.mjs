import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTitle } from '../lib/conversation-title.mjs';

const t = (key, ...values) => key === 'goodMorningTitle' ? `Good morning · ${values[0]}` : key;

// One rule names a Conversation in the sidebar, its own page's head and All conversations (#155, #183, #673).
test('a Conversation is named by its first line, else its first file, else its Agent, and a morning\'s by its day', () => {
  assert.equal(conversationTitle({ body: 'Plan the launch\nwith numbers', file: 'brief.png', agent: 'Lead' }, t, 'en'), 'Plan the launch');
  assert.equal(conversationTitle({ body: '', file: 'brief.png', agent: 'Lead' }, t, 'en'), 'brief.png');
  assert.equal(conversationTitle({ body: null, file: null, agent: 'Lead' }, t, 'en'), 'Lead');
  assert.equal(conversationTitle({ morningDay: '2026-11-11', body: 'Hi', agent: 'Lead' }, t, 'en'), 'Good morning · Wed, Nov 11');
});
