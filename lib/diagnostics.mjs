// What production writes to its container log when something fails, so a symptom seen only on the live site can be read
// from `docker logs` instead of guessed. Every line is one JSON object. Values that could be secrets never reach it.
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASS|JWT|CREDENTIAL)/i;
const text = (value, limit) => String(value ?? '').slice(0, limit);

// Secrets are removed three ways: the exact value of any secret-looking setting, anything shaped like a token or key, and
// short digit runs (an authenticator code, a one-time password).
function redact(value, env = process.env, limit = 400) {
  let out = text(value, limit * 4);
  for (const [name, secret] of Object.entries(env)) if (SECRET_NAME.test(name) && typeof secret === 'string' && secret.length >= 6) out = out.split(secret).join('[redacted]');
  return out
    .replace(/eyJ[\w-]{6,}\.[\w-]{6,}\.?[\w-]*/g, '[redacted]')
    .replace(/(bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9_+=-]{32,}/g, '[redacted]')
    .replace(/\b\d{6,8}\b/g, '[digits]')
    .slice(0, limit);
}

const controlFlow = error => typeof error?.digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(error.digest);
const errorClass = error => (error && typeof error === 'object' && error.name && error.name !== 'Error' ? error.name : error?.constructor?.name && error.constructor.name !== 'Object' ? error.constructor.name : 'Error');
const statusOf = error => (Number.isInteger(error?.status) ? error.status : null);

// Every company's data and logs carry the company (ADR 0004): the company and its slug come from the action's own form
// fields, and only when they have the shape of an id and a slug, so nothing else a form carries can reach the log.
export function companyContext(form) {
  const field = name => { try { const value = form?.get?.(name); return typeof value === 'string' ? value : null; } catch { return null; } };
  const company = field('company'); const slug = field('slug');
  return { company: company && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(company) ? company.toLowerCase() : null, slug: slug && /^[a-z0-9-]{1,60}$/.test(slug) ? slug : null };
}

function actionFailureLine(action, error, { outcome = 'threw', env = process.env, now = new Date(), form } = {}) {
  return JSON.stringify({
    event: 'server_action_failed', at: now.toISOString(), action: text(action, 80), ...companyContext(form), outcome, status: statusOf(error),
    errorClass: text(errorClass(error), 80), code: error?.code == null ? null : redact(error.code, env, 80),
    message: redact(error instanceof Error || typeof error?.message === 'string' ? error.message : error, env),
  });
}

// For a failure a server action handles itself (it shows a message and goes on), so the cause is not lost with the message.
export function logActionFailure(action, error, { outcome = 'returned', write = console.error, env = process.env, form } = {}) {
  try { write(actionFailureLine(action, error, { outcome, env, form })); } catch { /* A broken log must never break the action. */ }
}

// Wraps a server action: anything it throws is logged once with its name, then thrown again unchanged. Redirects are not failures.
export function withActionLog(action, run, { write = console.error, env = process.env } = {}) {
  return async (...args) => {
    try { return await run(...args); }
    catch (error) { if (!controlFlow(error)) logActionFailure(action, error, { outcome: 'threw', write, env, form: args.find(arg => typeof arg?.get === 'function') }); throw error; }
  };
}

function clientErrorLine(body, { env = process.env, userAgent = '', now = new Date() } = {}) {
  if (!body || typeof body !== 'object' || typeof body.message !== 'string' || !body.message) return null;
  const field = (value, limit) => (typeof value === 'string' || typeof value === 'number' ? redact(value, env, limit) : null);
  return JSON.stringify({
    event: 'client_error', at: now.toISOString(), source: field(body.source, 40) || 'unknown', path: field(String(body.path ?? '').split(/[?#]/)[0], 200),
    stage: field(body.stage, 60), status: field(body.status, 20), code: field(body.code, 80), digest: field(body.digest, 80),
    message: redact(body.message, env, 400), stack: field(body.stack, 1500), userAgent: text(userAgent, 160),
  });
}

// At most `max` lines a minute, so the endpoint cannot flood the log.
export function limiter(max = 60, windowMs = 60000, clock = Date.now) {
  let start = 0; let count = 0;
  return () => { const now = clock(); if (now - start >= windowMs) { start = now; count = 0; } return ++count <= max; };
}

const allow = limiter();
export async function clientErrorResponse(request, { write = console.error, env = process.env, allowed = allow } = {}) {
  if (!allowed()) return new Response(null, { status: 429 });
  const raw = await request.text().catch(() => '');
  if (raw.length > 8000) return new Response(null, { status: 413 });
  let body; try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const line = clientErrorLine(body, { env, userAgent: request.headers.get('user-agent') || '' });
  if (!line) return new Response(null, { status: 400 });
  write(line);
  return new Response(null, { status: 204 });
}

// How long opening one chat took (decision 0042: within a second): one line per open, each step's elapsed ms from the
// page's start. Only ids and whole numbers reach it, never a body or a key.
const chatOpenSteps = ['frame', 'reads', 'details', 'sidebar', 'firstByte', 'record', 'done'];
const id = value => (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null);
// `render` says what the render was (#762): a person's open, a link's prefetch, or the page drawn again (a refresh).
const renders = ['open', 'prefetch', 'refresh'];
export function chatOpenLine({ company, conversation, steps, render = 'open' }, { now = new Date() } = {}) {
  const ms = Object.fromEntries(chatOpenSteps.flatMap(step => (Number.isFinite(steps?.[step]) ? [[step, Math.round(steps[step])]] : [])));
  return JSON.stringify({ event: 'chat_opened', at: now.toISOString(), company: id(company), conversation: id(conversation), render: renders.includes(render) ? render : 'open', ms });
}

// What kind of render a page request is (#762), from the headers Next.js's router sends: a prefetch says so; a router
// request for the page the browser already shows (its Referer) is that page drawn again; anything else is an open.
export function renderKind(headers, path) {
  if (headers.get('next-router-prefetch')) return 'prefetch';
  if (headers.get('rsc')) {
    try { if (new URL(headers.get('referer') || '').pathname === path) return 'refresh'; } catch { /* No Referer: an open. */ }
  }
  return 'open';
}

// What a person waited for in a Conversation (#762, spec #759), one line each, with its Company and Conversation and
// never a message's text: `message_drawn` (from pressing Send until their own message was drawn, reported by the
// browser), `run_started` (from the send until the Engine started its Run, written by the starter) and `reply_drawn`
// (from the Run's end until its reply was drawn, reported by the browser; `from` says whether the end was the Steps
// stream's or, with no stream read, the reply's own stored time).
const waits = ['message_drawn', 'run_started', 'reply_drawn'];
export function waitLine({ event, company, conversation, ms, from }, { now = new Date() } = {}) {
  if (!waits.includes(event) || !Number.isFinite(ms) || ms < 0 || ms > 3600000) return null;
  return JSON.stringify({ event, at: now.toISOString(), company: id(company), conversation: id(conversation), ms: Math.round(ms),
    ...(event === 'reply_drawn' ? { from: from === 'stream' ? 'stream' : 'stored' } : {}) });
}
// The browser's report of a wait: rate-limited as a client error is, and only the two waits a browser measures.
const allowWaits = limiter(120);
export async function waitResponse(request, { write = console.log, allowed = allowWaits } = {}) {
  if (!allowed()) return new Response(null, { status: 429 });
  const raw = await request.text().catch(() => '');
  if (raw.length > 1000) return new Response(null, { status: 413 });
  let body; try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const line = body && typeof body === 'object' && body.event !== 'run_started' ? waitLine(body) : null;
  if (!line) return new Response(null, { status: 400 });
  write(line);
  return new Response(null, { status: 204 });
}

// How long one save of an Agent's or the Company's Engine setting took (#661): one line per POST /api/agent-settings,
// each step's elapsed ms from the request's start. The route passes a setting's name only when it is one it knows (and
// this keeps only a name's shape); its value, the body and any key never reach the line.
const settingSaveSteps = ['signIn', 'allowed', 'queue', 'owner', 'reads', 'engineWrite', 'record', 'done'];
export function settingSaveLine({ company, setting, status, steps }, { now = new Date() } = {}) {
  const ms = Object.fromEntries(settingSaveSteps.flatMap(step => (Number.isFinite(steps?.[step]) ? [[step, Math.round(steps[step])]] : [])));
  const name = typeof setting === 'string' && /^[a-z][a-z0-9_.]{0,59}$/.test(setting) ? setting : null;
  return JSON.stringify({ event: 'agent_setting_saved', at: now.toISOString(), company: id(company), setting: name, status: Number.isInteger(status) ? status : null, ms });
}

// An Agent's apps that could not be listed (#770): one line per failed read, with its cause as the read named it
// (unreachable, timedOut, refused, failed, noProfile, database). Ids only.
const appsCauses = ['unreachable', 'timedOut', 'refused', 'noNetwork', 'errorAnswer', 'failed', 'noProfile', 'database', 'missing'];
export function appsUnreadLine({ company, agent, cause }, { now = new Date() } = {}) {
  return JSON.stringify({ event: 'apps_unread', at: now.toISOString(), company: id(company), agent: id(agent), cause: appsCauses.includes(cause) ? cause : 'failed' });
}
