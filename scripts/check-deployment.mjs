import assert from 'node:assert/strict';
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/check-deployment.mjs https://YOUR_PROJECT.vercel.app');
const url = new URL(input);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use your public HTTPS deployment URL.');
const base = url.origin;
for (const path of ['/login','/bookings','/maintenance','/reset-password']) {
 const response = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
 assert.equal(response.status, 200, `${path} returned ${response.status}`);
 assert.match(response.headers.get('content-type') || '', /text\/html/);
 assert.match(await response.text(), /id="root"/);
 console.log(JSON.stringify({check:`hosted-route:${path}`,passed:true}));
}
const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15000) });
assert.equal(health.status,200);
assert.equal((await health.json()).service,'property-management-api');
const unauth = await fetch(`${base}/api/bookings`, { signal: AbortSignal.timeout(15000) });
assert.equal(unauth.status,401);
assert.ok((await unauth.json()).error);
console.log(JSON.stringify({check:'hosted-api-and-auth-boundary',passed:true}));
console.log('Hosted email redirects, authenticated role flows, photo storage, and Realtime must also be verified from the deployed site.');
