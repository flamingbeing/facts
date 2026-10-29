import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { csp, securityHeaders, KIT, IMPORT_MAP } from '../headers.js';

const parse = s => Object.fromEntries(s.split('; ').map(d => { const [k, ...v] = d.split(' '); return [k, v]; }));

test('CSP: self by default, no inline script, kit and core allowed, no framing', () => {
  const d = parse(csp({ project: 'p1' }));
  assert.deepEqual(d['default-src'], ["'self'"]);
  assert.ok(!d['script-src'].includes("'unsafe-inline'") && !d['script-src'].includes("'unsafe-eval'"));
  assert.ok(d['script-src'].includes(KIT) && d['script-src'].includes('https://core.anawj.com'));
  assert.ok(d['frame-src'].includes('https://p1.firebaseapp.com'));
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.ok(!d['connect-src'].some(s => s.startsWith('http://')));
});

test('CSP: Firebase is vendored (app/public/vendor/firebase/), so the page loads no script from gstatic', () => {
  const d = parse(csp({ project: 'p1' }));
  assert.ok(!d['script-src'].some(s => s.includes('www.gstatic.com')));
  assert.ok(!d['connect-src'].some(s => s.includes('www.gstatic.com')));
});

test('CSP: the emulators only for local pages', () => {
  assert.ok(parse(csp({ local: true }))['connect-src'].includes('http://127.0.0.1:*'));
});

test('CSP: the emulators may be framed only on local pages (WebKit frames the auth emulator); production is unchanged', () => {
  assert.ok(parse(csp({ local: true }))['frame-src'].includes('http://127.0.0.1:*'));
  const prod = parse(csp({ project: 'p1' }));
  assert.ok(!prod['frame-src'].some(s => /127\.0\.0\.1|localhost/.test(s)));
  assert.deepEqual(prod['frame-src'], ["'self'", 'https://accounts.google.com', 'https://p1.firebaseapp.com']);
});

test('report-only until enforced; HSTS off on localhost', () => {
  const names = h => h.map(([k]) => k);
  assert.ok(names(securityHeaders({ enforce: false })).includes('Content-Security-Policy-Report-Only'));
  assert.ok(names(securityHeaders({ enforce: true })).includes('Content-Security-Policy'));
  assert.ok(!names(securityHeaders({ local: true })).includes('Strict-Transport-Security'));
});

test('CSP: the page\'s one import map is allowed by its hash (change the map, and this says the new hash)', () => {
  const html = fs.readFileSync(new URL('../../app/index.html', import.meta.url), 'utf8');
  const maps = [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
  assert.equal(maps.length, 1);
  assert.equal(IMPORT_MAP, `'sha256-${crypto.createHash('sha256').update(maps[0][1]).digest('base64')}'`);
  assert.ok(parse(csp())['script-src'].includes(IMPORT_MAP));
});

test('CSP reports go to /api/csp (report-uri, and report-to with its Reporting-Endpoints header)', () => {
  const d = parse(csp({ project: 'p1' }));
  assert.deepEqual(d['report-uri'], ['/api/csp']);
  assert.deepEqual(d['report-to'], ['csp']);
  assert.deepEqual(securityHeaders({}).find(([k]) => k === 'Reporting-Endpoints'), ['Reporting-Endpoints', 'csp="/api/csp"']);
});

test('the sign-in helper pages (Firebase\'s, with their own inline script) get no app policy, only framing by this address', () => {
  for (const enforce of [false, true]) {
    const h = Object.fromEntries(securityHeaders({ helper: true, framedBySelf: true, enforce }));
    assert.equal(h['Content-Security-Policy'], "frame-ancestors 'self'");
    assert.equal(h['Content-Security-Policy-Report-Only'], undefined);
    assert.equal(h['X-Frame-Options'], 'SAMEORIGIN');
    assert.equal(h['Cross-Origin-Opener-Policy'], undefined);   // else the popup loses window.opener and stays blank
  }
  assert.equal(Object.fromEntries(securityHeaders({}))['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
});
