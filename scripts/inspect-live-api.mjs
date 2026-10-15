const frontend = 'https://rental-management-phi-ashy.vercel.app';
const backend = 'https://property-management-api-2gu3.onrender.com';
const load = (url) => fetch(url, { signal: AbortSignal.timeout(20000) });
const html = await (await load(frontend)).text();
const queue = [...html.matchAll(/(?:src|href)=["']([^"']+\.js)["']/g)].map((match) => new URL(match[1], frontend).href);
const seen = new Set(); const bases = new Set();
while (queue.length && seen.size < 70) {
 const batch = queue.splice(0, 6).filter((url) => !seen.has(url));
 for (const url of batch) seen.add(url);
 await Promise.all(batch.map(async (url) => {
  const source = await (await load(url)).text();
  for (const match of source.matchAll(/https:\/\/property-management-api-2gu3\.onrender\.com(?:\/api)?/g)) bases.add(match[0]);
  for (const match of source.matchAll(/["']([^"'\s]+\.js)["']/g)) {
   const child = new URL(match[1], url);
   if (child.origin === frontend && !seen.has(child.href) && !queue.includes(child.href)) queue.push(child.href);
  }
 }));
}
console.log(JSON.stringify({ check: 'deployed-frontend-api-bases', bases: [...bases], javascriptAssetsInspected: seen.size }));
for (const path of ['/profile', '/api/health', '/api/profile', '/api/dashboard', '/api/maintenance', '/api/amenities', '/api/properties', '/api/bookings', '/api/notifications', '/api/manager/staff', '/api/staff/permissions']) {
 const response = await load(backend + path);
 console.log(JSON.stringify({ path, status: response.status, type: response.headers.get('content-type') }));
}
