// Roleplay, PR 4, renderizado de verdade (react-dom/server), sem banco: editor de cenário, "Atribuir treino" com
// quem originou pré-marcado, "Treinos atribuídos" (situação por pessoa, link, próximo passo) e os painéis (link, links da
// turma, lembrete, prazo, feedback 1:1), e a página do operador (Meus treinamentos, briefing com "Isto é treino" antes de
// começar, link vencido/trocado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { MolduraRP } from './moldura';
import { FormCenarioView } from './editor';
import { FormAtribuirView, gruposPorEquipe } from './atribuir';
import { CorpoAtribuicao, ListaAtribuicoes, PainelFeedback, PainelLembrete, PainelLink, PainelLinksTurma, PainelPrazo, filtroSit } from './atribuicoes';
import { BriefingView, MeusTreinosView, TelaLinkFechado } from '@/components/treino/pagina';
import type { DadosAtribuicao } from './dados';
import { cenarioVazio, formDoCenario, type CenarioRP, type OperadorRP } from '@/lib/roleplay';
import type { MeusTreinos, TreinoOperador } from '@/lib/treino-operador';

const nada = () => {};
const assinc = async () => {};
const em = (rota: string, n: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}>{n}</MemoryRouter>);
const INTERNOS = /bloqueante|ja_pagou|ja_paguei|\bck_[a-z]|so_treino|operador_ref|treino_[a-z]|perfis_treino|SQL \d|cluster|job noturno|token_hash/;
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ');
const HOJE = '2026-11-10';
const AGORA = new Date('2026-11-10T15:00:00Z');

const MX: CenarioRP = {
	id: 1, empresa_id: null, base_id: null, nome: 'Já pagou', persona_nome: 'Rita (fictícia)', perfil: 'ja_pagou', descricao: 'Diz que já pagou.',
	objetivo: 'Diz que já pagou a dívida e quer que parem de cobrar.', comportamentos: ['insiste que pagou'], frases: ['Mas eu já paguei isso!'],
	objecoes: [{ codigo: 'ja_paguei', quando: 'no começo' }], dificuldade: 2, divida: { produto: 'Conta da loja Exemplo', faixa: 'ate_1k', dias_atraso: 60, alcada: { parcelas: 6, desconto_max: 20 } },
	duracao_max_s: 480, modos: ['voz', 'texto'], itens_foco: ['ck_cpc'], objetivo_cenario: 'Pedir data e canal', situacao: 'publicado', origem: 'padrao',
};
const EMP: CenarioRP = { ...MX, id: 2, empresa_id: 9, nome: 'Já pagou (cópia)', situacao: 'rascunho', origem: 'manual', modos: ['texto'] };
const OPS: OperadorRP[] = [
	{ id: 100, apelido: 'Bia R.', equipe_id: 1, operador_ref: 'OP-114', so_treino: false, ativo: true },
	{ id: 101, apelido: 'Caio M.', equipe_id: 2, operador_ref: null, so_treino: true, ativo: true },
	{ id: 102, apelido: 'Gabi T.', equipe_id: 1, operador_ref: null, so_treino: true, ativo: false },
	{ id: 103, apelido: 'Hugo N.', equipe_id: null, operador_ref: 'OP-211', so_treino: false, ativo: true },
];
const EQUIPES = [{ id: 1, nome: 'Equipe Manhã', ativo: true }, { id: 2, nome: 'Equipe Tarde', ativo: true }];

test('editor: seções do protótipo, nomes acessíveis, erros por campo e nenhum código interno na tela', () => {
	const h = em('/speech-analytics/roleplay/cenarios/2', <FormCenarioView f={formDoCenario(EMP)} erros={{}} itens={{}} cenario={EMP} onMudar={nada} />);
	for (const s of ['Cliente simulado', 'Dívida fictícia', 'Objeções e dificuldade', 'Critérios de nota', 'Sessão', 'Prévia do briefing']) assert.match(h, new RegExp(`>${s}<`), s);
	assert.match(h, /value="Rita \(fictícia\)"/);
	assert.match(h, /aria-label="Objeção 1"/);
	assert.match(h, /aria-label="Tirar a objeção 1"/);
	assert.match(h, /aria-label="Tirar “Mas eu já paguei isso!”"/);
	assert.match(h, /<option value="ja_paguei" selected="">Diz que já pagou<\/option>/);
	assert.match(h, /Confirmou a identidade antes de falar valor/);
	assert.match(h, /Item crítico \(reprova a sessão\)/);
	assert.match(h, /Rascunho/);
	assert.match(h, /“Você vai ligar para <b[^>]*>Rita \(fictícia\)<\/b>, cliente do Conta da loja Exemplo, 60 dias de atraso/);
	assert.doesNotMatch(texto(h), INTERNOS);
	assert.doesNotMatch(h, /Atribuir treino com este cenário/, 'rascunho não se atribui');
	const pub = em('/x', <FormCenarioView f={formDoCenario({ ...EMP, situacao: 'publicado' })} erros={{}} itens={{}} cenario={{ ...EMP, situacao: 'publicado' }} onMudar={nada} />);
	assert.match(pub, /href="\/speech-analytics\/roleplay\/atribuir\?cen=2"/);
	const err = em('/x', <FormCenarioView f={cenarioVazio()} erros={{ persona_nome: 'Primeiro nome e “(fictícia)”', nome: 'Escreva o nome do cenário.' }} itens={{}} cenario={null} onMudar={nada} />);
	assert.match(err, /role="alert"/);
	assert.match(err, /2 campos precisam de ajuste/);
	assert.match(err, /aria-invalid="true"/);
	assert.match(err, /Escreva o nome do cenário\./);
});

test('atribuir: só cenários publicados, pessoas por equipe, pré-marca só quem originou (ativo) e resumo', () => {
	const d = { cenarios: [MX, EMP], operadores: OPS, equipes: EQUIPES, uso: { minutos_voz: 412, franquia_voz: 1000, sessoes_texto: 3, franquia_texto: 300, voz_bloqueada: false } };
	const h = em('/speech-analytics/roleplay/atribuir?cen=1&ops=103,102', <FormAtribuirView d={d} hoje={HOJE} cenInicial={1} opsIniciais={[103, 102]} onEnviar={assinc} onCancelar={nada} />);
	assert.match(h, /<option value="1" selected="">Já pagou · Padrão MotorCX · dificuldade 2<\/option>/);
	assert.doesNotMatch(h, /Já pagou \(cópia\)/, 'rascunho não aparece');
	assert.match(h, />Equipe Manhã</);
	assert.match(h, />Marcar a equipe</);
	assert.match(h, /checked=""[^>]*\/?>Hugo N\./, 'Hugo veio pré-marcado (mesmo sem equipe de treino)');
	assert.doesNotMatch(h, /Gabi T\./, 'desativada não aparece nem pré-marcada');
	assert.match(h, /Sem equipe/);
	assert.match(h, /para 1 pessoa/);
	assert.match(h, /value="2026-11-17"/);
	assert.match(h, /Saldo do mês: 588 min/);
	assert.match(h, /Tentativa abandonada não conta/);
	assert.doesNotMatch(texto(h), INTERNOS);
	assert.deepEqual(gruposPorEquipe(OPS.filter(o => o.ativo), EQUIPES).map(g => g.nome), ['Equipe Manhã', 'Equipe Tarde', 'Sem equipe']);
	assert.match(em('/x', <FormAtribuirView d={{ ...d, cenarios: [EMP] }} hoje={HOJE} cenInicial={null} opsIniciais={[]} onEnviar={assinc} onCancelar={nada} />), /Nenhum cenário publicado para atribuir/);
});

const D: DadosAtribuicao = {
	atribuicao: { id: 5, cenario_id: 1, prazo: '2026-11-14', nota_minima: 75, tentativas: 2, criado_em: '2026-11-08T12:00:00Z', modos: ['voz', 'texto'], origem_sugestao_id: null },
	cenario: MX, operadores: OPS, equipes: EQUIPES,
	pessoas: [
		{ atribuicao_id: 5, operador_id: 100, situacao: 'abaixo', melhor_nota: 60, tentativas_usadas: 2, tentativas_extra: 0 },
		{ atribuicao_id: 5, operador_id: 101, situacao: 'aprovado', melhor_nota: 90, tentativas_usadas: 1, tentativas_extra: 0 },
		{ atribuicao_id: 5, operador_id: 103, situacao: 'pendente', melhor_nota: null, tentativas_usadas: 0, tentativas_extra: 0 },
	],
	sessoes: [], links: [{ operador_id: 101, valido_ate: '2026-11-16T03:00:00Z', revogado_em: null }],
	ultimoAcesso: { 101: '2026-11-09T13:00:00Z' }, feedbacks: [{ id: 1, operador_id: 100, combinado: 'Confirmar a identidade antes do valor.', proxima_conversa: '2026-11-20', criado_em: '2026-11-09T12:00:00Z' }],
};

test('treino atribuído: situação por pessoa (quem precisa de apoio primeiro), link, próximo passo e aviso de criado', () => {
	const h = em('/speech-analytics/roleplay/atribuicoes/5', <MolduraRP titulo="Já pagou" detalhe="Já pagou"><CorpoAtribuicao d={D} hoje={HOJE} criada tokens={{}} onAbrir={nada} onMaisUma={nada} agora={AGORA} /></MolduraRP>);
	assert.match(h, /Treino atribuído a 3 pessoas\./);
	assert.match(h, /1 já tinha link ativo: o treino aparece lá\. 2 precisam de link\./);
	assert.match(h, />Gerar e copiar links</);
	const t = texto(h);
	assert.ok(t.indexOf('Bia R.') < t.indexOf('Hugo N.') && t.indexOf('Hugo N.') < t.indexOf('Caio M.'), 'Precisa de apoio → Não começou → Chegou na meta');
	assert.match(h, /Precisa de apoio/);
	assert.match(h, /Chegou na meta/);
	assert.match(h, /Ativo até 16\/11/);
	assert.match(h, /Sem link/);
	assert.match(h, /Liberar \+1 tentativa/);
	assert.match(h, /href="\/speech-analytics\/roleplay\/atribuir\?ops=100"[^>]*>Atribuir outro cenário/);
	assert.match(h, /href="\/speech-analytics\/roleplay\/operadores\/100"/);
	assert.match(h, /Registrar feedback 1:1/);
	assert.match(h, /Treino lado a lado · em breve/);
	assert.match(h, /Confirmar a identidade antes do valor\./);
	assert.match(h, /aria-current="true"[^>]*>Treinos atribuídos<\/a>/, 'seção-mãe marcada no detalhe');
	assert.doesNotMatch(t, INTERNOS);
	assert.doesNotMatch(t, /reprovad/i);
});

test('painéis: link (copiar uma vez, QR, revogar), links da turma, lembrete, prazo e feedback 1:1', () => {
	const tok = { token: 'a'.repeat(64), valido_ate: '2026-11-16T03:00:00Z' };
	const novo = em('/x', <PainelLink op={100} apelido="Bia R." d={D} token={tok} onGerar={assinc} onRevogar={assinc} agora={AGORA} />);
	assert.match(novo, /Copie agora\./);
	assert.match(novo, new RegExp(`/treino/${'a'.repeat(64)}`));
	assert.match(novo, />Revogar link</);
	assert.match(novo, />Gerar link novo</);
	const ativo = em('/x', <PainelLink op={101} apelido="Caio M." d={D} token={null} onGerar={assinc} onRevogar={assinc} agora={AGORA} />);
	assert.match(ativo, /Link ativo até 16\/11/);
	assert.doesNotMatch(ativo, /\/treino\//, 'o link já existente não reaparece');
	const sem = em('/x', <PainelLink op={103} apelido="Hugo N." d={D} token={null} onGerar={assinc} onRevogar={assinc} agora={AGORA} />);
	assert.match(sem, />Gerar link</);
	assert.doesNotMatch(sem, /Revogar/);
	const turma = em('/x', <PainelLinksTurma d={D} tokens={{ 100: tok }} nome="Já pagou" onGerar={assinc} agora={AGORA} />);
	assert.match(turma, /Gerar para quem não tem link \(1\)/);
	assert.match(turma, /Bia R\.: [^<]*\/treino\/a{64}/);
	assert.match(turma, /Imprimir QR codes/);
	const lem = em('/x', <PainelLembrete itens={[{ op: 100, apelido: 'Bia R.', texto: 'Oi, Bia!', temLink: false }, { op: 103, apelido: 'Hugo N.', texto: 'Oi, Hugo!', temLink: true }]} />);
	assert.match(lem, /aria-label="Lembrete para Bia R\."/);
	assert.match(lem, />Copiar todos</);
	assert.match(lem, /pede para a pessoa abrir o link que já recebeu/);
	assert.match(em('/x', <PainelPrazo atual="2026-11-14" hoje={HOJE} onSalvar={assinc} />), /min="2026-11-14"/);
	assert.match(em('/x', <PainelFeedback apelido="Bia R." cenario="Já pagou" onSalvar={assinc} />), /O que foi combinado/);
});

test('lista de treinos atribuídos: filtro na URL, para quem e situação', () => {
	assert.equal(filtroSit('concluido'), 'concluido');
	assert.equal(filtroSit('xyz'), 'todas');
	const h = em('/speech-analytics/roleplay/atribuicoes', <ListaAtribuicoes d={{ atribuicoes: [D.atribuicao!], pessoas: D.pessoas, cenarios: [MX], operadores: OPS }} filtro="todas" hoje={HOJE} onFiltro={nada} />);
	assert.match(h, /href="\/speech-analytics\/roleplay\/atribuicoes\/5"[^>]*>Já pagou</);
	assert.match(h, /Bia R\., Caio M\., Hugo N\./);
	assert.match(h, /1 de 3/);
	assert.match(h, /Em andamento/);
	const vazio = em('/x', <ListaAtribuicoes d={{ atribuicoes: [], pessoas: [], cenarios: [], operadores: [] }} filtro="todas" hoje={HOJE} onFiltro={nada} />);
	assert.match(vazio, /Nenhum treino atribuído ainda/);
});

const TR: TreinoOperador = {
	atribuicao: 5, prazo: '2026-11-14', nota_minima: 75, modos: ['voz', 'texto'], tentativas: 2, tentativas_usadas: 1, melhor_nota: 60, situacao: 'abaixo_meta',
	cenario: { id: 1, nome: 'Já pagou', persona_nome: 'Rita (fictícia)', perfil: 'ja_pagou', descricao: 'Diz que já pagou.', dificuldade: 2,
		divida: { produto: 'Conta da loja Exemplo', faixa: 'ate_1k', dias_atraso: 60, alcada: { parcelas: 6, desconto_max: 20 } }, duracao_max_s: 480, modos: ['voz', 'texto'],
		objetivo_cenario: 'Pedir data e canal', itens_foco: [{ id: 'ck_cpc', texto: 'Confirmou a identidade antes de falar valor', gravidade: 'bloqueante' }] },
	sessoes: [{ id: 9, modo: 'texto', inicio: '2026-11-09T12:00:00Z', nota: 60, reprovada: false }],
};
const TOKEN = 'f'.repeat(64);

test('operador: Meus treinamentos sem menu do MotorCX, com grupos e só os treinos dele', () => {
	const d: MeusTreinos = { apelido: 'Bia R.', valido_ate: '2026-11-16T03:00:00Z', voz_disponivel: true, treinos: [TR, { ...TR, atribuicao: 6, situacao: 'aprovado', melhor_nota: 90 }] };
	const h = em(`/treino/${TOKEN}`, <MeusTreinosView d={d} token={TOKEN} hoje={HOJE} />);
	assert.match(h, /<h1[^>]*>Meus treinamentos<\/h1>/);
	assert.match(h, /Oi, Bia!/);
	assert.match(h, /Para fazer/);
	assert.match(h, /Ainda não chegou na meta \(75\) · 1 tentativa até 14\/11/);
	assert.match(h, /Feitos/);
	assert.match(h, new RegExp(`href="/treino/${TOKEN}/5"`));
	assert.doesNotMatch(h, /Speech Analytics|Painel|Cadastro para treino|aria-label="Seções/, 'sem nada do app da Qualidade');
	assert.doesNotMatch(texto(h), INTERNOS);
});

test('operador: briefing com "Isto é treino" antes de tudo, ficha fictícia, itens em foco e modo', () => {
	const h = em(`/treino/${TOKEN}/5`, <BriefingView t={TR} token={TOKEN} hoje={HOJE} vozDisponivel={false} />);
	const t = texto(h);
	assert.ok(t.indexOf('Isto é treino.') > -1 && t.indexOf('Isto é treino.') < t.indexOf('Cliente simulada'), '"Isto é treino" vem antes da ficha');
	assert.ok(t.indexOf('Isto é treino.') < t.indexOf('Como você quer treinar?'), 'e antes de começar');
	assert.match(h, /não entra na sua monitoria/);
	assert.match(h, /Rita \(fictícia\)/);
	assert.match(h, /Até R\$ 1 mil \(o valor exato aparece na ligação\)/);
	assert.match(h, /Item crítico/);
	assert.match(h, /minutos de voz do mês acabaram/);
	assert.match(h, /value="on" checked=""|checked=""[^>]*\/?>Texto/, 'sem minutos de voz: texto marcado');
	assert.match(h, /Começar · em breve/);
	assert.match(h, /aria-label="Voltar para Meus treinamentos"/);
	assert.doesNotMatch(t, INTERNOS);
	const esgotou = em('/x', <BriefingView t={{ ...TR, situacao: 'precisa_apoio', tentativas_usadas: 2 }} token={TOKEN} hoje={HOJE} vozDisponivel />);
	assert.match(esgotou, /Você usou as 2 tentativas\./);
	assert.match(esgotou, /A Qualidade vai combinar com você o próximo passo/);
	assert.doesNotMatch(esgotou, /Começar/);
});

test('operador: link vencido, trocado e treinos indisponíveis têm telas próprias', () => {
	assert.match(em('/x', <TelaLinkFechado estado="expirado" ate="2026-11-08T03:00:00Z" />), /Este link de treino venceu[\s\S]*08\/11/);
	assert.match(em('/x', <TelaLinkFechado estado="revogado" />), /Este link não abre mais[\s\S]*trocado por um link novo/);
	assert.match(em('/x', <TelaLinkFechado estado="indisponivel" />), /Treinos indisponíveis/);
	assert.match(em('/x', <TelaLinkFechado estado="invalido" />), /Link de treino inválido/);
});
