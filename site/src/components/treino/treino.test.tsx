// Sessão por texto e resultado formativo (Roleplay, SQL 100), renderizados de verdade (react-dom/server), sem rede:
// estados da sessão (ligando, ligação ativa com "Encerrar ligação" vermelho, cliente desligou com "Ver meu resultado",
// avaliando), resultado na ordem formativa (item crítico no topo → fez bem → para treinar → não se aplicou), "Discordo
// deste ponto" só em item "não", "Revisar avaliação" e discordâncias do lado da Qualidade, e as regras sem tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { SessaoView, type FichaSessao } from './sessao';
import { ResultadoView } from './resultado';
import { BriefingView, ResultadoOperadorView } from './pagina';
import {
	organizarResultado, pilulaResultado, relogio, rotaResultadoOperador, rotaSessaoOperador, textoEncerramento, validarDiscordancia,
	type ResultadoTreino,
} from '@/lib/treino-sessao';
import { rotaLadoALadoRP, rotaSessaoRP, rotaTesteRP, rotaTestarRP, trilhaRP } from '@/lib/roleplay';
import { rotaPai } from '@/lib/rota-pai';
import type { TreinoOperador } from '@/lib/treino-operador';

const nada = () => {};
const em = (rota: string, n: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}>{n}</MemoryRouter>);
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ');
const INTERNOS = /bloqueante|ja_pagou|ja_paguei|\bck_[a-z]|treino_[a-z]|SQL \d|\[DESLIGA\]/;
const TOKEN = 'e'.repeat(64);
const FICHA: FichaSessao = { cenario: 'Já pagou', persona: 'Rita (fictícia)', divida: { produto: 'Cartão Exemplo', dias_atraso: 60, alcada: { parcelas: 6, desconto_max: 20 } }, foco: ['Confirmou a identidade antes de falar valor'] };
const TURNOS = [{ quem: 'persona' as const, texto: 'Alô?' }, { quem: 'operador' as const, texto: 'Boa tarde, falo da Assessoria Exemplo.' }, { quem: 'persona' as const, texto: 'Mas eu já paguei isso!' }];
const view = (fase: Parameters<typeof SessaoView>[0]['fase'], extra: Partial<Parameters<typeof SessaoView>[0]> = {}) => renderToStaticMarkup(
	<SessaoView ficha={FICHA} turnos={TURNOS} fase={fase} segundos={65} duracao={480} saldo="R$ 2.340,00" texto="" enviando={false} erro="" quem="operador"
		onTexto={nada} onEnviar={nada} onEncerrarLigacao={nada} onVerResultado={nada} onSair={nada} {...extra} />);

test('sessão: tela cheia sem menu, ficha fictícia, relógio, conversa e "Encerrar ligação" só com a ligação ativa', () => {
	const h = view('ligacao');
	assert.match(h, /class="fixed inset-0/);
	assert.match(h, /<h1[^>]*>Já pagou<\/h1>/);
	assert.match(h, /Cliente simulada: Rita \(fictícia\)/);
	assert.match(h, /saldo R\$ 2\.340,00/);
	assert.match(h, /alçada: até 6x · desconto até 20%/);
	assert.match(h, /01:05 \/ 08:00/);
	assert.match(h, /role="log"/);
	assert.match(h, /Mas eu já paguei isso!/);
	assert.match(h, /<label[^>]*for="fala-treino"/);
	assert.match(h, />Encerrar ligação</);
	assert.match(h, />Sair</);
	assert.doesNotMatch(h, /Ver meu resultado/);
	assert.doesNotMatch(texto(h), INTERNOS);
	const desl = view('desligou');
	assert.match(desl, /A cliente desligou\./);
	assert.match(desl, />Ver meu resultado</, 'o cliente desligou: o botão principal leva ao resultado');
	assert.doesNotMatch(desl, /Encerrar ligação|fala-treino/, 'sem botão vermelho nem caixa de texto depois que desligou');
	assert.match(view('tempo'), /O tempo da ligação acabou\./);
	assert.match(view('avaliando'), /Avaliando a conversa pelo checklist/);
	assert.match(view('desligou', { quem: 'qualidade' }), />Ver o resultado</);
	assert.match(view('ligacao', { erro: 'O cliente simulado não respondeu agora.' }), /role="alert"[\s\S]*não respondeu agora/);
	assert.match(view('carregando', { turnos: [] }), /Ligando para Rita \(fictícia\)/);
});

const R: ResultadoTreino = {
	sessao: 9, situacao: 'avaliada', modo: 'texto', inicio: '2026-11-10T13:00:00Z', duracao_s: 140, nota: 60, reprovada: true, item_reprovado: 'ck_cpc',
	objetivo_ok: false, nota_minima: 75,
	itens: [
		{ id: 'ck_ident', resposta: 'sim', texto: 'Se identificou', gravidade: 'importante', evidencia: [4, 9], revisado: null },
		{ id: 'ck_cpc', resposta: 'nao', texto: 'Confirmou a identidade antes de falar valor', gravidade: 'bloqueante', evidencia: [15, 20], revisado: null },
		{ id: 'ck_oferta', resposta: 'nao', texto: 'Ofereceu condição', gravidade: 'importante', evidencia: null, revisado: 'sim' },
		{ id: 'ck_resumo', resposta: 'na', texto: 'Resumiu o combinado', gravidade: 'boa_pratica', evidencia: null, revisado: null },
	],
	feedback: [{ item: 'ck_cpc', trecho: 'O valor é R$ 2.300.', dica: 'Antes do valor, confirme com quem fala.' }],
	transcricao: TURNOS, discordancias: [{ id: 3, item: 'ck_cpc', texto: 'Eu confirmei no começo.', resolvida: false }],
};

test('resultado do operador: item crítico no topo, depois fez bem, para treinar (trecho + o que dizer) e não se aplicou', () => {
	const h = em('/x', <ResultadoView r={R} quem="operador" restantes={1} prazo="2026-11-14" onDiscordar={async () => {}} />);
	const t = texto(h);
	const i = (s: string) => t.indexOf(s);
	assert.ok(i('Item crítico com “não”:') > -1 && i('Item crítico com “não”:') < i('O que você fez bem'), 'faixa do item crítico no topo');
	assert.ok(i('O que você fez bem') < i('Para treinar') && i('Para treinar') < i('Não se aplicou nesta conversa'));
	assert.match(h, /Ainda não chegou na meta \(75\) · 1 tentativa até 14\/11/);
	assert.match(t, /Você disse:\s+“O valor é R\$ 2\.300\.”/);
	assert.match(t, /O que dizer:\s+Antes do valor, confirme com quem fala\./);
	assert.match(t, /Você discordou:\s+“Eu confirmei no começo\.”/, 'a discordância já enviada aparece no item');
	assert.match(h, /Revisado pela Qualidade/, 'a revisão da Qualidade vale: "Ofereceu condição" foi para o que fez bem');
	assert.ok(i('Ofereceu condição') < i('Para treinar'));
	assert.match(h, /Objetivo da ligação ainda não cumprido/);
	assert.doesNotMatch(t, /reprovad/i);
	assert.doesNotMatch(t, INTERNOS);
	const semDisc = em('/x', <ResultadoView r={{ ...R, discordancias: [] }} quem="operador" onDiscordar={async () => {}} />);
	assert.equal((semDisc.match(/>Discordo deste ponto</g) ?? []).length, 1, 'só no item "não" (o revisado para "sim" não tem)');
	const esgotou = em('/x', <ResultadoView r={{ ...R, reprovada: false, item_reprovado: null }} quem="operador" restantes={0} />);
	assert.match(esgotou, /Você usou as tentativas deste treino\.[\s\S]*A Qualidade vai combinar com você o próximo passo/);
	const meta = em('/x', <ResultadoView r={{ ...R, nota: 90, reprovada: false, item_reprovado: null }} quem="operador" restantes={1} />);
	assert.match(meta, /Chegou na meta \(75\)/);
	assert.match(em('/x', <ResultadoView r={{ ...R, situacao: 'abandonada', nota: null }} quem="operador" />), /Saiu sem contar\.[\s\S]*não contou/);
});

test('resultado da Qualidade: Revisar avaliação item a item e discordância com "Marcar como resolvida"', () => {
	const h = em('/x', <ResultadoView r={R} quem="qualidade" revisando onRevisar={async () => {}} onResolver={async () => {}} />);
	assert.match(h, /aria-label="Revisar: Confirmou a identidade antes de falar valor"/);
	assert.match(h, /<option value="nao" selected="">Não \(IA\)<\/option>/);
	assert.match(h, /Discordou deste ponto:<\/b> “Eu confirmei no começo\.”/);
	assert.match(h, />Marcar como resolvida</);
	assert.match(h, /O que fez bem/);
	assert.doesNotMatch(h, /Discordo deste ponto/, 'a Qualidade não discorda como o operador');
	assert.doesNotMatch(em('/x', <ResultadoView r={R} quem="qualidade" />), /aria-label="Revisar:/, 'fora do modo revisar, sem seletores');
});

const TR: TreinoOperador = {
	atribuicao: 5, prazo: '2026-11-14', nota_minima: 75, modos: ['voz', 'texto'], tentativas: 2, tentativas_usadas: 1, melhor_nota: 60, situacao: 'abaixo_meta',
	cenario: { id: 1, nome: 'Já pagou', persona_nome: 'Rita (fictícia)', perfil: 'ja_pagou', descricao: null, dificuldade: 2, divida: {}, duracao_max_s: 480, modos: ['voz', 'texto'], objetivo_cenario: null, itens_foco: [] },
	sessoes: [],
};

test('operador: Começar por texto habilitado, voz "em breve"; resultado com "Treinar de novo" e "Meus treinamentos"', () => {
	const b = em(`/treino/${TOKEN}/5`, <BriefingView t={TR} token={TOKEN} hoje="2026-11-10" vozDisponivel={false} />);
	assert.match(b, />Começar<\/button>/);
	const voz = em(`/treino/${TOKEN}/5`, <BriefingView t={{ ...TR, modos: ['voz'], cenario: { ...TR.cenario, modos: ['voz'] } }} token={TOKEN} hoje="2026-11-10" vozDisponivel />);
	assert.match(voz, /Começar por voz · em breve/);
	const r = em(`/treino/${TOKEN}/5/resultado/9`, <ResultadoOperadorView r={R} t={TR} token={TOKEN} hoje="2026-11-10" />);
	assert.match(r, /<h1[^>]*>Resultado · Já pagou<\/h1>/);
	assert.match(r, new RegExp(`href="/treino/${TOKEN}/5"[^>]*>Treinar de novo`));
	assert.match(r, new RegExp(`href="/treino/${TOKEN}"[^>]*>Meus treinamentos`));
	assert.doesNotMatch(r, /Speech Analytics|Revisar avaliação/);
});

test('regras: rotas da sessão, relógio, pílula, discordância, encerramento e o voltar com o id do endereço', () => {
	assert.equal(rotaSessaoOperador(TOKEN, 5, 9), `/treino/${TOKEN}/5/sessao/9`);
	assert.equal(rotaResultadoOperador(TOKEN, 5, 9), `/treino/${TOKEN}/5/resultado/9`);
	assert.equal(relogio(65), '01:05');
	assert.equal(relogio(-3), '00:00');
	assert.deepEqual(pilulaResultado({ nota: 80, reprovada: true, nota_minima: 75, restantes: 0 }), { texto: 'Ainda não chegou na meta (75) · sem tentativas', tom: 'atencao' }, 'item crítico com "não" não chega na meta');
	assert.equal(validarDiscordancia('ok', () => false), 'Escreva em uma linha por que você discorda.');
	assert.equal(validarDiscordancia('meu telefone 11987654321', s => /\d{8,}/.test(s)), 'Sem CPF, telefone ou e-mail.');
	assert.equal(validarDiscordancia('Eu confirmei no começo.', () => false), '');
	assert.match(textoEncerramento({ situacao: 'abandonada', motivo: 'sem_fala' }), /não contou/);
	assert.match(textoEncerramento({ situacao: 'falhou' }), /não contou/);
	const o = organizarResultado(R);
	assert.deepEqual([o.bem.map(i => i.id), o.treinar.map(i => i.id), o.naoSeAplicou.map(i => i.id), o.critico?.id], [['ck_oferta', 'ck_ident'], ['ck_cpc'], ['ck_resumo'], 'ck_cpc']);
	assert.deepEqual(rotaPai(rotaSessaoRP(5, 9)), { to: '/speech-analytics/roleplay/atribuicoes/5', rotulo: 'Treino' });
	assert.deepEqual(rotaPai(rotaLadoALadoRP(5, 100)), { to: '/speech-analytics/roleplay/atribuicoes/5', rotulo: 'Treino' });
	assert.deepEqual(rotaPai(rotaTestarRP(2)), { to: '/speech-analytics/roleplay/cenarios/2', rotulo: 'Cenário' });
	assert.deepEqual(rotaPai(rotaTesteRP(2, 7)), { to: '/speech-analytics/roleplay/cenarios/2', rotulo: 'Cenário' });
	assert.deepEqual(trilhaRP(rotaSessaoRP(5, 9), 'Sessão de Bia R.', { rotulo: 'Já pagou', to: '/speech-analytics/roleplay/atribuicoes/5' }).map(i => i.rotulo),
		['Speech Analytics', 'Roleplay', 'Treinos atribuídos', 'Já pagou', 'Sessão de Bia R.']);
});
