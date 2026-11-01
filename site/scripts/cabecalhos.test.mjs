// Testes do gerador da CSP (scripts/cabecalhos.mjs): hash dos scripts inline, origens do Supabase do build e nada de
// 'unsafe-inline'/'unsafe-eval' em script-src. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gerar, hashesInline, politica, supabaseDoBuild } from './cabecalhos.mjs';

const sha = s => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

test('hash de cada script inline, sem os de src e sem repetir', () => {
	const a = 'window.x = 1;', b = 'import("/assets/entry.js");';
	const html = `<script>${a}</script ><script type="module" async="">${b}</script><script src="/assets/y.js"></script><script>${a}</script>`;
	assert.deepEqual(hashesInline(html), [sha(a), sha(b)]);
});

test('política: Supabase em https e wss, gravações do GCS e scripts só por hash', () => {
	const p = politica('https://abcdefghij.supabase.co', ["'sha256-AAA='"]);
	const d = Object.fromEntries(p.split('; ').map(x => { const [k, ...v] = x.split(' '); return [k, v.join(' ')]; }));
	assert.equal(d['script-src'], "'self' 'sha256-AAA='");
	assert.equal(d['connect-src'], "'self' https://abcdefghij.supabase.co wss://abcdefghij.supabase.co https://storage.googleapis.com");
	assert.ok(d['media-src'].split(' ').includes('https://storage.googleapis.com'));
	assert.equal(d['frame-ancestors'], "'none'");
	assert.equal(d['object-src'], "'none'");
	assert.doesNotMatch(d['script-src'], /unsafe/);
	assert.throws(() => politica('http://abcdefghij.supabase.co', []));
});

test('sem VITE_SUPABASE_URL no ambiente, usa o do netlify.toml (o que vai ao ar)', () => {
	assert.equal(supabaseDoBuild({}), 'https://jxwppkrkuckfwmphqjva.supabase.co');
	assert.equal(supabaseDoBuild({ VITE_SUPABASE_URL: 'https://outro0000.supabase.co' }), 'https://outro0000.supabase.co');
});

test('gera o _headers do Netlify para /*', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'csp-'));
	writeFileSync(path.join(dir, 'index.html'), '<html><body><script>window.a=1;</script></body></html>');
	const { hashes } = gerar(dir, { VITE_SUPABASE_URL: 'https://abcdefghij.supabase.co' });
	const txt = readFileSync(path.join(dir, '_headers'), 'utf8');
	assert.match(txt, /^\/\*\n {2}Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-/m);
	assert.ok(txt.includes(hashes[0]));
});
