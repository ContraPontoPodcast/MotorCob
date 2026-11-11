// Evolução do treino (Roleplay, SQL 121), renderizada de verdade (react-dom/server), sem banco: indicadores, linha do
// tempo da nota (treino × ligações reais) com "Ver como tabela", mapa por item (itens treinados primeiro, faixas, frase
// de comparação sem julgar), mapa por equipe só na leitura da empresa, linha do tempo por item só na da pessoa, e as
// regras sem tela. Sem ranking: nenhuma nota por pessoa na leitura de empresa ou equipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { EvolucaoView } from './evolucao';
import { MolduraRP } from './moldura';
import { ROTA_RP_EVOLUCAO, secaoRP } from '@/lib/roleplay';
import { rotaPai } from '@/lib/rota-pai';
import {
	linhaTempoItens, mapaEquipes, mapaItens, pct, periodoValido, semanas, seriesNotas, textoComparacao, textoConcordancia, type EvolucaoRP,
} from '@/lib/roleplay-evolucao';

const em = (n: ReactNode, rota = ROTA_RP_EVOLUCAO) => renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}>{n}</MemoryRouter>);
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const INTERNOS = /\bck_[a-z]|bloqueante|treino_[a-z]|operador_ref|SQL \d|ranking/;
const ITENS = { ck_cpc: { texto: 'Confirmou a identidade antes de falar valor', gravidade: 'bloqueante' }, ck_ident: { texto: 'Se identificou', gravidade: 'importante' } };
const EQ = [{ id: 1, nome: 'Equipe Manhã' }, { id: 2, nome: 'Equipe Tarde' }];
const BASE: EvolucaoRP = {
	de: '2026-10-12', ate: '2026-11-10', escopo: 'empresa', pessoas: 6, com_ligacoes: 4,
	treino_itens: [{ semana: '2026-10-26', item: 'ck_cpc', sim: 2, avaliados: 5 }, { semana: '2026-11-02', item: 'ck_cpc', sim: 4, avaliados: 5 },
		{ semana: '2026-11-02', item: 'ck_ident', sim: 9, avaliados: 10 }],
	treino_notas: [{ semana: '2026-10-26', nota: 60, sessoes: 5, na_meta: 1 }, { semana: '2026-11-02', nota: 82, sessoes: 5, na_meta: 4 }],
	real_itens: [{ semana: '2026-11-02', item: 'ck_cpc', sim: 30, avaliados: 40 }, { semana: '2026-11-02', item: 'ck_ident', sim: 1, avaliados: 2 }],
	real_notas: [{ semana: '2026-11-02', nota: 77, ligacoes: 40 }],
	por_equipe: [{ equipe: 1, item: 'ck_cpc', sim: 5, avaliados: 6, pessoas: 3 }, { equipe: 2, item: 'ck_cpc', sim: 1, avaliados: 4, pessoas: 3 }],
	concordancia: { revisados: 8, iguais: 6 }, itens_treinados: ['ck_cpc'], sessoes: null,
};

test('empresa: indicadores, linha do tempo, mapa por item e por equipe, sem nota por pessoa', () => {
	const h = em(<EvolucaoView e={BASE} itens={ITENS} equipes={EQ} />);
	assert.match(h, /Sessões de treino avaliadas/);
	assert.match(h, />10</);
	assert.match(h, /5 chegaram na meta/);
	assert.match(h, /não entra na monitoria/);
	assert.match(h, /Nota média nas ligações/);
	assert.match(h, />77</);
	assert.match(h, /75%/, 'concordância 6 de 8');
	assert.match(h, /role="img" aria-label="Nota média por semana: treino e ligações reais"/);
	assert.match(h, /aria-pressed="false"[^>]*>Ver como tabela/);
	assert.match(h, /Mapa por item/);
	const t = texto(h);
	assert.ok(t.indexOf('Confirmou a identidade') < t.indexOf('Se identificou'), 'itens treinados primeiro');
	assert.match(h, /Treinado/);
	assert.match(h, /Nas ligações, 15 pontos acima do treino\./);
	assert.match(h, /poucas/, 'ligações com 2 avaliações no item: sem porcentagem');
	assert.match(h, /Mapa por item e equipe/);
	assert.match(h, /Equipe Manhã/);
	assert.match(h, /83%/);
	assert.doesNotMatch(h, /Linha do tempo por item/);
	assert.doesNotMatch(t, INTERNOS);
});

test('Ver como tabela, pessoa com linha do tempo por item e estado vazio', () => {
	const tab = em(<EvolucaoView e={BASE} itens={ITENS} equipes={EQ} comoTabela />);
	assert.match(tab, /<th[^>]*>Semana<\/th>/);
	assert.match(tab, /aria-pressed="true"[^>]*>Ver como gráfico/);
	assert.match(tab, /83% \(6\)/);
	const pessoa: EvolucaoRP = {
		...BASE, escopo: 'pessoa', pessoas: 1, com_ligacoes: 1, por_equipe: null,
		sessoes: [{ id: 9, atribuicao: 4, inicio: '2026-10-27T13:00:00Z', modo: 'voz', nota: 50, reprovada: true, cenario: 'Já pagou', itens: { ck_cpc: 'nao', ck_ident: 'sim' } },
			{ id: 11, atribuicao: 4, inicio: '2026-11-03T13:00:00Z', modo: 'texto', nota: 100, reprovada: false, cenario: 'Já pagou', itens: { ck_cpc: 'sim', ck_ident: 'na' } }],
	};
	const h = em(<EvolucaoView e={pessoa} itens={ITENS} equipes={[]} />);
	assert.match(h, /Linha do tempo por item/);
	assert.match(h, /href="\/speech-analytics\/roleplay\/atribuicoes\/4\/sessoes\/9"[^>]*>27\/10/);
	assert.match(h, /<span class="sr-only">não<\/span>/);
	assert.match(h, /<span class="sr-only">não se aplicou<\/span>/);
	assert.doesNotMatch(h, /Mapa por item e equipe/);
	const vazio = em(<EvolucaoView e={{ ...BASE, treino_notas: [], real_notas: [], treino_itens: [], real_itens: [], por_equipe: [] }} itens={ITENS} equipes={EQ} />);
	assert.match(vazio, /Ainda sem dados no período/);
});

test('regras: semanas, séries, mapas, linha do tempo, comparação e concordância', () => {
	assert.deepEqual(semanas('2026-10-14', '2026-10-28'), ['2026-10-12', '2026-10-19', '2026-10-26']);
	const s = seriesNotas(BASE);
	assert.equal(s.x[0], '2026-10-12');
	assert.deepEqual(s.treino.filter(v => v != null), [60, 82]);
	assert.deepEqual(s.real.filter(v => v != null), [77]);
	assert.equal(pct(2, 2), null);
	assert.equal(pct(3, 4), 75);
	const m = mapaItens(BASE, ITENS);
	assert.deepEqual(m.map(l => [l.item, l.treino, l.real, l.treinado]), [['ck_cpc', 60, 75, true], ['ck_ident', 90, null, false]]);
	const q = mapaEquipes(BASE, EQ, ITENS);
	assert.deepEqual(q.equipes.map(x => x.nome), ['Equipe Manhã', 'Equipe Tarde']);
	assert.deepEqual(q.linhas[0].celulas.map(c => c.pct), [83, 25]);
	const lt = linhaTempoItens({ ...BASE, sessoes: [{ id: 1, atribuicao: null, inicio: '2026-11-01T10:00:00Z', modo: 'voz', nota: 70, reprovada: false, cenario: null, itens: { ck_ident: 'sim', ck_cpc: 'nao' } }] }, ITENS);
	assert.deepEqual(lt.linhas.map(l => [l.item, l.respostas[0]]), [['ck_cpc', 'nao'], ['ck_ident', 'sim']], 'item crítico primeiro');
	assert.equal(textoComparacao({ treino: 80, real: 70, nReal: 30, nTreino: 5 }), 'Nas ligações, 10 pontos abaixo do treino: vale reforçar.');
	assert.equal(textoComparacao({ treino: 80, real: 82, nReal: 30, nTreino: 5 }), 'No treino e nas ligações, no mesmo patamar.');
	assert.equal(textoComparacao({ treino: 80, real: null, nReal: 0, nTreino: 5 }), 'Sem ligações reais avaliadas nesse item.');
	assert.deepEqual(textoConcordancia({ revisados: 0, iguais: 0 }), { valor: '—', detalhe: 'nenhum item revisado no período' });
	assert.equal(periodoValido('30'), 30);
	assert.equal(periodoValido('999'), 90);
});

test('rota: Evolução é seção do Roleplay, marcada na sub-navegação, e volta para o Painel', () => {
	assert.equal(secaoRP(ROTA_RP_EVOLUCAO), 'evolucao');
	assert.deepEqual(rotaPai(ROTA_RP_EVOLUCAO), { to: '/speech-analytics/roleplay', rotulo: 'Painel do Roleplay' });
	const h = em(<MolduraRP titulo="Evolução"><p /></MolduraRP>);
	assert.match(h, /aria-current="page"[^>]*>Evolução<\/a>/);
	assert.match(h, /<h1[^>]*>Evolução<\/h1>/);
});
