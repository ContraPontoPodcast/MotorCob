// Roleplay, PR 4 (npm test): regras do editor de cenário (as mesmas dos checks do SQL 90), do "Atribuir treino", do
// lembrete e da página do operador (grupos, pílula, "Isto é treino"), e as rotas novas com o voltar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
	ROTA_RP_ATRIBUICOES, ROTA_RP_ATRIBUIR, cenarioVazio, dadosCenario, formDoCenario, idsDaQuery, mesmoForm, prazoPadrao, rotaAtribuicaoRP, rotaAtribuir,
	rotaBriefing, rotaTreino, secaoRP, textoLembrete, tituloDocumentoRP, tokenValido, trilhaRP, urlTreino, validarAtribuicao, validarCenario,
	type CenarioRP, type FormCenario,
} from './roleplay';
import { gruposMeus, pilulaTreino, podeComecar, tentativasRestantes, textoIstoETreino, type TreinoOperador } from './treino-operador';
import { rotaPai } from './rota-pai';
import { Voltar, estadoDe, origemDoEstado } from '@/components/comuns/voltar';

const ROTAS = readFileSync('src/routes.ts', 'utf8');
const SQL99 = readFileSync('../supabase/migrations/20270210000001_treino_atribuir.sql', 'utf8');

const BOM: FormCenario = {
	...cenarioVazio(), nome: 'Pagou, mas a baixa não caiu', persona_nome: 'Renata (fictícia)', objetivo: 'Diz que pagou e desconfia de golpe.',
	frases: ['Mas eu já paguei isso!'], comportamentos: ['desconfia de golpe'], objecoes: [{ codigo: 'ja_paguei', quando: 'no começo' }], itens_foco: ['ck_cpc'],
};

test('rotas novas: editor, treinos atribuídos, atribuir e a página do operador (fora do app-shell)', () => {
	for (const r of ['speech-analytics/roleplay/cenarios/novo', 'speech-analytics/roleplay/atribuicoes', 'speech-analytics/roleplay/atribuicoes/:id', 'speech-analytics/roleplay/atribuir', 'treino/:token', 'treino/:token/:atr']) {
		assert.ok(ROTAS.includes(`route('${r}'`), r);
	}
	// /cenarios/novo antes de /cenarios/:id (senão "novo" vira id)
	assert.ok(ROTAS.indexOf("'speech-analytics/roleplay/cenarios/novo'") < ROTAS.indexOf("'speech-analytics/roleplay/cenarios/:id'"));
	// a página do operador fica antes dos layouts (sem menu do MotorCX)
	assert.ok(ROTAS.indexOf("route('treino/:token'") < ROTAS.indexOf("layout('routes/workspace-layout.tsx'"));
	assert.equal(secaoRP(ROTA_RP_ATRIBUIR), 'atribuicoes');
	assert.equal(secaoRP(rotaAtribuicaoRP(3)), 'atribuicoes');
	assert.deepEqual(trilhaRP(ROTA_RP_ATRIBUIR).map(i => i.rotulo), ['Speech Analytics', 'Roleplay', 'Treinos atribuídos', 'Atribuir treino']);
	assert.deepEqual(trilhaRP('/speech-analytics/roleplay/cenarios/novo').map(i => i.rotulo).slice(-1), ['Novo cenário']);
	assert.equal(tituloDocumentoRP(rotaAtribuicaoRP(3), 'Já pagou'), 'Já pagou · Treinos atribuídos · Roleplay · MotorCX');
	assert.deepEqual(rotaPai(rotaAtribuicaoRP(3)), { to: ROTA_RP_ATRIBUICOES, rotulo: 'Treinos atribuídos' });
	assert.deepEqual(rotaPai(ROTA_RP_ATRIBUIR), { to: ROTA_RP_ATRIBUICOES, rotulo: 'Treinos atribuídos' });
	assert.equal(rotaAtribuir({ cen: 4, ops: [1, 2], sug: 9 }), `${ROTA_RP_ATRIBUIR}?cen=4&ops=1%2C2&sug=9`);
	assert.deepEqual(idsDaQuery('1,2,x,2,003'), [1, 2, 3]);
	assert.equal(rotaTreino('a'.repeat(64)), `/treino/${'a'.repeat(64)}`);
	assert.equal(rotaBriefing('b'.repeat(64), 7), `/treino/${'b'.repeat(64)}/7`);
	assert.ok(tokenValido('0123456789abcdef'.repeat(4)));
	assert.ok(!tokenValido('XYZ') && !tokenValido(null) && !tokenValido('0'.repeat(63)));
	assert.equal(urlTreino('https://motorcob.online/', 'c'.repeat(64)), `https://motorcob.online/treino/${'c'.repeat(64)}`);
});

test('voltar: aberto de outra tela do app (state.de), volta para ela pelo histórico; sem origem, vai para a tela-mãe', () => {
	assert.deepEqual(origemDoEstado(estadoDe('/speech-analytics/roleplay/operadores/7', 'Bia R.')), { de: '/speech-analytics/roleplay/operadores/7', deRotulo: 'Bia R.' });
	assert.equal(origemDoEstado({ de: 'https://fora', deRotulo: 'x' }), null, 'só caminho interno');
	assert.equal(origemDoEstado(null), null);
	const com = renderToStaticMarkup(<MemoryRouter initialEntries={[{ pathname: rotaAtribuicaoRP(3), state: estadoDe('/speech-analytics/roleplay/operadores/7', 'Bia R.') }]}><Voltar /></MemoryRouter>);
	assert.match(com, /<button[^>]*aria-label="Voltar para Bia R\."/);
	const sem = renderToStaticMarkup(<MemoryRouter initialEntries={[rotaAtribuicaoRP(3)]}><Voltar /></MemoryRouter>);
	assert.match(sem, /aria-label="Voltar para Treinos atribuídos"/);
	assert.match(sem, /href="\/speech-analytics\/roleplay\/atribuicoes"/);
});

test('editor: as mesmas regras do banco (persona fictícia, sem CPF/telefone/e-mail, limites)', () => {
	assert.deepEqual(validarCenario(BOM), {});
	assert.ok(validarCenario({ ...BOM, persona_nome: 'Maria Souza' }).persona_nome, 'sem “(fictícia)”');
	assert.ok(validarCenario({ ...BOM, persona_nome: 'Ana 2 (fictícia)' }).persona_nome, 'com número');
	assert.ok(validarCenario({ ...BOM, frases: ['Me liga no (11) 98765-4321'] }).frases, 'telefone numa frase');
	assert.ok(validarCenario({ ...BOM, comportamentos: ['manda e-mail para a@b.com'] }).comportamentos, 'e-mail');
	assert.ok(validarCenario({ ...BOM, nome: 'Ab' }).nome);
	assert.ok(validarCenario({ ...BOM, objetivo: 'curto' }).objetivo);
	assert.ok(validarCenario({ ...BOM, dias_atraso: '0' }).dias_atraso);
	assert.ok(validarCenario({ ...BOM, desconto_max: '120' }).desconto_max);
	assert.ok(validarCenario({ ...BOM, duracao_min: '16' }).duracao_min, 'máx. 15 min');
	assert.ok(validarCenario({ ...BOM, modos: [] }).modos);
	assert.ok(validarCenario({ ...BOM, frases: Array.from({ length: 21 }, (_, i) => `Frase ${i}`) }).frases);
	assert.ok(validarCenario({ ...BOM, objecoes: [{ codigo: 'X Y', quando: '' }] }).objecoes);
});

test('editor: o pacote de salvar_cenario_treino só com os campos que o banco aceita, e a ida e volta do formulário', () => {
	const d = dadosCenario({ ...BOM, descricao: '  ', parcelas: '12', desconto_max: '0', duracao_min: '10', frases: [' a ', ''] }, 'publicado');
	const aceitos = ['codigo', 'nome', 'persona_nome', 'perfil', 'descricao', 'objetivo', 'comportamentos', 'frases', 'objecoes', 'dificuldade', 'divida', 'voz_tts', 'duracao_max_s', 'modos', 'itens_foco', 'objetivo_cenario', 'situacao', 'origem', 'insights'];
	for (const k of Object.keys(d)) assert.ok(aceitos.includes(k), k);
	assert.equal(d.duracao_max_s, 600);
	assert.deepEqual(d.divida, { produto: 'Cartão Exemplo', faixa: '1k_5k', dias_atraso: 60, alcada: { parcelas: 12, desconto_max: 0 } });
	assert.deepEqual(d.frases, ['a']);
	assert.deepEqual(d.objecoes, [{ codigo: 'ja_paguei', quando: 'no começo' }]);
	assert.equal(d.situacao, 'publicado');
	const c = { id: 2, empresa_id: 9, base_id: null, ...d, descricao: null, objetivo_cenario: null, situacao: 'rascunho', origem: 'manual' } as unknown as CenarioRP;
	const f = formDoCenario(c);
	assert.equal(f.duracao_min, '10');
	assert.equal(f.parcelas, '12');
	assert.ok(mesmoForm(f, formDoCenario(c)));
	assert.ok(!mesmoForm(f, { ...f, nome: 'Outro' }), 'qualquer mudança deixa o formulário "não salvo"');
});

test('atribuir: as regras de atribuir_treino (cenário, 1 a 200 pessoas, prazo até 180 dias, meta, modo do cenário)', () => {
	const hoje = '2026-11-10';
	assert.equal(prazoPadrao(hoje), '2026-11-17');
	const ok = { cenario: 1, operadores: [7], prazo: '2026-11-20', meta: '75', tentativas: '2', modos: ['texto'] };
	assert.deepEqual(validarAtribuicao(ok, hoje, ['voz', 'texto']), {});
	assert.ok(validarAtribuicao({ ...ok, cenario: null }, hoje, null).cenario);
	assert.ok(validarAtribuicao({ ...ok, operadores: [] }, hoje, null).operadores);
	assert.ok(validarAtribuicao({ ...ok, prazo: '2026-11-09' }, hoje, null).prazo, 'no passado');
	assert.ok(validarAtribuicao({ ...ok, prazo: '2027-06-01' }, hoje, null).prazo, 'mais de 180 dias');
	assert.ok(validarAtribuicao({ ...ok, meta: '101' }, hoje, null).meta);
	assert.ok(validarAtribuicao({ ...ok, modos: ['voz'] }, hoje, ['texto']).modos, 'modo que o cenário não tem');
	assert.deepEqual(validarAtribuicao({ ...ok, tentativas: '' }, hoje, null), {}, 'sem limite de tentativas');
});

test('lembrete: pronto para colar, sem contato do operador; com o link só quando ele está à mão', () => {
	const sem = textoLembrete({ apelido: 'Bia R.', cenario: 'Já pagou', prazo: '2026-11-14', meta: 75, tentativas: '2 tentativas' });
	assert.match(sem, /^Oi, Bia! Lembrete do treino “Já pagou”: o prazo é 14\/11 e a meta é 75\. Você tem 2 tentativas\./);
	assert.match(sem, /não entra na sua monitoria/);
	assert.match(sem, /Abra o seu link de treino/);
	const com = textoLembrete({ apelido: 'Bia R.', cenario: 'Já pagou', prazo: '2026-11-14', meta: 75, url: 'https://motorcob.online/treino/abc' });
	assert.match(com, /Seu link de treino: https:\/\/motorcob\.online\/treino\/abc$/);
});

const T = (x: Partial<TreinoOperador>): TreinoOperador => ({
	atribuicao: 1, prazo: '2026-11-14', nota_minima: 75, modos: ['voz', 'texto'], tentativas: 2, tentativas_usadas: 0, melhor_nota: null, situacao: 'nao_comecou',
	cenario: { id: 1, nome: 'Já pagou', persona_nome: 'Rita (fictícia)', perfil: 'ja_pagou', descricao: null, dificuldade: 2, divida: {}, duracao_max_s: 480, modos: ['voz', 'texto'], objetivo_cenario: null, itens_foco: [] },
	sessoes: [], ...x,
});

test('operador: grupos de "Meus treinamentos", pílula formativa e "Isto é treino"', () => {
	const hoje = '2026-11-10';
	const g = gruposMeus([
		T({ atribuicao: 1 }), T({ atribuicao: 2, situacao: 'aprovado', melhor_nota: 88 }), T({ atribuicao: 3, situacao: 'precisa_apoio', tentativas_usadas: 2 }),
		T({ atribuicao: 4, prazo: '2026-11-01', situacao: 'prazo_vencido' }), T({ atribuicao: 5, prazo: '2026-11-12', situacao: 'abaixo_meta', tentativas_usadas: 1, melhor_nota: 60 }),
	], hoje);
	assert.deepEqual(g.fazer.map(t => t.atribuicao), [5, 1], 'prazo mais próximo primeiro');
	assert.deepEqual(g.aguardando.map(t => t.atribuicao), [4, 3]);
	assert.deepEqual(g.feitos.map(t => t.atribuicao), [2]);
	assert.equal(pilulaTreino(T({ situacao: 'abaixo_meta', tentativas_usadas: 1 }), hoje).texto, 'Ainda não chegou na meta (75) · 1 tentativa até 14/11');
	assert.equal(pilulaTreino(T({ situacao: 'precisa_apoio', tentativas_usadas: 2 }), hoje).texto, 'Você usou as 2 tentativas');
	assert.equal(pilulaTreino(T({ situacao: 'aprovado', melhor_nota: 88 }), hoje).texto, 'Chegou na meta · melhor nota 88');
	assert.equal(tentativasRestantes(T({ tentativas: null })), null);
	assert.ok(podeComecar(T({}), hoje) && !podeComecar(T({ situacao: 'precisa_apoio' }), hoje) && !podeComecar(T({ prazo: '2026-11-09' }), hoje));
	const isto = textoIstoETreino(T({}));
	assert.match(isto, /não entra na sua monitoria/);
	assert.match(isto, /Sair no meio não conta como tentativa/);
	for (const t of [isto, ...['abaixo_meta', 'precisa_apoio', 'aprovado'].map(s => pilulaTreino(T({ situacao: s, tentativas_usadas: 1 }), hoje).texto)]) {
		assert.doesNotMatch(t, /reprovad/i, 'tom formativo: nunca "reprovado"');
	}
});

test('SQL 99: policy de voz_operadores aceita quem treina e treino_estado_link só devolve estado e validade', () => {
	assert.match(SQL99, /create policy voz_operadores_ver[\s\S]*cliente_pode\(empresa_id, 'treinar_operadores'\)/);
	assert.match(SQL99, /grant execute on function public\.treino_estado_link\(text\) to anon, authenticated/);
	assert.doesNotMatch(SQL99.split('create or replace function public.treino_estado_link')[1].split('$$;')[0], /apelido|operador_id', |'empresa/);
});
