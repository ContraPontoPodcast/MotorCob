// Roleplay (SQL 90; npm test): rotas, trilha e títulos por tela, filtros da biblioteca, situação de cada pessoa (a
// mesma ordem de situacao_treino_operador), "Precisa de ação", indicadores do Painel e as regras do Cadastro para treino.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	FILTROS_CENARIO, GRAVIDADE_RP, ROTA_RP, ROTA_RP_CADASTRO, ROTA_RP_CENARIOS, SECOES_RP, TIPOS_CLIENTE, ehSecaoRP, estadoLink, filtrarCenarios,
	filtroCenario, indicadoresPainel, noCadastro, precisaDeAcao, resumoTreino, rotaCenarioRP, rotaPessoaRP, rotuloObjecao, secaoRP, situacaoPessoa,
	textoAlcada, textoModos, tituloDocumentoRP, trilhaRP, validarApelido, validarIdDiscador, validarNomeEquipe,
	type AtribuicaoRP, type PessoaNoTreino, type SessaoRP,
} from './roleplay';
import { ABAS_SA, abaValida } from './speech';

const SQL = readFileSync('../supabase/migrations/20270126000001_treino_operadores.sql', 'utf8');
const ROTAS = readFileSync('src/routes.ts', 'utf8');

test('roleplay: rotas novas declaradas e a aba no Speech Analytics (não redireciona mais para Testar com personas)', () => {
	for (const r of ['speech-analytics/roleplay/cenarios', 'speech-analytics/roleplay/cenarios/:id', 'speech-analytics/roleplay/operadores', 'speech-analytics/roleplay/operadores/:op']) {
		assert.ok(ROTAS.includes(`route('${r}'`), r);
	}
	assert.equal(abaValida('roleplay'), 'roleplay');
	const ids = ABAS_SA.map(a => a.id) as string[];
	assert.equal(ids.indexOf('roleplay'), ids.indexOf('operadores') + 1, 'Roleplay logo depois de Operadores, como no protótipo');
	assert.doesNotMatch(readFileSync('src/routes/speech-analytics.tsx', 'utf8'), /ROTA_TESTAR_PERSONAS|\/voz\/agente\/personas/);
	assert.equal(rotaCenarioRP(12), `${ROTA_RP_CENARIOS}/12`);
	assert.equal(rotaPessoaRP(7), `${ROTA_RP_CADASTRO}/7`);
});

test('roleplay: seção marcada também nos detalhes; trilha clicável até a tela atual', () => {
	assert.equal(secaoRP(ROTA_RP), 'painel');
	assert.equal(secaoRP(`${ROTA_RP}/`), 'painel');
	assert.equal(secaoRP(rotaCenarioRP(3)), 'cenarios');
	assert.equal(secaoRP(rotaPessoaRP(3)), 'cadastro');
	assert.equal(secaoRP('/speech-analytics/operadores'), null);
	assert.ok(ehSecaoRP(ROTA_RP_CENARIOS) && !ehSecaoRP(rotaCenarioRP(3)));
	assert.deepEqual(SECOES_RP.map(s => s.nome), ['Painel', 'Cenários', 'Treinos atribuídos', 'Evolução', 'Cadastro para treino']);

	assert.deepEqual(trilhaRP(ROTA_RP), [{ rotulo: 'Speech Analytics', to: '/speech-analytics' }, { rotulo: 'Roleplay' }]);
	assert.deepEqual(trilhaRP(rotaCenarioRP(3), 'Já pagou'), [
		{ rotulo: 'Speech Analytics', to: '/speech-analytics' }, { rotulo: 'Roleplay', to: ROTA_RP }, { rotulo: 'Cenários', to: ROTA_RP_CENARIOS }, { rotulo: 'Já pagou' },
	]);
	assert.equal(trilhaRP(rotaPessoaRP(3)).at(-1)?.rotulo, 'Pessoa', 'antes de carregar, o nome genérico');
	assert.equal(trilhaRP(ROTA_RP_CADASTRO).at(-1)?.to, undefined, 'a tela atual não é link');
});

test('roleplay: título da aba do navegador distinto por tela', () => {
	const titulos = [
		tituloDocumentoRP(ROTA_RP), tituloDocumentoRP(ROTA_RP_CENARIOS), tituloDocumentoRP(rotaCenarioRP(1), 'Já pagou'),
		tituloDocumentoRP(ROTA_RP_CADASTRO), tituloDocumentoRP(rotaPessoaRP(1), 'Bia R.'),
	];
	assert.deepEqual(titulos, [
		'Roleplay · Speech Analytics · MotorCX', 'Cenários · Roleplay · MotorCX', 'Já pagou · Cenários · Roleplay · MotorCX',
		'Cadastro para treino · Roleplay · MotorCX', 'Bia R. · Cadastro para treino · Roleplay · MotorCX',
	]);
	assert.equal(new Set(titulos).size, titulos.length);
});

test('roleplay: filtro da biblioteca vem da URL; empresa primeiro, arquivado nunca', () => {
	assert.deepEqual(FILTROS_CENARIO.map(f => f.v), ['todos', 'mx', 'emp', 'dif']);
	assert.equal(filtroCenario('emp'), 'emp');
	assert.equal(filtroCenario('xyz'), 'todos');
	assert.equal(filtroCenario(null), 'todos');
	const l = [
		{ id: 1, nome: 'Terceiro atende', empresa_id: null, dificuldade: 1, situacao: 'publicado' as const },
		{ id: 2, nome: 'Baixa não caiu', empresa_id: 9, dificuldade: 3, situacao: 'rascunho' as const },
		{ id: 3, nome: 'Arquivado', empresa_id: 9, dificuldade: 5, situacao: 'arquivado' as const },
		{ id: 4, nome: 'Contesta e ameaça o Procon', empresa_id: null, dificuldade: 3, situacao: 'publicado' as const },
	];
	assert.deepEqual(filtrarCenarios(l, 'todos').map(c => c.id), [2, 4, 1]);
	assert.deepEqual(filtrarCenarios(l, 'mx').map(c => c.id), [4, 1]);
	assert.deepEqual(filtrarCenarios(l, 'emp').map(c => c.id), [2]);
	assert.deepEqual(filtrarCenarios(l, 'dif').map(c => c.id), [2, 4]);
});

test('roleplay: linguagem da monitoria (Item crítico, tipo de cliente) e nenhum código cru na tela', () => {
	assert.equal(GRAVIDADE_RP.bloqueante, 'Item crítico');
	const perfis = (SQL.match(/function public\.perfis_treino\(\)[\s\S]*?array\[([^\]]*)\]/)?.[1] ?? '').split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
	assert.ok(perfis.length >= 10);
	assert.deepEqual(Object.keys(TIPOS_CLIENTE).sort(), [...perfis].sort(), 'todo tipo de cliente do banco tem rótulo');
	for (const v of Object.values(TIPOS_CLIENTE)) assert.doesNotMatch(v, /_/);
	assert.equal(rotuloObjecao('ja_paguei'), 'Diz que já pagou');
	assert.equal(rotuloObjecao('quer_por_escrito'), 'Quer por escrito', 'código novo vira texto, não código');
	assert.equal(textoAlcada({ parcelas: 6, desconto_max: 20 }), 'até 6x · desconto até 20%');
	assert.equal(textoAlcada({ parcelas: 4 }), 'até 4x');
	assert.equal(textoAlcada(undefined), 'Sem alçada definida');
	assert.equal(textoModos(['voz', 'texto']), 'Voz (padrão) ou texto');
	assert.equal(textoModos(['texto']), 'Só texto');
});

const A = (x: Partial<AtribuicaoRP> = {}): AtribuicaoRP => ({ id: 1, cenario_id: 10, prazo: '2026-11-20', nota_minima: 75, tentativas: 2, criado_em: '2026-11-01T12:00:00Z', ...x });
const P = (x: Partial<PessoaNoTreino> = {}): PessoaNoTreino => ({ atribuicao_id: 1, operador_id: 100, situacao: 'pendente', melhor_nota: null, tentativas_usadas: 0, tentativas_extra: 0, ...x });
const S = (x: Partial<SessaoRP> = {}): SessaoRP => ({ id: 1, atribuicao_id: 1, operador_id: 100, cenario_id: 10, origem: 'link', modo: 'texto', situacao: 'avaliada', inicio: '2026-11-05T12:00:00Z', duracao_s: 300, nota: 60, reprovada: false, item_reprovado: null, ...x });
const HOJE = '2026-11-10';

test('roleplay: situação da pessoa na mesma ordem do banco (situacao_treino_operador)', () => {
	assert.equal(situacaoPessoa(A(), P({ situacao: 'aprovado', tentativas_usadas: 2 }), null, HOJE), 'aprovado');
	assert.equal(situacaoPessoa(A(), P({ tentativas_usadas: 2 }), S({ reprovada: true }), HOJE), 'precisa_apoio', 'esgotou vem antes do item crítico');
	assert.equal(situacaoPessoa(A(), P({ tentativas_usadas: 2, tentativas_extra: 1 }), null, HOJE), 'abaixo_meta', '+1 tentativa liberada');
	assert.equal(situacaoPessoa(A({ tentativas: null }), P({ tentativas_usadas: 9 }), null, HOJE), 'abaixo_meta', 'sem limite nunca esgota');
	assert.equal(situacaoPessoa(A(), P({ tentativas_usadas: 1 }), S({ reprovada: true }), HOJE), 'item_critico');
	assert.equal(situacaoPessoa(A({ prazo: '2026-11-09' }), P(), null, HOJE), 'prazo_vencido');
	assert.equal(situacaoPessoa(A({ prazo: HOJE }), P(), null, HOJE), 'nao_comecou', 'o prazo vale até o fim do dia');
	assert.equal(situacaoPessoa(A(), P({ situacao: 'em_andamento' }), null, HOJE), 'em_andamento');
	// a função do banco tem os mesmos ramos, na mesma ordem
	const corpo = SQL.match(/function public\.situacao_treino_operador[\s\S]*?\$\$;/)?.[0] ?? '';
	const ordem = ['aprovado', 'precisa_apoio', 'item_critico', 'prazo_vencido', 'abaixo_meta', 'em_andamento', 'nao_comecou'].map(s => corpo.indexOf(`'${s}'`));
	assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), `ordem do banco: ${ordem}`);
});

test('roleplay: "Precisa de ação" com o mais urgente primeiro, sem repetir e só com apelido', () => {
	const operadores = [
		{ id: 100, apelido: 'Bia R.', equipe_id: 1, operador_ref: 'OP-114', so_treino: false, ativo: true },
		{ id: 101, apelido: 'Caio M.', equipe_id: 1, operador_ref: null, so_treino: true, ativo: true },
		{ id: 102, apelido: 'Duda S.', equipe_id: 1, operador_ref: null, so_treino: true, ativo: true },
	];
	const atribuicoes = [A(), A({ id: 2, cenario_id: 11, prazo: '2026-11-08' })];
	const pessoas = [
		P({ operador_id: 100, tentativas_usadas: 2, melhor_nota: 68 }),
		P({ operador_id: 101, tentativas_usadas: 1 }),
		P({ atribuicao_id: 2, operador_id: 102 }),
	];
	const sessoes = [S({ id: 5, operador_id: 101, reprovada: true, item_reprovado: 'ck_terceiro' }), S({ id: 6, operador_id: 100, nota: 68 })];
	const links = [{ operador_id: 100, valido_ate: '2026-11-21T03:00:00Z', revogado_em: null }, { operador_id: 101, valido_ate: '2026-11-01T03:00:00Z', revogado_em: null }];
	const r = precisaDeAcao({
		atribuicoes, pessoas, sessoes, links, discordancias: [{ sessao_id: 6 }], operadores,
		cenarios: [{ id: 10, nome: 'Já pagou' }, { id: 11, nome: 'Terceiro atende' }], itens: {}, hoje: HOJE, agora: new Date('2026-11-10T15:00:00Z'),
	});
	assert.deepEqual(r.map(i => i.tipo), ['apoio', 'critico', 'prazo', 'discordancia', 'link']);
	assert.match(r[0].texto, /^Bia R\. usou as 2 tentativas em “Já pagou” e ainda não chegou na meta \(75; melhor nota 68\)\.$/);
	assert.match(r[1].texto, /Caio M\. ficou “não” no item crítico “Não falou da dívida com terceiro” em “Já pagou”/);
	assert.match(r[2].texto, /“Terceiro atende”: o prazo venceu em 08\/11 com 1 pessoa pendente\./);
	assert.match(r[4].texto, /Caio M\. está com o link de treino expirado/);
	assert.ok(!r.some(i => /Duda/.test(i.texto) && i.tipo === 'link'), 'prazo vencido não pede link');
	for (const i of r) assert.doesNotMatch(i.texto, /ck_|_id|\bnull\b|undefined/);
	assert.deepEqual(precisaDeAcao({ atribuicoes: [], pessoas: [], sessoes: [], links: [], discordancias: [], operadores: [], cenarios: [], itens: {}, hoje: HOJE }), []);
});

test('roleplay: indicadores do Painel e resumo do treino', () => {
	const atr = [A(), A({ id: 2, criado_em: '2026-09-01T12:00:00Z' })];
	const pessoas = [P({ situacao: 'aprovado', melhor_nota: 80 }), P({ operador_id: 101, melhor_nota: 70, tentativas_usadas: 1 }), P({ atribuicao_id: 2, situacao: 'aprovado', melhor_nota: 90 })];
	const k = indicadoresPainel(atr, pessoas, [S({ nota: 80, inicio: '2026-11-09T10:00:00Z' }), S({ id: 2, origem: 'teste', nota: 10 }), S({ id: 3, nota: 70, inicio: '2026-08-01T10:00:00Z' })], HOJE, '2026-10-12');
	assert.deepEqual(k, { emAndamento: 1, treinosAbertos: 1, naMeta: 1, avaliadas: 2, pctMeta: 50, notaMedia: 80, sessoes: 1 });
	assert.deepEqual(resumoTreino(atr[0], pessoas, HOJE), { pessoas: 2, naMeta: 1, pendentes: [101], media: 75, situacao: 'andamento' });
	assert.equal(resumoTreino(atr[1], pessoas, HOJE).situacao, 'concluido');
	assert.deepEqual(indicadoresPainel([], [], [], HOJE, '2026-10-12'), { emAndamento: 0, treinosAbertos: 0, naMeta: 0, avaliadas: 0, pctMeta: null, notaMedia: null, sessoes: 0 });
	const agora = new Date('2026-11-10T15:00:00Z');
	assert.equal(estadoLink([], 1, agora).estado, 'sem');
	assert.equal(estadoLink([{ operador_id: 1, valido_ate: '2026-11-11T00:00:00Z', revogado_em: null }], 1, agora).estado, 'ativo');
	assert.equal(estadoLink([{ operador_id: 1, valido_ate: '2026-11-10T00:00:00Z', revogado_em: null }], 1, agora).estado, 'expirado');
});

test('roleplay: Cadastro para treino com as mesmas regras do banco (sem dado pessoal)', () => {
	assert.equal(validarApelido('Nina P.'), '');
	assert.match(validarApelido('  '), /apelido/);
	assert.match(validarApelido('a'.repeat(31)), /30/);
	for (const ruim of ['nina@empresa.com', 'Nina 123456', '123.456.789-09', '(11) 98765-4321']) assert.match(validarApelido(ruim), /Sem CPF/, ruim);
	assert.equal(validarIdDiscador(''), '', 'o ID do discador é opcional');
	assert.equal(validarIdDiscador('OP-130'), '');
	assert.match(validarIdDiscador('OP 130'), /sem espaço/);
	assert.match(validarIdDiscador('12345678'), /8 ou mais/);
	assert.equal(validarNomeEquipe('Equipe Manhã'), '');
	assert.match(validarNomeEquipe('A'), /2 caracteres/);
	assert.match(validarNomeEquipe('x@y.com'), /Sem CPF/);
	// os limites do banco (voz_operadores e treino_equipes) são os mesmos
	assert.match(SQL, /char_length\(trim\(nome\)\) between 2 and 40/);
	assert.ok(noCadastro({ so_treino: true, equipe_id: null }) && noCadastro({ so_treino: false, equipe_id: 3 }) && !noCadastro({ so_treino: false, equipe_id: null }));
});
