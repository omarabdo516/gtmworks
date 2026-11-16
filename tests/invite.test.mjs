import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteError, inviteeName } from '../lib/invite.mjs';

// The Owner's invitation (#185; design-reference: inviteErr, addInvitee).
test('an email is refused when empty, not an address, or already invited in any letter case', () => {
 assert.equal(inviteError(''), 'inviteEmailEmpty');
 assert.equal(inviteError('   '), 'inviteEmailEmpty');
 for (const email of ['nour', 'nour@', 'nour@rslearning', 'nour@rslearning.c', 'no ur@rslearning.com', 'nour@@rslearning.com']) assert.equal(inviteError(email), 'inviteEmailMalformed', email);
 assert.equal(inviteError(' Nour@RSLearning.com ', ['nour@rslearning.com']), 'inviteEmailTaken');
 assert.equal(inviteError('nour@rslearning.com', ['sara@rslearning.com']), '');
 assert.equal(inviteError(' nour@rslearning.com '), '');
});

test('an invited person is called by the first word of their email until they join', () => {
 assert.equal(inviteeName('nour.hassan@rslearning.com'), 'Nour');
 assert.equal(inviteeName('MONA_ali+ads@example.com'), 'Mona');
 assert.equal(inviteeName('2024@example.com'), '2024');
 assert.equal(inviteeName('k@example.com'), 'K');
});
