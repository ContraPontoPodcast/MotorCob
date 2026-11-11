// "← Voltar" (npm test): cada tela-mãe é uma rota que existe, as telas de topo não ganham voltar e o link
// desenhado aponta para a tela-mãe (nunca para o histórico).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ROTAS_PAI, rotaPai } from './rota-pai';
import { RotaDaTela, Voltar, VoltarPara } from '@/components/comuns/voltar';

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

test('Agente Voz/CX e Speech Analytics: seções voltam para a Visão geral da área; subtelas, para a seção', () => {
	const visaoGeralVoz = { to: '/voz', rotulo: 'Visão geral do Agente Voz/CX' };
	for (const r of ['/voz/agente', '/voz/discagem', '/voz/ligacoes', '/voz/telefonia', '/voz/telefonia/']) {
		for (const equipe of [false, true]) assert.deepEqual(rotaPai(r, { equipe }), visaoGeralVoz, r);
	}
	for (const r of ['/voz/agente/editor/12', '/voz/agente/identidade', '/voz/agente/testar', '/voz/agente/desempenho', '/voz/agente/personas', '/voz/agente/pedido/3', '/voz/agente/roteiro']) {
		assert.deepEqual(rotaPai(r), { to: '/voz/agente', rotulo: 'Agente de voz' }, r);
	}
	assert.deepEqual(rotaPai('/voz/ligacoes/42'), { to: '/voz/ligacoes', rotulo: 'Ligações' });
	for (const r of ['/speech-analytics/qualidade', '/speech-analytics/busca', '/speech-analytics/gravacoes', '/speech-analytics/entrada']) assert.equal(rotaPai(r)?.to, '/speech-analytics', r);
	assert.equal(rotaPai('/speech-analytics/entrada/enviar')?.to, '/speech-analytics/entrada');
	// O topo de cada área não tem voltar (o menu da área leva a ele).
	for (const r of ['/voz', '/voz/', '/speech-analytics', '/speech-analytics/', '/canais']) assert.equal(rotaPai(r), null, r);
	assert.equal(rotaPai('/voz/agente/editor/12/extra'), null, 'parâmetro casa um segmento só');
});

test('toda tela do Agente Voz/CX no routes.ts tem voltar, menos a Visão geral e os endereços que redirecionam', () => {
	const voz = [...declaradas].filter(r => r.startsWith('/voz/'));
	assert.ok(voz.length >= 13, 'as rotas da área estão no routes.ts');
	for (const r of voz) {
		if (r === '/voz/conexao') continue; // redireciona para /voz/telefonia (lib/rotas-voz.ts)
		const caminho = r.replace(/:[^/]+/g, '7');
		const pai = rotaPai(caminho);
		assert.ok(pai, `sem voltar: ${r}`);
		// A tela-mãe fica acima na hierarquia do menu: Visão geral → seção → subtela → detalhe.
		assert.ok(caminho.startsWith(pai.to + '/'), `${r} volta para ${pai.to}, que não está acima dela`);
	}
});

test('o voltar desenhado nas seções do Agente Voz/CX aponta para a Visão geral da área', () => {
	const html = (rota: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}><Voltar /></MemoryRouter>);
	const telefonia = html('/voz/telefonia');
	assert.match(telefonia, /<a [^>]*href="\/voz"/);
	assert.match(telefonia, /aria-label="Voltar para Visão geral do Agente Voz\/CX"/);
	assert.match(html('/voz/agente/identidade'), /href="\/voz\/agente"/);
	assert.equal(html('/voz'), '');
	// Modo de demonstração (/dev/fluxo/...): o mesmo voltar da rota de verdade.
	const demo = renderToStaticMarkup(<MemoryRouter initialEntries={['/dev/fluxo/testar']}><RotaDaTela.Provider value="/voz/agente/testar"><Voltar /></RotaDaTela.Provider></MemoryRouter>);
	assert.match(demo, /href="\/voz\/agente"/);
});

test('Telefonia › tronco (SQL 114) volta para Telefonia', () => {
	assert.deepEqual(rotaPai('/voz/telefonia/tronco/novo'), { to: '/voz/telefonia', rotulo: 'Telefonia' });
	assert.deepEqual(rotaPai('/voz/telefonia/tronco/alfa-sp-1'), { to: '/voz/telefonia', rotulo: 'Telefonia' });
});

test('Roleplay: o Painel volta para a Visão geral (como toda aba); seções, para o Painel; detalhes, para a seção', () => {
	assert.deepEqual(rotaPai('/speech-analytics/roleplay'), { to: '/speech-analytics', rotulo: 'Visão geral do Speech Analytics' });
	assert.deepEqual(rotaPai('/speech-analytics/roleplay/cenarios'), { to: '/speech-analytics/roleplay', rotulo: 'Painel do Roleplay' });
	assert.deepEqual(rotaPai('/speech-analytics/roleplay/operadores'), { to: '/speech-analytics/roleplay', rotulo: 'Painel do Roleplay' });
	assert.deepEqual(rotaPai('/speech-analytics/roleplay/cenarios/12'), { to: '/speech-analytics/roleplay/cenarios', rotulo: 'Cenários' });
	assert.deepEqual(rotaPai('/speech-analytics/roleplay/operadores/7'), { to: '/speech-analytics/roleplay/operadores', rotulo: 'Cadastro para treino' });
	assert.equal(rotaPai('/speech-analytics/roleplay/cenarios/12/extra'), null, 'parâmetro casa um segmento só');
	// toda rota do Roleplay no routes.ts tem voltar para uma tela acima dela
	const rp = [...declaradas].filter(r => r.startsWith('/speech-analytics/roleplay'));
	assert.equal(rp.length, 13);   // + Evolução (SQL 121)
	for (const r of rp) {
		const caminho = r.replace(/:[^/]+/g, '7');
		const pai = rotaPai(caminho);
		// o "Atribuir treino" volta para Treinos atribuídos (irmã); as outras, para uma tela acima delas
		assert.ok(pai && (caminho.startsWith(pai.to + '/') || (r.endsWith('/atribuir') && pai.to.endsWith('/atribuicoes'))), `${r} → ${pai?.to}`);
	}
	const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/speech-analytics/roleplay/cenarios/12']}><Voltar /></MemoryRouter>);
	assert.match(html, /href="\/speech-analytics\/roleplay\/cenarios"/);
	assert.match(html, /aria-label="Voltar para Cenários"/);
});
