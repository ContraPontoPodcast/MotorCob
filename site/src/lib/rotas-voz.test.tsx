// Agente Voz/CX e Speech Analytics (npm test): rotas novas declaradas, endereços antigos redirecionando para o lugar
// novo (com query), menu e área de cada rota, ⌘K e atalhos do Assistente sem endereço antigo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANTIGAS_PARA_NOVAS, destinoRedirecionamento, rotaNova } from './rotas-voz';
import { areaDaRota, areaDoContrato, areaTemaDeRota, AREA_DESTINO } from './area-rota';
import { ABAS, abaAtiva } from './abas';
import { AREA_ICON } from './area-icones';
import { ROTA_TESTAR_PERSONAS } from './speech';
import { rotaDaAcao } from './assistente';
import { ATALHOS } from '@/components/workspace/workspace-command-palette';

const routesTs = readFileSync('src/routes.ts', 'utf8');
/** rota declarada → arquivo. */
const rotas = new Map([...routesTs.matchAll(/route\('([^']+)',\s*'([^']+)'/g)].map(m => [`/${m[1]}`, m[2]]));
const padrao = (r: string) => new RegExp(`^${r.split('/').filter(Boolean).map(seg => (seg.startsWith(':') ? (seg.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+') : `/${seg}`)).join('')}$`);
/** Caminho concreto → rota declarada que o abre (a exata ganha da com parâmetro, como no React Router). */
function rotaDe(caminho: string): string | undefined {
	if (rotas.has(caminho)) return caminho;
	// Entre as com parâmetro, a mais específica (menos parâmetros), como o ranking do React Router.
	const params = (r: string) => (r.match(/\/:/g) ?? []).length;
	return [...rotas.keys()].filter(r => r.includes('/:') && padrao(r).test(caminho)).sort((a, b) => params(a) - params(b))[0];
}
const arquivo = (caminho: string) => readFileSync(`src/${rotas.get(rotaDe(caminho) ?? '')}`, 'utf8');
const ehRedirecionamento = (caminho: string) => /RedirecionarRotaAntiga/.test(arquivo(caminho));

const NOVAS = ['/voz', '/voz/agente', '/voz/agente/roteiro', '/voz/agente/editor/7', '/voz/agente/testar', '/voz/agente/desempenho',
	'/voz/agente/pedido/3', '/voz/agente/personas', '/voz/discagem', '/voz/ligacoes', '/voz/ligacoes/9', '/voz/telefonia',
	'/speech-analytics', '/speech-analytics/qualidade', '/speech-analytics/gravacoes', '/speech-analytics/entrada', '/speech-analytics/entrada/enviar'];

/** Antes → depois (SPEC Canais §4.1). */
const TABELA: [string, string][] = [
	['/canais/agente-virtual', '/voz/agente'],
	['/canais/agente-virtual/editor/12', '/voz/agente/editor/12'],
	['/canais/agente-virtual/testar', '/voz/agente/testar'],
	['/canais/agente-virtual/desempenho', '/voz/agente/desempenho'],
	['/canais/agente-virtual/personas', '/voz/agente/personas'],
	['/canais/agente-virtual/pedido/5', '/voz/agente/pedido/5'],
	['/canais/agente-virtual/roteiro', '/voz/agente/roteiro'],
	['/discagem', '/voz/discagem'],
	['/mensageria/voz/lotes', '/voz/ligacoes'],
	['/mensageria/voz/lotes/31', '/voz/ligacoes/31'],
	['/gravacoes', '/speech-analytics/gravacoes'],
	['/envios/gravacoes-discador', '/speech-analytics/entrada'],
	['/envios/gravacoes-discador/enviar', '/speech-analytics/entrada/enviar'],
	['/insights-voz', '/speech-analytics'],
	['/voz/conexao', '/voz/telefonia'],
];

test('toda rota nova está declarada e abre uma tela (não um redirecionamento)', () => {
	for (const r of NOVAS) {
		assert.ok(rotaDe(r), `rota nova sem declaração: ${r}`);
		assert.ok(!ehRedirecionamento(r), `rota nova redireciona: ${r}`);
	}
	assert.equal(rotaDe('/speech-analytics/gravacoes'), '/speech-analytics/gravacoes', 'Gravações não cai na aba genérica');
	assert.equal(rotaDe('/speech-analytics/entrada'), '/speech-analytics/entrada');
});

test('endereço antigo → novo: a tabela da SPEC, com o antigo declarado e redirecionando', () => {
	for (const [antes, depois] of TABELA) {
		assert.equal(rotaNova(antes), depois, antes);
		assert.ok(rotaDe(antes), `rota antiga sem declaração: ${antes}`);
		assert.ok(ehRedirecionamento(antes), `rota antiga não redireciona: ${antes}`);
		assert.ok(rotaDe(depois) && !ehRedirecionamento(depois), `destino não abre tela: ${antes} → ${depois}`);
	}
	for (const [antiga] of ANTIGAS_PARA_NOVAS) assert.ok(TABELA.some(([a]) => a === antiga), `fora da tabela: ${antiga}`);
	assert.equal(rotaNova('/discagem/'), '/voz/discagem', 'barra no fim');
	for (const r of ['/canais', '/canais/agente', '/gravacoes-x', '/voz/agente', '/speech-analytics', '/console/voz']) assert.equal(rotaNova(r), null, r);
	assert.equal(destinoRedirecionamento('/gravacoes', '?cliente=CLI-1', '#x'), '/speech-analytics/gravacoes?cliente=CLI-1#x');
});

test('áreas: Agente Voz/CX e Speech Analytics têm rota, tema, ícone, destino e vêm com a Cobrança', () => {
	for (const r of ['/voz', '/voz/agente/testar', '/voz/discagem', '/discagem', '/canais/agente-virtual', '/mensageria/voz/lotes/3']) assert.equal(areaDaRota(r), 'voz', r);
	for (const r of ['/speech-analytics', '/speech-analytics/gravacoes', '/gravacoes', '/insights-voz', '/envios/gravacoes-discador']) assert.equal(areaDaRota(r), 'speech', r);
	for (const r of ['/canais', '/envios', '/orquestracao']) assert.equal(areaDaRota(r), 'cobranca', r);
	assert.equal(areaDaRota('/mensageria/sms/lotes'), 'mensageria');
	assert.equal(areaTemaDeRota('/voz'), 'voz');
	assert.equal(areaTemaDeRota('/speech-analytics'), 'speech');
	assert.equal(AREA_DESTINO.voz, '/voz');
	assert.equal(AREA_DESTINO.speech, '/speech-analytics');
	assert.notEqual(AREA_ICON.voz, AREA_ICON.cobranca);
	assert.notEqual(AREA_ICON.speech, AREA_ICON.cobranca);
	assert.equal(areaDoContrato('voz'), 'cobranca');
	assert.equal(areaDoContrato('speech'), 'cobranca');
	assert.equal(areaDoContrato('relatorios'), null);
});

test('menu: abas novas existem, ficam ativas na rota certa e saíram da Cobrança e da Mensageria', () => {
	const voz = ABAS.voz!.grupos.flatMap(g => g.abas);
	const speech = ABAS.speech!.grupos.flatMap(g => g.abas);
	assert.deepEqual(voz.map(a => a.nome), ['Visão geral', 'Agente de voz', 'Discagem', 'Ligações', 'Telefonia']);
	assert.deepEqual(speech.map(a => a.nome), ['Visão geral', 'Gravações', 'Entrada de gravações']);
	for (const a of [...voz, ...speech]) assert.ok(rotaDe(a.to.split('?')[0]) && !ehRedirecionamento(a.to), a.to);
	const ativa = (abas: typeof voz, p: string) => abas.filter(a => abaAtiva(a, p, '')).map(a => a.nome);
	assert.deepEqual(ativa(voz, '/voz'), ['Visão geral']);
	assert.deepEqual(ativa(voz, '/voz/agente/editor/3'), ['Agente de voz']);
	assert.deepEqual(ativa(voz, '/voz/ligacoes/3'), ['Ligações']);
	assert.deepEqual(ativa(speech, '/speech-analytics/alertas'), ['Visão geral']);
	assert.deepEqual(ativa(speech, '/speech-analytics/gravacoes'), ['Gravações']);
	assert.deepEqual(ativa(speech, '/speech-analytics/entrada/enviar'), ['Entrada de gravações']);
	const resto = [...ABAS.cobranca!.grupos, ...ABAS.mensageria!.grupos].flatMap(g => g.abas).map(a => a.to);
	for (const velho of ['/discagem', '/gravacoes', '/speech-analytics', '/mensageria/voz/lotes']) assert.ok(!resto.includes(velho), velho);
});

test('⌘K, Assistente e Testar com personas apontam para os endereços novos', () => {
	const velhos = ANTIGAS_PARA_NOVAS.map(([a]) => a);
	for (const a of ATALHOS) assert.ok(!rotaNova(a.to.split('?')[0]), `atalho com endereço antigo: ${a.label} → ${a.to}`);
	for (const id of ['discagem', 'agente-virtual', 'ligacoes-voz', 'telefonia', 'speech', 'gravacoes', 'entrada-gravacoes']) assert.ok(ATALHOS.some(a => a.id === id), id);
	assert.equal(ROTA_TESTAR_PERSONAS, '/voz/agente/personas');
	assert.equal(rotaDaAcao('abrir_regras_discagem', []), '/voz/discagem');
	assert.equal(rotaDaAcao('abrir_agente_virtual', []), '/voz/agente');
	const sem = { cobranca: false, jornada: true, mensageria: true };
	assert.equal(rotaDaAcao('abrir_regras_discagem', [], undefined, sem), null, 'sem Cobrança não leva ao Agente Voz/CX');
	assert.ok(velhos.length > 0);
});
