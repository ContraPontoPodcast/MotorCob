// Roleplay renderizado de verdade (react-dom/server), sem banco: moldura (trilha, abas do Speech com Roleplay
// marcada, sub-navegação e o voltar), Painel vazio e com dados, biblioteca com filtro, cenário só leitura
// (Duplicar para editar no Padrão MotorCX), Cadastro para treino e a página da pessoa. O editor, o Atribuir, os
// Treinos atribuídos e a página do operador estão em atribuir.test.tsx.
// O Speech Analytics não tem modo de demonstração no navegador: estes testes cobrem as telas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { MolduraRP } from './moldura';
import { PainelView } from './painel';
import { AcoesCenario, CorpoCenario, ListaCenarios, descricaoCenario } from './cenarios';
import { FormOperador, GerirEquipes, ListaCadastro } from './cadastro';
import { CorpoPessoa } from './pessoa';
import { TreinosIndisponiveis } from './index';
import { abasVisiveis } from '../abas-speech';
import type { DadosPainel, DadosPessoa } from './dados';
import type { CenarioRP, OperadorRP } from '@/lib/roleplay';

const nada = () => {};
const em = (rota: string, n: ReactNode) => renderToStaticMarkup(<MemoryRouter initialEntries={[rota]}>{n}</MemoryRouter>);
/** Termos internos que nunca vão para a tela (SPEC §2.5). */
const INTERNOS = /bloqueante|ja_pagou|ja_paguei|\bck_[a-z]|so_treino|operador_ref|treino_[a-z]|perfis_treino|SQL \d|cluster|job noturno/;
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ');

const MX: CenarioRP = {
	id: 1, empresa_id: null, base_id: null, nome: 'Já pagou', persona_nome: 'Rita (fictícia)', perfil: 'ja_pagou',
	descricao: 'Diz que já pagou e quer que parem de cobrar.', objetivo: 'Diz que já pagou a dívida e quer que parem de cobrar.',
	comportamentos: ['insiste que pagou'], frases: ['Mas eu já paguei isso!'], objecoes: [{ codigo: 'ja_paguei', quando: 'logo depois de ouvir o motivo da ligação' }],
	dificuldade: 2, divida: { produto: 'Conta da loja Exemplo', faixa: 'ate_1k', dias_atraso: 60, alcada: { parcelas: 6, desconto_max: 20 } },
	duracao_max_s: 480, modos: ['voz', 'texto'], itens_foco: ['ck_cpc', 'ck_resumo'], objetivo_cenario: 'Pedir data e canal do pagamento',
	situacao: 'publicado', origem: 'padrao',
};
const EMP: CenarioRP = { ...MX, id: 2, empresa_id: 9, base_id: 1, nome: 'Já pagou (cópia)', situacao: 'rascunho', origem: 'manual', dificuldade: 4 };
const OPS: OperadorRP[] = [
	{ id: 100, apelido: 'Bia R.', equipe_id: 1, operador_ref: 'OP-114', so_treino: false, ativo: true },
	{ id: 101, apelido: 'Caio M.', equipe_id: 2, operador_ref: null, so_treino: true, ativo: true },
	{ id: 102, apelido: 'Gabi T.', equipe_id: 1, operador_ref: null, so_treino: true, ativo: false },
	{ id: 103, apelido: 'Hugo N.', equipe_id: null, operador_ref: 'OP-211', so_treino: false, ativo: true },
];
const EQUIPES = [{ id: 1, nome: 'Equipe Manhã', ativo: true }, { id: 2, nome: 'Equipe Tarde', ativo: true }];
const VAZIO: DadosPainel = { cenarios: [MX], operadores: [], atribuicoes: [], pessoas: [], sessoes: [], links: [], discordancias: [], sugestoes: [], uso: null, itens: {}, equipes: EQUIPES };

test('moldura: trilha, título, abas do Speech com Roleplay marcada, sub-navegação e voltar para a tela-mãe', () => {
	const h = em('/speech-analytics/roleplay/cenarios/1', <MolduraRP titulo="Já pagou" detalhe="Já pagou"><p>corpo</p></MolduraRP>);
	assert.match(h, /<nav aria-label="Você está em"/);
	assert.match(h, /href="\/speech-analytics"[^>]*>Speech Analytics<\/a>/);
	assert.match(h, /href="\/speech-analytics\/roleplay\/cenarios"[^>]*>Cenários<\/a>/);
	assert.match(h, /<span aria-current="page"[^>]*>Já pagou<\/span>/);
	assert.match(h, /<h1[^>]*>Já pagou<\/h1>/);
	assert.match(h, /aria-label="Voltar para Cenários"/);
	assert.match(h, /aria-label="Seções do Speech Analytics"/);
	assert.match(h, /role="tab" aria-selected="true"[^>]*>Roleplay/, 'a aba Roleplay continua marcada no detalhe');
	assert.match(h, /<nav aria-label="Roleplay"/);
	assert.match(h, /aria-current="true"[^>]*>Cenários<\/a>/, 'a seção-mãe marcada (não "page") no detalhe');
	const painel = em('/speech-analytics/roleplay', <MolduraRP titulo="Roleplay"><p /></MolduraRP>);
	assert.match(painel, /aria-current="page"[^>]*>Painel<\/a>/);
	assert.match(painel, /aria-label="Voltar para Visão geral do Speech Analytics"/);
	assert.match(painel, /href="\/speech-analytics\/roleplay\/atribuicoes"[^>]*>Treinos atribuídos<\/a>/);
	assert.match(painel, /href="\/speech-analytics\/roleplay\/evolucao"[^>]*>Evolução<\/a>/, 'Evolução na sub-navegação (PR 8)');
});

test('abas do Speech: Roleplay só para quem treina ou cuida dos cenários', () => {
	assert.ok(abasVisiveis('visao', true).some(a => a.id === 'roleplay'));
	assert.ok(!abasVisiveis('visao', false).some(a => a.id === 'roleplay'));
	assert.ok(abasVisiveis('roleplay', false).some(a => a.id === 'roleplay'), 'quem já está nela vê a aba marcada');
});

test('Painel vazio de verdade: indicadores sem número inventado e estados vazios em cada bloco', () => {
	const h = em('/speech-analytics/roleplay', <PainelView d={VAZIO} hoje="2026-11-10" desde="2026-10-12" />);
	assert.match(h, /Comece pelo Cadastro para treino/);
	assert.match(h, /Treinos em andamento/);
	assert.match(h, /nenhum treino aberto/);
	assert.match(h, /Precisa de ação/);
	assert.match(h, /Nada pendente/);
	assert.match(h, /Nenhuma sugestão aberta/);
	assert.match(h, /Nenhum treino atribuído em andamento/);
	assert.doesNotMatch(texto(h), INTERNOS);
});

test('Painel com dados: precisa de ação leva à pessoa, sugestão ao cenário, treino com situação', () => {
	const d: DadosPainel = {
		...VAZIO, operadores: OPS,
		atribuicoes: [{ id: 1, cenario_id: 1, prazo: '2026-11-20', nota_minima: 75, tentativas: 2, criado_em: '2026-11-01T12:00:00Z' }],
		pessoas: [{ atribuicao_id: 1, operador_id: 100, situacao: 'abaixo', melhor_nota: 68, tentativas_usadas: 2, tentativas_extra: 0 }],
		sugestoes: [{ id: 1, regra: 'alerta_subiu', cenario_id: 1, operadores: [100, 101, 103], criado_em: '2026-11-10T09:00:00Z',
			evidencia: { alerta: 'procon', equipe: 1, semana: 4, semana_anterior: 1, de: '2026-11-03', ate: '2026-11-09' } }],
		uso: { minutos_voz: 412, franquia_voz: 1000, sessoes_texto: 3, franquia_texto: 300, voz_bloqueada: false },
	};
	const h = em('/speech-analytics/roleplay', <PainelView d={d} hoje="2026-11-10" desde="2026-10-12" agora={new Date('2026-11-10T15:00:00Z')} />);
	assert.match(h, /Bia R\. usou as 2 tentativas em “Já pagou”/);
	assert.match(h, /href="\/speech-analytics\/roleplay\/operadores\/100"/);
	assert.match(h, /Alertas de ameaça de Procon subiram na Equipe Manhã/);
	assert.match(h, /Bia R\., Caio M\., Hugo N\./);
	assert.match(h, /href="\/speech-analytics\/roleplay\/cenarios\/1"/);
	assert.match(h, /412/);
	assert.match(h, /de 1\.000 do plano/);
	assert.match(h, /Em andamento/);
	assert.doesNotMatch(texto(h), INTERNOS);
});

test('Cenários: filtro marcado, Padrão MotorCX primeiro "Ver e duplicar", da empresa com rascunho', () => {
	const h = em('/speech-analytics/roleplay/cenarios', <ListaCenarios lista={[MX, EMP]} filtro="todos" itens={{}} onFiltro={nada} />);
	assert.match(h, /role="group" aria-label="Filtrar cenários"/);
	assert.match(h, /aria-pressed="true"[^>]*>Todos/);
	assert.ok(h.indexOf('Já pagou (cópia)') < h.indexOf('>Já pagou<'), 'os da empresa primeiro');
	assert.match(h, /Ver e duplicar/);
	assert.match(h, /Rascunho/);
	assert.match(h, /Em foco: Confirmou a identidade antes de falar valor · Resumiu o combinado antes de encerrar/);
	assert.match(h, /Diz que já pagou/);
	assert.doesNotMatch(texto(h), INTERNOS);
	const emp = em('/x', <ListaCenarios lista={[MX]} filtro="emp" itens={{}} onFiltro={nada} />);
	assert.match(emp, /A empresa ainda não tem cenários próprios/);
});

test('Cenário só leitura: Item crítico, ficha fictícia, Duplicar e Atribuir no Padrão MotorCX', () => {
	const h = em('/x', <CorpoCenario c={MX} itens={{}} />);
	assert.match(h, /Rita \(fictícia\)/);
	assert.match(h, /Item crítico · reprova a sessão/);
	assert.match(h, /Até R\$ 1 mil/);
	assert.match(h, /até 6x · desconto até 20%/);
	assert.match(h, /Quando: logo depois de ouvir o motivo da ligação/);
	assert.match(h, /Dificuldade 2 de 5/);
	assert.match(h, /Voz \(padrão\) ou texto/);
	assert.match(h, /8 min/);
	assert.doesNotMatch(texto(h), INTERNOS);
	assert.doesNotMatch(h, /<input|<textarea|<select/, 'nada editável');
	assert.equal(descricaoCenario(MX), 'Cenário Padrão MotorCX · só leitura');
	assert.equal(descricaoCenario(EMP), 'Cenário da empresa · rascunho');

	const mx = em('/x', <AcoesCenario c={MX} pode={{ treinar: true, cenarios: true }} onDuplicar={nada} />);
	assert.match(mx, />Duplicar para editar</);
	assert.match(mx, /href="\/speech-analytics\/roleplay\/atribuir\?cen=1"[^>]*>Atribuir</, 'publicado: atribuir com o cenário pré-escolhido');
	assert.doesNotMatch(mx, /disabled=""/);
	const emp = em('/x', <AcoesCenario c={EMP} pode={{ treinar: true, cenarios: true }} onDuplicar={nada} />);
	assert.doesNotMatch(emp, /Atribuir|em breve/, 'rascunho não se atribui (o da empresa abre no editor)');
	assert.doesNotMatch(em('/x', <AcoesCenario c={MX} pode={{ treinar: true, cenarios: false }} onDuplicar={nada} />), /Duplicar/, 'sem editar_cenarios_treino, sem duplicar');
	const copia = em('/x', <CorpoCenario c={EMP} itens={{}} base={{ id: 1, nome: 'Já pagou' }} />);
	assert.match(copia, /Cópia de <a [^>]*href="\/speech-analytics\/roleplay\/cenarios\/1"/);
});

test('Cadastro para treino: só quem é do treino, filtro por equipe, desativado escondido, link e "só treino"', () => {
	const h = em('/speech-analytics/roleplay/operadores', <ListaCadastro ops={OPS} equipes={EQUIPES} links={[{ operador_id: 100, valido_ate: '2026-11-21T03:00:00Z', revogado_em: null }]}
		filtroEq="" inativos={false} onFiltro={nada} onEditar={nada} onNovo={nada} agora={new Date('2026-11-10T15:00:00Z')} />);
	assert.match(h, /href="\/speech-analytics\/roleplay\/operadores\/100"/);
	assert.match(h, /Caio M\./);
	assert.doesNotMatch(h, /Gabi T\./, 'desativado só com "Mostrar desativados"');
	assert.doesNotMatch(h, /Hugo N\./, 'quem só está em Speech › Operadores não entra na lista');
	assert.match(h, /Só treino/);
	assert.match(h, /Sem link/);
	assert.match(h, />Ativo</);
	assert.match(h, /2 pessoas/);
	assert.doesNotMatch(texto(h), INTERNOS);
	const tarde = em('/x', <ListaCadastro ops={OPS} equipes={EQUIPES} links={[]} filtroEq="2" inativos onFiltro={nada} onEditar={nada} onNovo={nada} />);
	assert.match(tarde, /Caio M\./);
	assert.doesNotMatch(tarde, /Bia R\./);
	const vazio = em('/x', <ListaCadastro ops={[OPS[3]]} equipes={[]} links={[]} filtroEq="" inativos={false} onFiltro={nada} onEditar={nada} onNovo={nada} />);
	assert.match(vazio, /Ninguém no cadastro ainda/);
});

test('Cadastro: formulário com apelido, equipe e ID do discador opcional; trazer de Speech › Operadores; equipes', () => {
	const novo = em('/x', <FormOperador inicial={null} equipes={EQUIPES} candidatos={[OPS[3]]} onSalvar={async () => {}} onCancelar={nada} />);
	assert.match(novo, /Trazer de Speech › Operadores/);
	assert.match(novo, /Hugo N\. · OP-211/);
	assert.match(novo, /Apelido/);
	assert.match(novo, /ID do discador \(opcional\)/);
	assert.match(novo, /\+ Nova equipe…/);
	assert.match(novo, />Adicionar</);
	assert.doesNotMatch(novo, /Desativar/);
	const sem = em('/x', <FormOperador inicial={null} equipes={[]} candidatos={[]} onSalvar={async () => {}} onCancelar={nada} />);
	assert.match(sem, /Nome da nova equipe/, 'sem equipe, já abre a criação');
	const edit = em('/x', <FormOperador inicial={OPS[0]} equipes={EQUIPES} candidatos={[]} onSalvar={async () => {}} onCancelar={nada} />);
	assert.match(edit, /value="OP-114"[^>]*readOnly|readOnly[^>]*value="OP-114"/i);
	assert.match(edit, />Desativar</);
	assert.match(edit, />Salvar</);
	const eq = em('/x', <GerirEquipes equipes={EQUIPES} ops={OPS} onSalvar={async () => {}} />);
	assert.match(eq, /Nova equipe/);
	assert.match(eq, /1 pessoa ativa/);
});

test('Pessoa sem sessão: estado vazio; sem treino: tabela vazia; nota de treino separada da real', () => {
	const d: DadosPessoa = { operador: OPS[0], equipes: EQUIPES, cenarios: [MX], atribuicoes: [], pessoas: [], sessoes: [], links: [], feedbacks: [] };
	const h = em('/speech-analytics/roleplay/operadores/100', <CorpoPessoa d={d} hoje="2026-11-10" />);
	assert.match(h, /Ainda sem sessões de treino/);
	assert.match(h, /Bia R\. ainda não treinou/);
	assert.match(h, /Nenhum treino atribuído a Bia R\. ainda/);
	assert.match(h, /Speech › Operadores/);
	assert.match(h, /Sem link/);
	assert.doesNotMatch(texto(h), INTERNOS);
	const com = em('/x', <CorpoPessoa hoje="2026-11-10" d={{ ...d,
		atribuicoes: [{ id: 1, cenario_id: 1, prazo: '2026-11-20', nota_minima: 75, tentativas: 2, criado_em: '2026-11-01T12:00:00Z' }],
		pessoas: [{ atribuicao_id: 1, operador_id: 100, situacao: 'abaixo', melhor_nota: 68, tentativas_usadas: 1, tentativas_extra: 0 }],
		sessoes: [{ id: 9, atribuicao_id: 1, operador_id: 100, cenario_id: 1, origem: 'link', modo: 'texto', situacao: 'avaliada', inicio: '2026-11-09T13:00:00Z', duracao_s: 320, nota: 68, reprovada: true, item_reprovado: 'ck_cpc' }],
		feedbacks: [{ id: 1, combinado: 'Confirmar a identidade antes de falar valor.', proxima_conversa: '2026-11-17', criado_em: '2026-11-09T14:00:00Z' }],
	}} />);
	assert.match(com, /Item crítico com “não”/);
	assert.match(com, /1 de 2/);
	assert.match(com, /68 · item crítico/);
	assert.match(com, /Feedbacks 1:1/);
	assert.match(com, /próxima conversa 17\/11/);
	assert.doesNotMatch(texto(com), INTERNOS);
});

test('sem o módulo: "Treinos indisponíveis"', () => {
	const h = renderToStaticMarkup(<TreinosIndisponiveis />);
	assert.match(h, /Treinos indisponíveis/);
	assert.match(h, /Speech Analytics/);
});
