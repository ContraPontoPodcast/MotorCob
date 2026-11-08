// "← Voltar" (npm test): cada tela-mãe é uma rota que existe, as telas de topo não ganham voltar e o link
// desenhado aponta para a tela-mãe (nunca para o histórico).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ROTAS_PAI, rotaPai } from './rota-pai';
import { VoltarPara } from '@/components/comuns/voltar';

// Rotas declaradas em src/routes.ts (o teste roda com cwd = site/).
const declaradas = new Set([...readFileSync('src/routes.ts', 'utf8').matchAll(/route\('([^']+)'/g)].map(m => `/${m[1]}`));
/** O caminho abre alguma rota declarada (exata ou com parâmetros, ex.: "/speech-analytics" em "/speech-analytics/:aba?"). */
const abre = (caminho: string) => declaradas.has(caminho) || [...declaradas].some(r => r.includes('/:') && new RegExp(`^${r.split('/').filter(Boolean).map(seg => (seg.startsWith(':') ? (seg.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+') : `/${seg}`)).join('')}$`).test(caminho));

test('toda rota mapeada e todo destino existem no routes.ts', () => {
	for (const rota of Object.keys(ROTAS_PAI)) {
		assert.ok(declaradas.has(rota), `rota sem declaração: ${rota}`);
		for (const equipe of [false, true]) {
			const pai = rotaPai(rota, { equipe });
			if (!pai) continue;
			assert.ok(abre(pai.to.split('?')[0]), `destino inexistente: ${rota} → ${pai.to}`);
			assert.notEqual(pai.to, rota, `${rota} não pode voltar para ela mesma`);
			assert.ok(pai.rotulo.trim().length > 0);
		}
	}
});

test('telas de detalhe voltam para a tela-mãe lógica', () => {
	assert.deepEqual(rotaPai('/cliente'), { to: '/clientes', rotulo: 'Clientes' });
	assert.deepEqual(rotaPai('/suporte/novo'), { to: '/suporte', rotulo: 'Meus chamados' });
	assert.equal(rotaPai('/docs/api')?.to, '/empresa/integracoes');
	assert.equal(rotaPai('/documentacao')?.to, '/empresa/integracoes');
	assert.equal(rotaPai('/ajuda/o-que-significa')?.to, '/inicio');
	assert.equal(rotaPai('/assistente/minhas')?.to, '/inicio');
	assert.equal(rotaPai('/suporte/novo/')?.to, '/suporte', 'barra no fim não muda o destino');
});

test('o destino depende de quem abre: equipe volta ao Console, cliente ao Início', () => {
	assert.equal(rotaPai('/implantacao', { equipe: true })?.to, '/console/implantacao');
	assert.equal(rotaPai('/implantacao', { equipe: false })?.to, '/inicio');
	assert.equal(rotaPai('/empresa', { equipe: true })?.to, '/console');
	assert.equal(rotaPai('/empresa', { equipe: false }), null, 'para o cliente, Empresa é área do menu');
});

test('telas de topo (abas e menu) não ganham voltar', () => {
	for (const r of ['/inicio', '/fila', '/clientes', '/suporte', '/docs', '/console', '/console/implantacao', '/empresa/integracoes', '/relatorios', '/jornada']) {
		assert.equal(rotaPai(r, { equipe: true }), null, r);
	}
});

test('VoltarPara é um link de verdade para a tela-mãe, com cores do tema', () => {
	const s = renderToStaticMarkup(<MemoryRouter><VoltarPara to="/clientes" rotulo="Clientes" /></MemoryRouter>);
	assert.match(s, /<a [^>]*href="\/clientes"/);
	assert.match(s, /aria-label="Voltar para Clientes"/);
	assert.match(s, /var\(--base-texto-2\)/);
	assert.doesNotMatch(s, /history|#[0-9a-fA-F]{3,6}\b/);
});

test('Agente Voz/CX e Speech Analytics: subtelas voltam para a tela-mãe; abas da área, não', () => {
	for (const r of ['/voz/agente/editor/12', '/voz/agente/testar', '/voz/agente/desempenho', '/voz/agente/personas', '/voz/agente/pedido/3', '/voz/agente/roteiro']) {
		assert.deepEqual(rotaPai(r), { to: '/voz/agente', rotulo: 'Agente de voz' }, r);
	}
	assert.deepEqual(rotaPai('/voz/ligacoes/42'), { to: '/voz/ligacoes', rotulo: 'Ligações' });
	for (const r of ['/speech-analytics/qualidade', '/speech-analytics/busca', '/speech-analytics/gravacoes', '/speech-analytics/entrada']) assert.equal(rotaPai(r)?.to, '/speech-analytics', r);
	assert.equal(rotaPai('/speech-analytics/entrada/enviar')?.to, '/speech-analytics/entrada');
	for (const r of ['/voz', '/voz/agente', '/voz/discagem', '/voz/ligacoes', '/voz/telefonia', '/speech-analytics', '/speech-analytics/', '/canais']) assert.equal(rotaPai(r), null, r);
	assert.equal(rotaPai('/voz/agente/editor/12/extra'), null, 'parâmetro casa um segmento só');
});
