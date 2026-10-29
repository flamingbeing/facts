// An outside ESM package plugs in like @core/*: named in the page's import map, vendored as a file, listed in the
// service worker's SHELL. The fixture page is served on its own (not through the app's Worker); the starter app
// imports none of it.
import { test, expect } from '@playwright/test';
import { setOffline } from './fixtures.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/outside-package');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

let server;
let origin;
test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html');
    const file = path.join(FIXTURE, name);
    try {
      if (!file.startsWith(FIXTURE + path.sep)) throw new Error('outside the fixture');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(resolve => server.close(resolve)));

test('an outside package runs from the import map, and again after an offline reload', async ({ page, context }) => {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#out')).toHaveText(/^zod ok/);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  const cached = await page.evaluate(async () => (await (await caches.open('outside-package-v1')).keys()).map(r => r.url));
  expect(cached.some(u => u.endsWith('/vendor/zod/3.23.8/index.mjs')), 'zod precached').toBe(true);
  await setOffline(context, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#out')).toHaveText(/^zod ok/);
  await setOffline(context, false);
});
