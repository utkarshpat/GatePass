// Explicit manual smoke probe; no credentials or personal data are sent.
const raw = process.env.GATEPASS_STAGING_ORIGIN;
if (!raw) throw Error('STAGING_ORIGIN_REQUIRED: provision an approved staging deployment first');
const origin = new URL(raw);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('EXACT_HTTPS_STAGING_ORIGIN_REQUIRED');
for (const path of ['/', '/office/noida']) {
  const response = await fetch(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw Error('STAGING_PUBLIC_PAGE_FAILED');
  if (!response.headers.get('content-security-policy') || !response.headers.get('strict-transport-security')) throw Error('STAGING_SECURITY_HEADERS_MISSING');
  console.log(`PASS: ${path} available over verified HTTPS with CSP/HSTS.`);
}
const protectedRead = await fetch(new URL('/api/guard/visitors', origin), { method: 'POST', headers: { 'content-type': 'application/json', origin: origin.origin }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(15000) });
if (![401, 403].includes(protectedRead.status)) throw Error('STAGING_UNAUTHORISED_GUARD_READ_NOT_DENIED');
console.log('PASS: unauthenticated guard read denied. Deployment itself is a separate approved operation.');
