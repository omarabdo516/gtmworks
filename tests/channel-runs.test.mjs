import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postChannelMessage } from '../lib/channel-runs.mjs';

// #338: the database decides who may post (supabase/tests/channels.sql); the run layer turns its refusal into the
// route's answer and drives no Run for it.
test('a post the database refuses is answered as not allowed or not found, and starts no Run', async () => {
  const calls = [];
  const refusing = code => ({ rpc: async name => { calls.push(name); return { error: { code } }; } });
  const driven = [];
  const service = { rpc: async name => { driven.push(name); return { data: [] }; } };
  const post = code => postChannelMessage(refusing(code), service, { channel: 'c', sendKey: 'k', message: '@Faye hello', encryptionKey: undefined });
  assert.deepEqual(await post('42501'), { refused: 'channelNotAllowed', status: 403 });
  assert.deepEqual(await post('P0002'), { refused: 'channelNotFound', status: 404 });
  assert.deepEqual(await post('22023'), { refused: 'channelFailed', status: 400 });
  assert.deepEqual(calls, ['post_channel_message', 'post_channel_message', 'post_channel_message']);
  assert.deepEqual(driven, [], 'no Run is driven for a refused post');
});
