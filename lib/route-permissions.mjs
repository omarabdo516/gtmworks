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
// checks setupCodeMatches), or an Agent's key (the route checks it with authenticateAgent).
export const outsideCompany = ['public', 'signedIn', 'setupCode', 'agentKey'];

// Route files (from the repository root) and the access each exported method needs.
export const routePermissions = {
  'app/api/agent-level/route.ts': { POST: 'owner' },
  'app/api/client-errors/route.ts': { POST: 'public' },
  'app/api/company-name/route.ts': { POST: 'owner' },
  'app/api/company-sign-in/route.ts': { POST: 'owner' },
  'app/api/config/route.ts': { GET: 'public' },
  // Reading needs a place in the Company (the conversation itself stays its person's, by RLS); sending and stopping
  // need a Member who may write (stop is narrowed again by conversation_stop_target).
  'app/api/conversations/route.ts': { GET: 'viewer', POST: 'contributor' },
  'app/api/health/route.ts': { GET: 'public' },
  'app/api/hermes-agents/route.ts': { GET: 'viewer', POST: 'owner' },
  'app/api/hermes-connections/route.ts': { GET: 'viewer', POST: 'owner' },
  'app/api/recent-cards/route.ts': { POST: 'viewer' },
  'app/api/v1/companies/[slug]/[...path]/route.ts': { GET: 'agentKey', POST: 'agentKey', PATCH: 'agentKey', PUT: 'agentKey', DELETE: 'agentKey' },
  'app/auth/callback/route.ts': { GET: 'public' },
  'app/c/[slug]/files/[id]/route.ts': { GET: 'viewer' },
  'app/first-run/submit/route.ts': { POST: 'setupCode' },
};

// Server actions by their exported name; an action with operations may name each one, the rest take `default`.
export const actionPermissions = {
  changeMember: 'manager',
  createAgentKey: 'owner',
  revokeAgentKey: 'owner',
  saveWebhook: 'owner',
  changeAgentAccess: 'owner',
  projectAction: 'contributor',
  installSkill: 'viewer',
  setSkillEnabled: 'viewer',
  decideSkillLesson: 'manager',
  workAction: { default: 'contributor', 'stage-settings': 'manager', 'label-settings': 'manager', 'save-step': 'manager', 'remove-step': 'manager' },
  saveMemberNote: 'viewer',
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
  if (required === 'public' || required === 'setupCode' || required === 'agentKey') return true;
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
