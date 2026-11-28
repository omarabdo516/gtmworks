import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteeName } from '../lib/invitee-name.mjs';

// #185, kept by #953: an invited person is named by the first word of their email's local part until they join. Email
// invitations are ended; the name still labels an ended row in the Team table and a channel's invitation lines.
test('an invited person is called by the first word of their email until they join', () => {
 assert.equal(inviteeName('nour@rslearning.com'), 'Nour');
 assert.equal(inviteeName('nour.hassan@rslearning.com'), 'Nour');
 assert.equal(inviteeName('MONA_ali+ads@example.com'), 'Mona');
 assert.equal(inviteeName('2024@example.com'), '2024');
 assert.equal(inviteeName('k@example.com'), 'K');
 assert.equal(inviteeName(''), '');
});
