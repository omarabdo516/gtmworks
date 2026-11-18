// Every server route and server action, and the least a caller must be to reach it. This is the one table: a route
// file or an action that is not in it needs the strongest permission, Owner (requiredFor), and
// tests/route-permissions.test.mjs fails while any route file, method or exported action is missing from it.
//
// The table is a gate in front of the database, not a replacement for it: functions and row-level security still
// decide the finer rules (which approver holds a step, whose conversation it is). A role is read from the database on
// every request (permitted); no role is kept in a cookie or a token claim.

// Member roles from the weakest; a route that needs one accepts it and every stronger one.
export const roleOrder = ['viewer', 'contributor', 'manager', 'owner'];
// Reached without a place in a Company: anyone (public), any signed-in person, or the install's setup code (the route
// checks setupCodeMatches).
export const outsideCompany = ['public', 'signedIn', 'setupCode'];

// Route files (from the repository root) and the access each exported method needs.
export const routePermissions = {
  // Any Member may ask; open_hermes_agent clears the "new" mark only for the Agent's own requester.
  'app/api/agent-opened/route.ts': { POST: 'viewer' },
  'app/api/agent-level/route.ts': { POST: 'owner' },
  // An Owner or a Manager removes a rule an Agent was told (#18); remove_agent_rule checks it again in the rule's Company.
  'app/api/agent-rules/route.ts': { POST: 'manager' },
  // An Agent's memory (#350): any Member reads the notes of an Agent they are shown; only the Owner clears them
  // (check_memory_reset and log_memory_reset check it again). A note is edited by an Owner or Manager (#191,
  // check_memory_edit) and forgotten by the Owner alone (check_memory_forget, log_memory_forget).
  'app/api/agent-memory/route.ts': { GET: 'viewer', POST: 'owner', PUT: 'manager', DELETE: 'owner' },
  // The vendor's way back after an app sign-in (#30): the Company is known only from the person's own open sign-in, which
  // row-level security shows to that Company's Owners alone, and finish_app_sign_in checks the Owner again.
  'app/api/apps/callback/[app]/route.ts': { GET: 'signedIn' },
  // The reader's channels with their unread counts (#24); channel_sidebar lists only the channels they are in.
  'app/api/channel-list/route.ts': { GET: 'viewer' },
  'app/api/channels/route.ts': { GET: 'viewer', POST: 'contributor' },
  'app/api/client-errors/route.ts': { POST: 'public' },
  // Any Member reads the Company's apps and their states (#201); only an Owner connects or disconnects one.
  'app/api/company-apps/route.ts': { GET: 'viewer', POST: 'owner' },
  'app/api/company-name/route.ts': { POST: 'owner' },
  'app/api/company-sign-in/route.ts': { POST: 'owner' },
  'app/api/config/route.ts': { GET: 'public' },
  // Reading needs a place in the Company (the conversation itself stays its person's, by RLS); sending, stopping,
  // answering the Agent's question, marking a handed step done and deciding a permission request need a Member who may
  // write (stop is narrowed again by conversation_stop_target, an answer to the Conversation's own person by
  // answer_question, "Done it" by mark_hand_done, and a decision by decide_permission, which also keeps Always allow
  // with Owners and Managers).
  'app/api/conversations/route.ts': { GET: 'viewer', POST: 'contributor' },
  'app/api/health/route.ts': { GET: 'public' },
  'app/api/hermes-agents/route.ts': { GET: 'viewer', POST: 'owner' },
  // A Company's provider key (#124): any Member reads whether one is set; only an Owner sets or removes one.
  'app/api/provider-keys/route.ts': { GET: 'viewer', POST: 'owner' },
  'app/api/recent-cards/route.ts': { POST: 'viewer' },
  'app/auth/callback/route.ts': { GET: 'public' },
  'app/c/[slug]/files/[id]/route.ts': { GET: 'viewer' },
  // A file of the reader's own Conversation (#21); conversation_attachments_read shows it to that person alone.
  'app/c/[slug]/files/conversation/[id]/route.ts': { GET: 'viewer' },
  'app/first-run/submit/route.ts': { POST: 'setupCode' },
};

// Server actions by their exported name; an action with operations may name each one, the rest take `default`.
export const actionPermissions = {
  changeMember: 'manager',
  // First run's one question (#9): only the Company's Owner answers it, once (choose_work_mode checks both again).
  chooseWorkMode: 'owner',
  changeAgentAccess: 'owner',
  projectAction: 'contributor',
  // A skill in an Agent's Engine profile is followed in every Run on it: Owner and Manager write one or switch it, as
  // for the Company knowledge; check_skill_write and log_skill_change check it again.
  writeSkill: 'manager',
  setSkillEnabled: 'manager',
  // A learning suggestion (#25): Owner and Manager; decide_agent_rule checks it again.
  decideAgentRule: 'manager',
  answerAgentRequest: 'owner',
  workAction: { default: 'contributor', 'stage-settings': 'manager', 'label-settings': 'manager', 'save-step': 'manager', 'remove-step': 'manager' },
  // The writer edits a note for five minutes (#22); edit_card_note checks the writer and the time again.
  editNote: 'contributor',
  saveMemberNote: 'viewer',
  // Which Agents each Member sees (#15): Owner and Manager; set_agent_visible checks it again.
  setAgentVisible: 'manager',
  // An invitation from the Team table (#185): the Owner only, as the reference offers it; invite_member checks it again.
  inviteMember: 'owner',
  // A switch on an invited row (#185): Owner and Manager; set_invitation_agent_visible checks it again.
  setInvitationAgentVisible: 'manager',
  // A part of the Company knowledge (#27): Owner and Manager; check_company_knowledge and log_company_knowledge check it again.
  saveCompanyKnowledge: 'manager',
  // Team channels (#24): Owner and Manager make one and change its Members and Agents; create_channel,
  // set_channel_person and set_channel_agent check it again.
  createChannel: 'manager',
  changeChannel: 'manager',
  channelChoices: 'manager',
  saveLanguage: 'signedIn',
  saveTheme: 'signedIn',
  sendResetLink: 'public',
};

const known = new Set([...roleOrder, ...outsideCompany]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What one entry needs; anything missing or misspelled needs Owner.
export function requiredFor(table, key, part) {
  const entry = Object.hasOwn(table, key) ? table[key] : undefined;
  const value = typeof entry === 'string' ? entry : entry && (Object.hasOwn(entry, part) ? entry[part] : entry.default);
  return known.has(value) ? value : 'owner';
}

// Whether the caller of `db` (their own session) has what `required` names in `company`. The role is read now, from
// the database: a role changed between two requests is the role of the second one.
export async function permitted(db, required, company, person) {
  if (required === 'public' || required === 'setupCode') return true;
  const caller = person || (await db.auth.getUser()).data?.user?.id;
  if (!caller) return false;
  if (required === 'signedIn') return true;
  if (typeof company !== 'string' || !uuid.test(company)) return false;
  const { data, error } = await db.from('members').select('role').eq('company_id', company).eq('person_id', caller).is('removed_at', null).maybeSingle();
  if (error || !data) return false;
  return roleOrder.indexOf(data.role) >= roleOrder.indexOf(required);
}

export const routeAllowed = (db, file, method, company, person) => permitted(db, requiredFor(routePermissions, file, method), company, person);
export const actionAllowed = (db, name, company, operation, person) => permitted(db, requiredFor(actionPermissions, name, operation), company, person);
