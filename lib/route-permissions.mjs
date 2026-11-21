// Every server route and server action, and the least a caller must be to reach it. This is the one table: a route
// file or an action that is not in it needs the strongest permission, Owner (requiredFor), and
// tests/route-permissions.test.mjs fails while any route file, method or exported action is missing from it.
//
// The table is a gate in front of the database, not a replacement for it: functions and row-level security still
// decide the finer rules (which approver holds a step, whose conversation it is). A role is read from the database on
// every request (permitted); no role is kept in a cookie or a token claim.

// Member roles from the weakest; a route that needs one accepts it and every stronger one.
export const roleOrder = ['viewer', 'contributor', 'manager', 'owner'];
// Reached without a place in a Company: anyone (public), any signed-in person, the install's setup code (the route
// checks setupCodeMatches), or a first-Owner link's secret (the route keeps only its hash and spends it once, #383).
export const outsideCompany = ['public', 'signedIn', 'setupCode', 'ownerLink'];

// Route files (from the repository root) and the access each exported method needs.
export const routePermissions = {
  // An Agent's Library (#194): the Owner and Managers read its own Engine profile's work folder; the download beside
  // each file is refused to a Member below Manager too.
  'app/api/agent-files/route.ts': { GET: 'manager' },
  'app/c/[slug]/agent-files/[agent]/route.ts': { GET: 'manager' },
  // A file opened in the Library's preview (#195): the same people, and the same refusal below Manager.
  'app/api/agent-files/preview/route.ts': { GET: 'manager' },
  // Any Member may ask; open_hermes_agent clears the "new" mark only for the Agent's own requester.
  'app/api/agent-opened/route.ts': { POST: 'viewer' },
  // The made-Agent toast is kept once for the Agent's own requester; mark_agent_toast_shown answers false to anyone else.
  'app/api/agent-toast/route.ts': { POST: 'viewer' },
  // An Owner or a Manager removes a rule an Agent was told (#18), or brings one back from Learning (#28);
  // remove_agent_rule and restore_agent_rule check it again in the rule's Company.
  'app/api/agent-rules/route.ts': { POST: 'manager', PUT: 'manager' },
  // An Agent's About on its page (#161): Owner and Manager; check_agent_setting checks that Role and that they see the
  // Agent again, and log_agent_setting writes the Company log's row.
  'app/api/agent-page/route.ts': { POST: 'manager' },
  // The Voice section's Listen (#162): Owner and Manager, as the sound is made on the Agent's profile; speakAgentSample
  // and check_agent_setting check that Role and that they see the Agent again on the server.
  'app/api/agent-speak/route.ts': { POST: 'manager' },
  // An Agent's memory (#350): any Member reads the notes of an Agent they are shown; only the Owner clears them
  // (check_memory_reset and log_memory_reset check it again). A note is edited by an Owner or Manager (#191,
  // check_memory_edit) and forgotten by the Owner alone (check_memory_forget, log_memory_forget).
  'app/api/agent-memory/route.ts': { GET: 'viewer', POST: 'owner', PUT: 'manager', DELETE: 'owner' },
  // An Agent's Routines (#31): the Owner and Managers make, reschedule, pause, resume, run now and delete one on the
  // Agent's own Engine profile; check_routine_change checks that Role again and log_routine_change logs each change.
  // Any Member reads the Routines of an Agent they are shown, for its details (#205).
  'app/api/agent-routines/route.ts': { GET: 'viewer', POST: 'manager' },
  // The vendor's way back after an app sign-in (#30): the Company is known only from the person's own open sign-in, which
  // row-level security shows to that Company's Owners alone, and finish_app_sign_in checks the Owner again.
  'app/api/apps/callback/[app]/route.ts': { GET: 'signedIn' },
  // Update now (#443): an install-wide request, so no Company names it; install_update and request_install_update answer
  // an active Owner of any Company and refuse everyone else, in the database.
  'app/api/install-update/route.ts': { GET: 'signedIn', POST: 'signedIn' },
  // The reader's channels with their unread counts (#24); channel_sidebar lists only the channels they are in.
  'app/api/channel-list/route.ts': { GET: 'viewer' },
  'app/api/channels/route.ts': { GET: 'viewer', POST: 'contributor' },
  'app/api/client-errors/route.ts': { POST: 'public' },
  // Any Member reads the Company's apps and their states (#201); only an Owner connects or disconnects one.
  'app/api/company-apps/route.ts': { GET: 'viewer', POST: 'owner' },
  // The Owner's own MCP server (#458): adding, testing and removing one is the Owner's alone, checked again in
  // lib/company-servers.mjs.
  'app/api/company-servers/route.ts': { POST: 'owner' },
  'app/api/company-name/route.ts': { POST: 'owner' },
  'app/api/company-sign-in/route.ts': { POST: 'owner' },
  'app/api/config/route.ts': { GET: 'public' },
  // Reading needs a place in the Company (the conversation itself stays its person's, by RLS); sending, stopping,
  // answering the Agent's question, marking a handed step done and deciding a permission request need a Member who may
  // write (stop is narrowed again by conversation_stop_target, an answer to the Conversation's own person by
  // answer_question, "Done it" by mark_hand_done, and a decision by decide_permission, which also keeps Always allow
  // with Owners and Managers).
  'app/api/conversations/route.ts': { GET: 'viewer', POST: 'contributor' },
  // Voice dictation (#160): any Member reads the language the Agent's profile listens in; a Member who may write has
  // their recording transcribed for an Agent they see. A Viewer has no composer, and the route refuses its POST too.
  'app/api/dictation/route.ts': { GET: 'viewer', POST: 'contributor' },
  'app/api/health/route.ts': { GET: 'public' },
  'app/api/hermes-agents/route.ts': { GET: 'viewer', POST: 'owner' },
  // A Company's provider key (#124): any Member reads whether one is set; only an Owner sets or removes one.
  'app/api/provider-keys/route.ts': { GET: 'viewer', POST: 'owner' },
  // The Company's speech-to-text provider (#430): any Member reads which one is set; an Owner sets or removes it.
  'app/api/speech-provider/route.ts': { GET: 'viewer', POST: 'owner' },
  // The Engine settings gtmworks lists (#125): any Member reads them; only an Owner writes one, which
  // lib/engine-settings.mjs and log_engine_setting check again.
  'app/api/agent-settings/route.ts': { GET: 'viewer', POST: 'owner' },
  'app/api/recent-cards/route.ts': { POST: 'viewer' },
  // Update ready (#442): only an Owner is told a newer gtmworks exists and the command that installs it.
  'app/api/update/route.ts': { GET: 'owner' },
  'app/auth/callback/route.ts': { GET: 'public' },
  'app/c/[slug]/files/[id]/route.ts': { GET: 'viewer' },
  // A file of the reader's own Conversation (#21); conversation_attachments_read shows it to that person alone.
  'app/c/[slug]/files/conversation/[id]/route.ts': { GET: 'viewer' },
  // A file of one of the reader's channel's messages (#156); channel_attachments_read shows it to that channel's Members.
  'app/c/[slug]/files/channel/[id]/route.ts': { GET: 'viewer' },
  'app/first-run/submit/route.ts': { POST: 'setupCode' },
  // A first-Owner link (#383, ADR 0019) is reached by whoever holds it: the route finds the link by the secret's hash,
  // refuses one already used, and spends it in the same transaction that makes the Company.
  'app/first-owner/submit/route.ts': { POST: 'ownerLink' },
};

// Server actions by their exported name; an action with operations may name each one, the rest take `default`.
export const actionPermissions = {
  changeMember: 'manager',
  // First run's one question (#9): only the Company's Owner answers it, once (choose_work_mode checks both again).
  chooseWorkMode: 'owner',
  changeAgentAccess: 'owner',
  projectAction: 'contributor',
  // A skill in an Agent's Engine profile is followed in every Run on it: Owner and Manager write one, as for the
  // Company knowledge; check_skill_write and log_skill_change check it again.
  writeSkill: 'manager',
  // A learning suggestion (#25): Owner and Manager; decide_agent_rule checks it again.
  decideAgentRule: 'manager',
  answerAgentRequest: 'owner',
  // A proposed change to an Agent's settings (#19): the Owner alone; answer_agent_change and #125's writers check again.
  answerAgentChange: 'owner',
  // A request to open an Agent hidden from a Member (#167): Owner and Manager; answer_agent_access checks again that a
  // Manager sees that Agent and is not the Member who asked.
  answerAgentAccess: 'manager',
  workAction: { default: 'contributor', 'stage-settings': 'manager', 'label-settings': 'manager', 'save-step': 'manager', 'remove-step': 'manager' },
  // A Card placed where its person dropped it (#174): a Member who may move one; place_work_card checks the Role, the
  // column and the stage again.
  placeMove: 'contributor',
  // An idea from the Ideas column (#188, #452); create_work_card checks the Role and the Agent again.
  addIdea: 'contributor',
  // "Undo" on a move (#168) is a Member who may move a Card; undo_work_card_move checks the Role, whose move it is and
  // where the Card stands now.
  undoMove: 'contributor',
  // The writer edits a note for five minutes (#22); edit_card_note checks the writer and the time again.
  editNote: 'contributor',
  saveMemberNote: 'viewer',
  // Which Agents each Member sees (#15): Owner and Manager; set_agent_visible checks it again.
  setAgentVisible: 'manager',
  // The Team dialog's table (#187): Owner and Manager read it; a Contributor or a Viewer gets nothing.
  teamChoices: 'manager',
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
  if (required === 'public' || required === 'setupCode' || required === 'ownerLink') return true;
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
