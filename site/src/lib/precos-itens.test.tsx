// Preços editáveis (SQL 92; npm test): pré-preenchimento (vigente > tabela), franquia (a da empresa > a padrão; só
// muda o que foi mexido), modelos por item (IA nunca mensalidade), itens do Agente de voz e do Speech Analytics na
// Contratação e a paridade da lista de itens com franquia com o banco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	ITENS_COM_FRANQUIA, ITENS_PRECO_PADRAO, franquiaDigitada, franquiaEfetiva, franquiaParaSalvar, itensDosModulos,
	modeloInicial, modelosDoItem, numeroCampo, precoInicial, temFranquia,
} from './precos-itens';

const SQL92 = readFileSync('../supabase/migrations/20270128000001_precos_editaveis.sql', 'utf8');
// a definição vigente de itens_com_franquia() é a do SQL 93 (recriada inteira com o robô)
const SQL_FRANQUIA = readFileSync('../supabase/migrations/20270129000001_voz_licencas.sql', 'utf8');
const tela = readFileSync('src/components/workspace/empresa/contratacao-empresa.tsx', 'utf8');
const margem = readFileSync('src/components/workspace/console/console-margem-ia.tsx', 'utf8');
const produtos = readFileSync('src/components/workspace/console/console-produtos.tsx', 'utf8');

const CATALOGO = [
	{ codigo: 'contratos', modulo: 'orquestracao', ordem: 1, unidade: 'CPF', preco_de: null },
	{ codigo: 'voz_licenca_robo', modulo: 'agente_voz', ordem: 49, unidade: 'robô·mês', preco_de: null, eh_ia: true, franquia_padrao: 4000 },
	{ codigo: 'voz_plataforma', modulo: 'agente_voz', ordem: 50, unidade: 'mês', preco_de: null, eh_ia: false },
	{ codigo: 'voz_minuto_ia', modulo: 'agente_voz', ordem: 51, unidade: 'minuto', preco_de: null, eh_ia: true, preco_tabela: 1.5 },
	{ codigo: 'ia_speech_analytics', modulo: 'speech_analytics', ordem: 55, unidade: 'minuto analisado', preco_de: null, eh_ia: true },
	{ codigo: 'ia_treino_texto', modulo: 'speech_analytics', ordem: 57, unidade: 'sessão', preco_de: null, eh_ia: true, preco_tabela: 1.2, franquia_padrao: 300 },
	{ codigo: 'ia_treino_voz', modulo: 'speech_analytics', ordem: 57, unidade: 'minuto', preco_de: null, eh_ia: true, preco_tabela: 1.5, franquia_padrao: 1000 },
	{ codigo: 'ia_sem_credito', modulo: null, ordem: 59, unidade: 'uso', preco_de: null, ativo: false },
];

test('itens com franquia: a lista do site é a do banco (itens_com_franquia)', () => {
	const doBanco = SQL_FRANQUIA.match(/select array\[([^\]]+)\]::text\[\]/)?.[1].match(/'([a-z_]+)'/g)?.map(x => x.replace(/'/g, ''));
	assert.deepEqual(doBanco, [...ITENS_COM_FRANQUIA]);
	assert.ok(temFranquia('ia_treino_voz') && temFranquia('ia_treino_texto') && temFranquia('ia_creditos') && temFranquia('voz_licenca_robo'));
	assert.ok(!temFranquia('voz_minuto_ia') && !temFranquia('sms') && !temFranquia(null));
});

test('Contratação: Agente de voz e Speech Analytics só com o módulo ligado, na ordem do catálogo', () => {
	const nada = itensDosModulos(CATALOGO, { agente_voz: false, speech_analytics: false });
	assert.deepEqual([nada.agente_voz.length, nada.speech_analytics.length], [0, 0]);
	const tudo = itensDosModulos(CATALOGO, { agente_voz: true, speech_analytics: true });
	// o robô (voz_licenca_robo) fica fora do cartão Preços: o preço dele só se grava pela licença (SQL 93)
	assert.deepEqual(tudo.agente_voz.map(i => i.codigo), ['voz_plataforma', 'voz_minuto_ia']);
	assert.deepEqual(tudo.speech_analytics.map(i => i.codigo), ['ia_speech_analytics', 'ia_treino_texto', 'ia_treino_voz']);
	assert.equal(tela.match(/grupo\('(MOTOR|AGENTE DE VOZ|SPEECH ANALYTICS)'/g)?.length, 3);
});

test('pré-preenchido: o preço da empresa; sem ele, o de tabela (no formato brasileiro)', () => {
	assert.equal(precoInicial(1.9, 1.5), '1,9');
	assert.equal(precoInicial(null, 1.5), '1,5');
	assert.equal(precoInicial(undefined, 1.2), '1,2');
	assert.equal(precoInicial(null, null), '');
	assert.equal(precoInicial('', 0), '');
	assert.equal(numeroCampo(0.06851), '0,06851');
	assert.equal(numeroCampo(1234.5), '1234,5');
	// Mensageria, Score e o editor da Contratação usam o pré-preenchimento
	assert.ok((tela.match(/precoInicial\(/g)?.length ?? 0) >= 4);
});

test('franquia: a da empresa na vigência; sem ela, a padrão; só vai para o banco o que mudou', () => {
	const voz = CATALOGO.find(i => i.codigo === 'ia_treino_voz')!;
	assert.equal(franquiaEfetiva(null, voz), 1000);
	assert.equal(franquiaEfetiva({ franquia: null }, voz), 1000);
	assert.equal(franquiaEfetiva({ franquia: 1500 }, voz), 1500);
	assert.equal(franquiaEfetiva({ franquia: 0 }, voz), 0);
	assert.equal(franquiaDigitada('1.000'), 1000);
	assert.equal(franquiaDigitada(' 0 '), 0);
	assert.equal(franquiaDigitada('-1'), null);
	assert.equal(franquiaDigitada('1,5'), null);
	assert.equal(franquiaDigitada('2000000'), null);
	assert.equal(franquiaDigitada(''), null);
	assert.equal(franquiaParaSalvar('1000', 1000), null, 'sem mudança: mantém a que vale (herda a padrão)');
	assert.equal(franquiaParaSalvar('1.200', 1000), 1200);
	assert.equal(franquiaParaSalvar('0', 1000), 0);
	assert.ok(tela.includes("supabase.rpc('salvar_preco_franquia'"));
});

test('modelos: IA nunca mensalidade; motor e plataforma de voz aceitam; cobrado por mês abre em mensalidade', () => {
	const item = (c: string) => CATALOGO.find(i => i.codigo === c)!;
	assert.deepEqual(modelosDoItem(item('ia_treino_voz'), false), ['flat', 'faixa', 'progressivo']);
	assert.deepEqual(modelosDoItem(item('voz_plataforma'), false), ['flat', 'faixa', 'progressivo', 'mensalidade']);
	assert.deepEqual(modelosDoItem(item('contratos'), true), ['flat', 'faixa', 'progressivo', 'mensalidade']);
	assert.deepEqual(modelosDoItem({ codigo: 'sms' }, false), ['flat', 'faixa', 'progressivo']);
	assert.equal(modeloInicial(item('voz_plataforma'), null, false), 'mensalidade');
	assert.equal(modeloInicial(item('voz_plataforma'), 'flat', false), 'flat');
	assert.equal(modeloInicial(item('ia_treino_voz'), 'mensalidade', false), 'flat');
	assert.equal(modeloInicial(item('ia_treino_voz'), 'faixa', false), 'faixa');
});

test('Console: franquia padrão em Margem › IA (Master) e tabela/mínimo do Motor e do Agente de voz em Produtos', () => {
	assert.ok(margem.includes("supabase.rpc('salvar_franquia_padrao'"));
	assert.ok(produtos.includes("supabase!.rpc('salvar_preco_padrao'"));
	assert.ok(produtos.includes("supabase!.rpc('salvar_preco_score'"));
	assert.deepEqual([...ITENS_PRECO_PADRAO], ['contratos', 'jornada_clientes', 'voz_plataforma', 'gestao_tronco_sip']);
	// o banco: franquia padrão só com o Master; tabela com editar_produtos; preço da empresa com editar_precos
	assert.match(SQL92, /salvar_franquia_padrao[\s\S]*?admin_equipe\(\)/);
	assert.match(SQL92, /salvar_preco_padrao[\s\S]*?cuida_produtos\(\)/);
	assert.match(SQL92, /public\.salvar_preco_vigencia\(salvar_preco_franquia\.empresa/);
});
