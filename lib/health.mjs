import packageInfo from '../package.json' with { type: 'json' };
const { version } = packageInfo;

export async function health(url, anonKey, request = fetch) {
  let db = false;
  try {
    const response = await request(`${url.replace(/\/$/, '')}/rest/v1/companies?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    db = response.ok;
  } catch { /* Do not expose connection details. */ }
  return { ok: db, version, db };
}

export async function healthResponse(url, anonKey, request = fetch) {
  const result = await health(url, anonKey, request);
  return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
