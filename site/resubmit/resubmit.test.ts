// Regras do site para Renitência por situação, Regra por sinalização, Reenviar agora e Contato por passada
// (src/lib/renitencia.ts): as mesmas do banco (SQL 65) e do motor (motor/discagem.py). Só dados fictícios.
// node --experimental-strip-types --test site/resubmit/resubmit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	PADRAO, SITUACOES, FALHAS, calcularPassadas, efetivo, linhaAlterada, mudarCampo, nomeOnda, passadaRuim,
	resumoMudancas, voltarLinha, totalFora, type LinhaPassada,
} from '../src/lib/renitencia.ts';

const SQL = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20270101000001_voz_resubmit.sql', import.meta.url)), 'utf8');

test('o padrão MotorCX do site é o de public.discagem_padrao() (SQL 65)', () => {
	const m = /function public\.discagem_padrao\(\) returns jsonb[\s\S]*?select '([\s\S]*?)'::jsonb/.exec(SQL);
	assert.ok(m);
	assert.deepEqual(JSON.parse(m![1]), PADRAO);
});

test('as situações do site são as do banco', () => {
	const m = /function public\.situacoes_resubmit_voz\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(SQL);
	const doBanco = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
	assert.deepEqual([...SITUACOES.map(s => s.k), ...FALHAS.map(f => f.k)], doBanco);
});

test('carteira sem as chaves novas: valores de hoje e sem a regra por sinalização (paridade)', () => {
	const e = efetivo({ tentativas_numero_dia: 3, intervalo_min_minutos: 90 });
	assert.equal(e.sinal, null);
	assert.equal(e.modo, null);
	assert.equal(e.ren.nao_atendida.intervalo_minutos, 90);
	assert.equal(e.ren.ocupado.intervalo_minutos, 15);
	assert.equal(e.ren.maquina.max_dia, 3);
	assert.equal(e.tec.falha_operadora.religar_minutos, 90);
	assert.equal(efetivo({}).tnum, 2);
});

test('com a regra nova: um intervalo só (rediscar.depois_min) e 3 tentativas por número', () => {
	const e = efetivo({ por_sinalizacao: { ocupado: { rediscar: { depois_min: 20 } } } });
	assert.equal(e.tnum, 3);
	assert.equal(e.ren.ocupado.intervalo_minutos, 20);
	assert.equal(e.ren.nao_atendida.intervalo_minutos, 60);
	assert.equal(e.sinal!.maquina.depois.acao, 'proximo_cliente');
	const v = efetivo({ por_sinalizacao: {}, modo_discagem: { modo: 'vertical' } });
	assert.equal(v.sinal!.maquina.depois.acao, 'proximo_telefone');
});

test('só grava o que mudou; igual ao padrão sai do bloco', () => {
	let d = mudarCampo({}, 'por_situacao', 'ocupado', 'max_dia', 1);
	assert.deepEqual(d.por_situacao, { ocupado: { max_dia: 1 } });
	assert.equal(linhaAlterada(d, 'por_situacao', 'ocupado'), true);
	d = mudarCampo(d, 'por_situacao', 'ocupado', 'max_dia', 2);
	assert.equal(d.por_situacao, undefined);
	d = mudarCampo({}, 'falhas_tecnicas', 'indisponivel', 'aviso', 0.3);
	assert.deepEqual(voltarLinha(d, 'falhas_tecnicas', 'indisponivel'), {});
});

test('resumo das mudanças para o histórico', () => {
	assert.deepEqual(resumoMudancas({}, { por_situacao: { ocupado: { max_dia: 1 } } }), ['Renitência › Ocupado › máx. no dia: 2 → 1']);
	const l = resumoMudancas({ por_sinalizacao: {} }, { por_sinalizacao: { ocupado: { rediscar: { depois_min: 20 } } } });
	assert.deepEqual(l, ['Regra por sinalização › Ocupado › depois de (min): 15 → 20']);
	assert.ok(resumoMudancas({}, { por_sinalizacao: {} }).includes('Regra por sinalização: a de hoje → ligada'));
	assert.deepEqual(resumoMudancas({}, {}), []);
});

test('contato por passada: grupo com menos de 30 chamadas sem percentual e sem custo por contato', () => {
	const l = (passada: number, chamadas: number, contatos: number, taxa: number | null): LinhaPassada =>
		({ passada, chamadas, contatos, taxa, curtas: 0, curtas_pct: null, minutos_ia: chamadas, custo_operadora: chamadas * 0.05, sem_custo: 0 });
	const rows = calcularPassadas([l(2, 1000, 12, 1.2), l(1, 5000, 500, 10), l(3, 20, 1, 5)], 0.5);
	assert.deepEqual(rows.map(r => r.passada), [1, 2, 3]);
	assert.equal(rows[2].taxa, null);
	assert.equal(rows[2].cpc, null);
	assert.equal(rows[1].acum, 512);
	assert.equal(passadaRuim(rows)?.passada, 2);
	assert.equal(calcularPassadas([l(1, 100, 10, 10)], null)[0].custo, 5);
});

test('ondas pelo nome da origem e prévia', () => {
	const o = { id: 1, janela: 'x', tentativa: 2, total: 1, encerradas: 0, situacao: 'ligando', abre_em: null, fecha_em: null };
	assert.equal(nomeOnda({ ...o, origem: 'rediscagem', passada: 2, situacao_origem: 'ocupado', prioridade: 'topo' }).nome, 'Rediscagem · Ocupado');
	assert.equal(nomeOnda({ ...o, origem: 'spin', passada: 2 }).nome, 'Spin 2');
	assert.equal(nomeOnda({ ...o, janela: 'SP' }).nome, 'SP');
	assert.equal(totalFora({ selecionados: 5, volta: 2, volta_outro_numero: 0, espera_intervalo: 0, fora: { max_dia: 2, nao_ligar: 1 } }), 3);
});
