import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Check the built SPA with the same file-first /index.html fallback as Vercel.
const root = resolve('client/dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const candidate = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!candidate.startsWith(root + '/') && candidate !== root) { res.writeHead(403).end(); return; }
    const exists = await stat(candidate).then((file) => file.isFile()).catch(() => false);
    const path = exists ? candidate : resolve(root, 'index.html');
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(path));
  } catch { res.writeHead(500).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.stack || error.message));
  for (const path of ['/bookings', '/maintenance', '/reset-password']) {
    assert.equal((await page.goto(`${base}${path}`)).status(), 200);
    await page.waitForSelector('#root > *');
    assert.equal((await page.reload()).status(), 200);
  }
  await page.goto(`${base}/login`);
  await page.getByRole('heading', { name: 'Your home, in hand.' }).waitFor();
  // Exercise account access without creating accounts or sending email.
  const signupRequests = [];
  await page.route('**/auth/v1/signup**', async (route) => {
    signupRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error_code: 'email_address_invalid', msg: 'Invalid email' }) });
  });
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Full name').fill('Browser Test');
  await page.getByLabel('Email address').fill('  PERSON@GMAIL.COM  ');
  await page.getByLabel('Password', { exact: true }).fill('ValidPassword123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'real, deliverable email address' }).waitFor();
  assert.equal(signupRequests.length, 1);
  assert.equal(signupRequests[0].email, 'person@gmail.com');
  assert.equal(signupRequests[0].data.role, 'tenant');
  await page.getByRole('tab', { name: 'Sign in', exact: true }).click();
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByRole('heading', { name: 'Reset your password.' }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Your home, in hand.' }).waitFor();
  await page.goto(`${base}/register`);
  await page.route('**/auth/v1/signup**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-user', aud: 'authenticated', email: 'person@gmail.com', identities: [{ id: 'test-identity' }] }) }));
  await page.getByLabel('Full name').fill('Browser Test');
  await page.getByLabel('Email address').fill('person@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('ValidPassword123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Check your inbox' }).waitFor();
  console.log(JSON.stringify({ check: 'registration-and-recovery-navigation', passed: true, mockedAuth: true }));
  await page.goto(base);
  await page.getByRole('heading', { name: /Beautifully considered/ }).waitFor();
  // Allow the lazy WebGL module and its split dependencies to execute.
  await page.waitForTimeout(2500);
  await page.locator('.architecture-scene canvas').waitFor();
  assert.equal(await page.locator('.architecture-scene--fallback').count(), 0, '3D renderer fell back after a runtime error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ check: 'browser-production-bundle', passed: true, nestedRouteRefreshes: ['/bookings', '/maintenance', '/reset-password'], runtimeErrors: errors }));
} finally { await browser?.close(); await new Promise((done) => server.close(done)); }
