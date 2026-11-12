import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentFace } from '../lib/agent-face.mjs';

test('a shared agent identity always generates the same face', () => {
 const identity='30000000-0000-0000-0000-000000000001';
 assert.deepEqual(agentFace(identity),agentFace(`${identity}`));
});

test('the four seeded role agents have distinct faces', () => {
 const identities=[1,2,3,5].map(number=>`30000000-0000-0000-0000-00000000000${number}`);
 assert.equal(new Set(identities.map(identity=>JSON.stringify(agentFace(identity)))).size,4);
});
