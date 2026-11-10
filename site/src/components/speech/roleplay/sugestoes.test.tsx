// Sugestões de atribuição (Roleplay, SQL 120), renderizadas de verdade (react-dom/server), sem banco: o texto de cada
// regra em linguagem de monitoria, a evidência só com contagens (nunca trecho, cliente ou gravação), prioridade alta do
// item crítico repetido (que também entra em "Precisa de ação" com "Atribuir treino"), "Atribuir treino" pela sugestão e
// "Dispensar" com o motivo em 1 clique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { CartaoSugestao, PainelView } from './painel';
import type { DadosPainel } from './dados';
import { MOTIVO_DISPENSA, REGRA_SUGESTAO, precisaDeAcao, textoSugestao, type OperadorRP, type SugestaoRP } from '@/lib/roleplay';

const em = (n: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={['/speech-analytics/roleplay']}>{n}</MemoryRouter>);
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const INTERNOS = /\bck_[a-z]|item_reprovado|nota_baixa|alerta_subiu|idade_confusao|treino_[a-z]|job noturno|cluster|SQL \d/;
const OPS: OperadorRP[] = [
	{ id: 100, apelido: 'Bia R.', equipe_id: 1, operador_ref: 'OP-1', so_treino: false, ativo: true },
	{ id: 101, apelido: 'Caio M.', equipe_id: 1, operador_ref: 'OP-2', so_treino: false, ativo: true },
	{ id: 102, apelido: 'Duda S.', equipe_id: 2, operador_ref: 'OP-3', so_treino: false, ativo: true },
	{ id: 103, apelido: 'Edu P.', equipe_id: 2, operador_ref: 'OP-4', so_treino: false, ativo: true },
];
const EQ = [{ id: 1, nome: 'Equipe Manhã', ativo: true }, { id: 2, nome: 'Equipe Tarde', ativo: true }];
const ITENS = { ck_cpc: { texto: 'Confirmou a identidade antes de falar valor', gravidade: 'bloqueante' } };
const CTX = { operadores: OPS, equipes: EQ, itens: ITENS };
const S = (x: Partial<SugestaoRP>): SugestaoRP => ({ id: 1, regra: 'item_reprovado', cenario_id: null, operadores: [100, 101, 102], criado_em: '2026-11-09T05:40:00Z', ...x });

test('cada regra vira um título de monitoria com as contagens que a geraram', () => {
	const r1 = textoSugestao(S({ evidencia: { item: 'ck_cpc', operadores: 3, avaliadas: 40, nao: 9, de: '2026-11-02', ate: '2026-11-08' } }), CTX);
	assert.equal(r1.titulo, '“Confirmou a identidade antes de falar valor” com “não” em 3 operadores');
	assert.equal(r1.quem, 'Bia R., Caio M., Duda S.');
	assert.deepEqual(r1.evidencia, ['9 “não” em 40 ligações avaliadas nesse item', 'Período: de 02/11 a 08/11']);
	assert.equal(r1.prioridade, 'normal');
	const r5 = textoSugestao(S({ regra: 'nota_baixa', operadores: [103], evidencia: { nota_media: 61.5, ligacoes: 12, item: 'ck_cpc' } }), CTX);
	assert.equal(r5.titulo, 'Edu P.: nota média 61,5 nas ligações');
	assert.equal(r5.aba, 'operadores');
	const r3 = textoSugestao(S({ regra: 'item_critico_operador', operadores: [100], evidencia: { item: 'ck_cpc', vezes: 2 } }), CTX);
	assert.equal(r3.prioridade, 'alta');
	assert.match(r3.titulo, /Bia R\.: item crítico “Confirmou a identidade antes de falar valor” com “não” 2 vezes/);
	const r2 = textoSugestao(S({ regra: 'alerta_subiu', evidencia: { alerta: 'procon', equipe: 2, semana: 4, semana_anterior: 1 } }), CTX);
	assert.equal(r2.titulo, 'Alertas de ameaça de Procon subiram na Equipe Tarde');
	assert.deepEqual(r2.evidencia, ['4 nesta semana × 1 na anterior']);
	assert.equal(r2.aba, 'alertas');
	const r4 = textoSugestao(S({ regra: 'vulnerabilidade', evidencia: { sinal: 'idade_confusao', equipe: 1, alertas: 3 } }), CTX);
	assert.equal(r4.titulo, 'Sinais de pessoa idosa ou com dificuldade de entender na Equipe Manhã');
	assert.equal(textoSugestao(S({ operadores: [100, 101, 102, 103, 999] }), CTX).quem, 'Bia R., Caio M., Duda S. e mais 1');
	assert.ok(REGRA_SUGESTAO.nota_baixa);
	assert.deepEqual(Object.values(MOTIVO_DISPENSA), ['Já tratei no 1:1', 'Não procede']);
});

const D: Pick<DadosPainel, 'operadores' | 'equipes' | 'itens' | 'cenarios'> = {
	operadores: OPS, equipes: EQ, itens: ITENS,
	cenarios: [{ id: 7, empresa_id: null, base_id: null, nome: 'Terceiro atende', persona_nome: 'Ivo (fictício)', perfil: 'terceiro_atende', descricao: null, objetivo: 'x', comportamentos: [], frases: [], objecoes: [], dificuldade: 2, divida: {}, duracao_max_s: 480, modos: ['voz', 'texto'], itens_foco: ['ck_cpc'], objetivo_cenario: null, situacao: 'publicado', origem: 'padrao', atualizado_em: '2026-11-01T00:00:00Z' }],
};

test('cartão: Atribuir pela sugestão, Ver a evidência (só contagens e o atalho para o Speech) e Dispensar', () => {
	const fechado = em(<CartaoSugestao s={S({ cenario_id: 7, evidencia: { item: 'ck_cpc', operadores: 3, avaliadas: 40, nao: 9 } })} d={D} onDispensar={() => {}} />);
	assert.match(fechado, /href="\/speech-analytics\/roleplay\/atribuir\?sug=1"[^>]*>Atribuir treino/);
	assert.match(fechado, /cenário sugerido: <a[^>]*href="\/speech-analytics\/roleplay\/cenarios\/7"[^>]*>Terceiro atende/);
	assert.match(fechado, /aria-expanded="false"[^>]*>Ver a evidência/);
	assert.match(fechado, />Dispensar<\/button>/);
	assert.doesNotMatch(fechado, /De onde veio/);
	const aberto = em(<CartaoSugestao aberto s={S({ evidencia: { item: 'ck_cpc', operadores: 3, avaliadas: 40, nao: 9 } })} d={D} />);
	assert.match(aberto, /De onde veio/);
	assert.match(aberto, /9 “não” em 40 ligações avaliadas/);
	assert.match(aberto, /nenhum trecho, cliente ou gravação entra/);
	assert.match(aberto, /href="\/speech-analytics\/qualidade"[^>]*>Abrir Speech › Qualidade/);
	assert.match(aberto, /sem cenário com esse foco: escolha ao atribuir/);
	assert.doesNotMatch(aberto, />Dispensar</, 'sem permissão de dispensar, sem o botão');
	assert.doesNotMatch(texto(aberto), INTERNOS);
});

test('Painel: item crítico repetido primeiro, com prioridade alta, e também em "Precisa de ação"', () => {
	const d: DadosPainel = {
		...D, atribuicoes: [], pessoas: [], sessoes: [], links: [], discordancias: [], uso: null,
		sugestoes: [S({ id: 1 }), S({ id: 2, regra: 'alerta_subiu', evidencia: { alerta: 'juridico', equipe: 1, semana: 3, semana_anterior: 0 } }),
			S({ id: 3, regra: 'item_critico_operador', operadores: [102], evidencia: { item: 'ck_cpc', vezes: 3 } })],
	};
	const h = em(<PainelView d={d} hoje="2026-11-10" desde="2026-10-12" onDispensar={async () => {}} />);
	const t = texto(h);
	assert.ok(t.indexOf('Duda S.: item crítico') > 0 && t.indexOf('Duda S.: item crítico') < t.indexOf('Item do checklist com'), 'a de prioridade alta primeiro');
	assert.match(h, /Prioridade alta/);
	assert.match(h, /Ver todas \(3\)/);
	assert.match(h, /Duda S\. ficou “não” no item crítico “Confirmou a identidade antes de falar valor” em ligações reais mais de uma vez/);
	assert.match(h, /href="\/speech-analytics\/roleplay\/atribuir\?sug=3"/);
	assert.doesNotMatch(t, INTERNOS);
	const acoes = precisaDeAcao({ ...d, operadores: OPS, itens: ITENS, hoje: '2026-11-10' });
	assert.deepEqual(acoes.map(a => [a.tipo, a.sugestao_id]), [['sugestao', 3]]);
});
