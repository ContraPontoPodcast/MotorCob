// Estado dos canais (npm test): rótulos e ordem do resumo, toda ação da RPC (SQL 84) com rótulo e rota que existe,
// formatação pt-BR no horário de São Paulo, linhas de "última atividade" por quem executa, o cartão do canal (sem campo,
// sem cor fixa) e a permissão de editar Canais = editar_canais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
	acaoDe, CANAIS_TELA, chipsResumo, dia, ehCanalTela, identidade, instante, linhasAtividade, quemTexto, valorSinal,
	type CanalEstado, type Trecho,
} from './estado-canais';
import { rotaPai } from './rota-pai';
import { CartaoCanal } from '@/components/canais/visao-geral';

const SQL = readFileSync('../supabase/migrations/20270120000001_estado_canais.sql', 'utf8');
const routesTs = readFileSync('src/routes.ts', 'utf8');
const declaradas = [...routesTs.matchAll(/route\('([^']+)'/g)].map(m => `/${m[1]}`);
const padrao = (r: string) => new RegExp(`^${r.split('/').filter(Boolean).map(seg => (seg.startsWith(':') ? (seg.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+') : `/${seg}`)).join('')}$`);
const abre = (c: string) => declaradas.some(r => padrao(r).test(c));
const texto = (t: Trecho[]) => t.map(x => x.t).join('');

test('resumo: só estados com canal, na ordem do protótipo, com plural', () => {
	assert.deepEqual(chipsResumo({ pausado: 1, funcionando: 2, com_problema: 2, nao_configurado: 1 }).map(x => x.texto),
		['2 funcionando', '2 com problema', '1 pausado', '1 não configurado']);
	assert.deepEqual(chipsResumo({ atencao: 1, pausado: 2, nao_configurado: 3 }).map(x => x.texto),
		['1 com atenção', '2 pausados', '3 não configurados']);
	assert.deepEqual(chipsResumo({}), []);
});

test('toda ação que a RPC devolve tem rótulo próprio e abre uma rota declarada, para os 6 canais', () => {
	const acoes = new Set([...SQL.matchAll(/'acao', '([a-z_]+)'/g)].map(m => m[1]));
	for (const a of ['ver_envios', 'agente_voz', 'baixar_lista']) acoes.add(a); // padrões quando está tudo bem
	assert.ok(acoes.size >= 12, `poucas ações lidas do SQL: ${[...acoes]}`);
	for (const a of acoes) {
		for (const c of CANAIS_TELA) {
			const x = acaoDe(a, c);
			if (a !== 'retomar') assert.notEqual(x.rotulo, 'Configurar', `ação sem rótulo: ${a}`);
			assert.ok(abre(x.to.split('?')[0]), `rota inexistente: ${a} → ${x.to}`);
		}
	}
	assert.equal(acaoDe('suporte', 'rcs').rotulo, 'Pedir a verificação');
	assert.equal(acaoDe('score_entrega', 'sms').to, '/mensageria/sms/score');
	assert.equal(acaoDe('xyz', 'sms').to, '/canais/sms');
});

test('os 6 canais: rota do canal, Voltar para Canais e nomes', () => {
	for (const c of CANAIS_TELA) {
		assert.ok(abre(`/canais/${c}`), c);
		assert.deepEqual(rotaPai(`/canais/${c}`), { to: '/canais', rotulo: 'Canais' });
	}
	assert.equal(rotaPai('/canais'), null, 'a visão geral é tela de menu');
	assert.ok(ehCanalTela('discador') && !ehCanalTela('agente-virtual') && !ehCanalTela(undefined));
	assert.equal(identidade('agente_voz', 'lista').nome, 'Agente de voz do cliente (AGV)');
	assert.equal(identidade('agente_voz', 'voz_motorcx').nome, 'Agente de voz');
	assert.equal(quemTexto('email', 'lista'), 'Lista para baixar · seu fornecedor envia');
	assert.equal(quemTexto('discador', 'voz_motorcx'), 'Voz MotorCX liga e transfere para seus operadores');
	assert.equal(quemTexto('agente_voz', 'lista'), 'Lista para baixar · o seu AGV liga');
	assert.equal(quemTexto('sms', 'motorcx'), 'MotorCX envia');
});

test('datas no horário de São Paulo, relativas ao hoje da RPC', () => {
	assert.equal(dia('2026-11-08', '2026-11-08'), 'hoje');
	assert.equal(dia('2026-11-07', '2026-11-08'), 'ontem');
	assert.equal(dia('2026-10-31', '2026-11-01'), 'ontem', 'virada de mês');
	assert.equal(dia('2026-11-02', '2026-11-08'), '02/11');
	assert.equal(instante('2026-11-08T13:42:00Z', '2026-11-08'), 'hoje, 10:42');
	assert.equal(instante('2026-11-08T01:05:00Z', '2026-11-08'), 'ontem, 22:05', '01:05 UTC ainda é ontem em São Paulo');
	assert.equal(instante(null, '2026-11-08'), '—');
	assert.equal(valorSinal({ chave: 'x', rotulo: 'x', tipo: 'pct', valor: 96.1, detalhe: null, ruim: false }, '2026-11-08'), '96,1%');
	assert.equal(valorSinal({ chave: 'x', rotulo: 'x', tipo: 'numero', valor: 18240, detalhe: null, ruim: false }, '2026-11-08'), '18.240');
	assert.equal(valorSinal({ chave: 'x', rotulo: 'x', tipo: 'pct', valor: null, detalhe: null, ruim: false }, '2026-11-08'), '—');
});

const HOJE = '2026-11-08';
const base = (x: Partial<CanalEstado>): CanalEstado => ({
	canal: 'sms', grupo: 'mensagens', quem: 'motorcx', estado: 'funcionando', motivo: null, problema: null, o_que_fazer: null,
	acao: 'ver_envios', ultima_atividade: null, sinais: [], problemas: [], ...x,
});
const SMS_PROBLEMA = base({
	estado: 'com_problema', motivo: 'entrega_baixa', acao: 'score_entrega', ultima_atividade: '2026-11-08T13:15:00Z',
	problema: 'A entrega caiu para 71% nas últimas 24 h (a média dos 7 dias anteriores é 93%).',
	o_que_fazer: 'Abra o Score de entrega para ver em qual operadora caiu.',
	sinais: [
		{ chave: 'ultimo_envio', rotulo: 'Último envio', tipo: 'data', valor: '2026-11-08T13:15:00Z', detalhe: null, ruim: false },
		{ chave: 'enviadas_24h', rotulo: 'Enviadas 24 h', tipo: 'numero', valor: 41900, detalhe: null, ruim: false },
		{ chave: 'entregues_24h', rotulo: 'Entregues 24 h', tipo: 'pct', valor: 71.4, detalhe: 'média 7 d: 93%', ruim: true },
	],
});

test('última atividade: MotorCX envia, Voz MotorCX, lista e pausado', () => {
	assert.deepEqual(linhasAtividade(SMS_PROBLEMA, HOJE).map(texto), ['Último envio: hoje, 10:15', '41.900 enviadas em 24 h · 71,4% entregues']);
	assert.deepEqual(linhasAtividade(base({ canal: 'rcs', estado: 'nao_configurado' }), HOJE).map(texto), ['Nunca enviou.']);
	const voz = base({
		canal: 'discador', grupo: 'voz', quem: 'voz_motorcx', ultima_atividade: '2026-11-08T13:00:00Z', sinais: [
			{ chave: 'ligacoes_24h', rotulo: '', tipo: 'numero', valor: 2106, detalhe: null, ruim: false },
			{ chave: 'atendidas_24h', rotulo: '', tipo: 'pct', valor: 41, detalhe: null, ruim: false },
			{ chave: 'transferidas_24h', rotulo: '', tipo: 'numero', valor: 318, detalhe: null, ruim: false },
			{ chave: 'lote_hoje', rotulo: '', tipo: 'pct', valor: 58, detalhe: 'ligando agora', ruim: false },
		],
	});
	assert.deepEqual(linhasAtividade(voz, HOJE).map(texto), ['Ligando agora: lote de hoje, 58%', '2.106 ligações em 24 h · 41% atendidas · 318 transferidas a operador']);
	const lista = base({
		canal: 'email', quem: 'lista', sinais: [
			{ chave: 'ultima_lista', rotulo: '', tipo: 'data_dia', valor: '2026-11-08', detalhe: '9.320 clientes', ruim: false },
			{ chave: 'ultimo_retorno', rotulo: '', tipo: 'data', valor: null, detalhe: 'nunca chegou', ruim: false },
		],
	});
	assert.deepEqual(linhasAtividade(lista, HOJE).map(texto), ['Última lista: hoje · 9.320 clientes', 'O retorno do fornecedor nunca chegou.']);
	const pausado = base({ estado: 'pausado', sinais: [{ chave: 'pausado_desde', rotulo: '', tipo: 'data', valor: '2026-11-02T15:00:00Z', detalhe: null, ruim: false }] });
	assert.equal(texto(linhasAtividade(pausado, HOJE)[0]), 'Pausado desde 02/11.');
});

const cartao = (c: CanalEstado) => renderToStaticMarkup(<MemoryRouter><CartaoCanal c={c} hoje={HOJE} /></MemoryRouter>);

test('cartão com problema: estado, quem envia, problema + o que fazer, ação principal e Configurar; sem campo', () => {
	const s = cartao(SMS_PROBLEMA);
	assert.match(s, /Com problema/);
	assert.match(s, /MotorCX envia/);
	assert.match(s, /A entrega caiu para 71%/);
	assert.match(s, /Abra o Score de entrega/);
	assert.match(s, /href="\/mensageria\/sms\/score"[^>]*>Ver o Score de entrega/);
	assert.match(s, /href="\/canais\/sms"[^>]*>Configurar/);
	assert.doesNotMatch(s, /<(input|select|textarea)\b/, 'a visão geral não tem campo');
	assert.doesNotMatch(s, /#[0-9a-fA-F]{6}\b|bg-white/, 'só cores do tema');
});

test('cartão funcionando não mostra caixa de problema; pausado mostra Retomar', () => {
	const ok = cartao(base({ problema: null, sinais: SMS_PROBLEMA.sinais.slice(0, 2) }));
	assert.match(ok, /Funcionando/);
	assert.doesNotMatch(ok, /O que fazer|caiu/);
	const p = cartao(base({ canal: 'email', quem: 'lista', estado: 'pausado', acao: 'retomar', problema: 'Canal pausado desde 02/11.' }));
	assert.match(p, /Pausado/);
	assert.match(p, /href="\/canais\/email"[^>]*>Retomar/);
});

test('Canais e Frases: editar exige editar_canais (o código do menu), não qualquer editar_*', () => {
	for (const arq of ['src/components/canais/canal-tela.tsx', 'src/components/canais/frases.tsx', 'src/components/canais/visao-geral.tsx']) {
		const s = readFileSync(arq, 'utf8');
		assert.doesNotMatch(s, /useAllowed\(/, arq);
		assert.match(s, /usePermissao\(PERM\.editarCanais\)/, arq);
	}
	assert.match(readFileSync('src/lib/abas.ts', 'utf8'), /nome: 'Canais', to: '\/canais', icon: Settings, perm: PERM\.editarCanais/);
});
