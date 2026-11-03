// Testes da divisão de domínios (npm test): as regras do _redirects, simuladas como o Netlify as aplica (a primeira
// que casa, de cima para baixo; "/x/*" casa "/x/..."; a query vai junto), e o destinoCanonico() do navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regras, segmentosDoSistema, texto } from './dominios.mjs';
import { destinoCanonico } from '../src/lib/dominios.ts';

const routesTs = readFileSync(new URL('../src/routes.ts', import.meta.url), 'utf8');
const lista = regras(routesTs).filter(l => typeof l !== 'string');

/** URL completa (https://host/caminho?query) → destino do 301, ou null se nenhuma regra casa (o netlify.toml segue). */
function simula(url) {
	const u = new URL(url);
	for (const [de, para] of lista) {
		const d = new URL(de.replace('/*', '/__SPLAT__'));
		if (d.host !== u.host) continue;
		const splat = d.pathname.endsWith('/__SPLAT__');
		const base = splat ? d.pathname.slice(0, -'__SPLAT__'.length) : d.pathname;
		if (splat ? !u.pathname.startsWith(base) : u.pathname !== base) continue;
		return para.replace(':splat', splat ? u.pathname.slice(base.length) : '') + u.search;
	}
	return null;
}

test('as rotas do sistema saem do routes.ts e não incluem as do site público', () => {
	const s = segmentosDoSistema(routesTs);
	for (const r of ['login', 'cadastro', 'redefinir-senha', 'definir-senha', 'nova-senha', 'inicio', 'console', 'mensageria', 'speech-analytics', 'email', 'relatorio-credor', 'empresa', 'conta']) assert.ok(s.includes(r), r);
	for (const r of ['como-decide', 'solucoes', 'seguranca', 'demonstracao', 'privacidade']) assert.ok(!s.includes(r), r);
});

test('motorcob.online: páginas públicas vão para motorcx.com.br; o sistema fica', () => {
	assert.equal(simula('https://motorcob.online/'), 'https://motorcx.com.br/');
	assert.equal(simula('https://motorcob.online/como-decide'), 'https://motorcx.com.br/como-decide');
	assert.equal(simula('https://motorcob.online/solucoes/voz'), 'https://motorcx.com.br/solucoes/voz');
	assert.equal(simula('https://motorcob.online/demonstracao?de=home'), 'https://motorcx.com.br/demonstracao?de=home');
	assert.equal(simula('https://www.motorcob.online/seguranca'), 'https://motorcx.com.br/seguranca');
	for (const p of ['/login', '/inicio', '/privacidade', '/definir-senha?token=abc', '/assets/x.js', '/sitemap.xml']) assert.equal(simula('https://motorcob.online' + p), null, p);
});

test('motorcx.com.br: rotas do sistema vão para motorcob.online com caminho e query', () => {
	assert.equal(simula('https://motorcx.com.br/login'), 'https://motorcob.online/login');
	assert.equal(simula('https://motorcx.com.br/definir-senha?token=abc&tipo=convite'), 'https://motorcob.online/definir-senha?token=abc&tipo=convite');
	assert.equal(simula('https://motorcx.com.br/mensageria/sms/campanhas/12'), 'https://motorcob.online/mensageria/sms/campanhas/12');
	assert.equal(simula('https://motorcx.com.br/relatorio-credor/tok123'), 'https://motorcob.online/relatorio-credor/tok123');
	for (const p of ['/', '/como-decide', '/solucoes/cobranca', '/demonstracao?de=voz', '/privacidade', '/assets/x.css', '/robots.txt']) assert.equal(simula('https://motorcx.com.br' + p), null, p);
});

/** Segue os 301 até parar (no máximo 3). */
function final(url) { let u = url, n = 0; for (let d; (d = simula(u)) && n < 3; n++) u = d; return [u, n]; }

test('motorcx.online e os www vão para motorcx.com.br (e as rotas do sistema seguem para motorcob.online)', () => {
	assert.equal(simula('https://motorcx.online/'), 'https://motorcx.com.br/');
	assert.equal(simula('https://motorcx.online/solucoes/voz?x=1'), 'https://motorcx.com.br/solucoes/voz?x=1');
	assert.equal(simula('https://www.motorcx.online/assets/a.js'), 'https://motorcx.com.br/assets/a.js');
	assert.equal(simula('https://www.motorcx.com.br/seguranca'), 'https://motorcx.com.br/seguranca');
	assert.deepEqual(final('https://motorcx.online/login'), ['https://motorcob.online/login', 2]);
	assert.deepEqual(final('https://www.motorcx.com.br/nova-senha?t=1'), ['https://motorcob.online/nova-senha?t=1', 2]);
	assert.deepEqual(final('https://www.motorcob.online/'), ['https://motorcx.com.br/', 1]);
});

test('Deploy Preview e outros endereços não têm regra', () => {
	assert.equal(simula('https://deploy-preview-1--motorcob.netlify.app/'), null);
	assert.ok(texto(routesTs).split('\n').every(l => !l || l.startsWith('#') || /^https:\/\/\S+ {2}https:\/\/\S+ {2}301!$/.test(l)));
});

test('destinoCanonico (navegador) segue as mesmas regras', () => {
	assert.equal(destinoCanonico('motorcob.online', '/', '', ''), 'https://motorcx.com.br/');
	assert.equal(destinoCanonico('motorcob.online', '/solucoes/voz', '', '#roleplay'), 'https://motorcx.com.br/solucoes/voz#roleplay');
	assert.equal(destinoCanonico('motorcob.online', '/login'), null);
	assert.equal(destinoCanonico('motorcob.online', '/privacidade'), null);
	assert.equal(destinoCanonico('www.motorcob.online', '/inicio', '?a=1'), 'https://motorcob.online/inicio?a=1');
	assert.equal(destinoCanonico('motorcx.com.br', '/demonstracao', '?de=home'), null);
	assert.equal(destinoCanonico('motorcx.com.br', '/privacidade'), null);
	assert.equal(destinoCanonico('motorcx.com.br', '/definir-senha', '?token=x'), 'https://motorcob.online/definir-senha?token=x');
	assert.equal(destinoCanonico('motorcx.online', '/'), 'https://motorcx.com.br/');
	assert.equal(destinoCanonico('www.motorcx.com.br', '/seguranca'), 'https://motorcx.com.br/seguranca');
	assert.equal(destinoCanonico('deploy-preview-168--motorcob.netlify.app', '/'), null);
	assert.equal(destinoCanonico('localhost', '/login'), null);
});
