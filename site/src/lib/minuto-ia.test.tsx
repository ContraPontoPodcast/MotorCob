// Minuto falado com a IA (npm test): a tarifação da tela com a MESMA tabela de casos do banco e da VM
// (tests/dados/tarifacao_ia_casos.json), as planilhas do demonstrativo e o total como na fatura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cadenciaIa, csvLigacoesIa, csvResumoIa, exemploCadencia, milesimos, segundosTarifadosIa, totalMesIa, valorIa } from './minuto-ia';
import { ehItemFaturaVoz } from './voz';
import { rotaPai } from './rota-pai';

const CASOS = JSON.parse(readFileSync('../tests/dados/tarifacao_ia_casos.json', 'utf8')) as {
	casos: { nome: string; cadencia: string; segundos: number; tarifados: number }[];
	chamadas: { nome: string; cadencia: string; trechos: number[][]; segundos_ia: number; tarifados: number }[];
};

test('tarifação igual ao banco e à VM (mesma tabela de casos)', () => {
	for (const c of CASOS.casos) assert.equal(segundosTarifadosIa(c.segundos, ...cadenciaIa(c.cadencia)), c.tarifados, c.nome);
	for (const c of CASOS.chamadas) {
		const soma = c.trechos.reduce((t, [i, f]) => t + (f - i), 0);
		assert.equal(segundosTarifadosIa(soma, ...cadenciaIa(c.cadencia)), c.tarifados, c.nome);
	}
});

test('milésimos e exemplo da cadência', () => {
	assert.equal(milesimos(36.0005), 36001);
	assert.equal(milesimos(36.0004), 36000);
	assert.equal(exemploCadencia(47, 0, 30, 6), 'uma conversa de 47 s é cobrada como 48 s');
	assert.equal(valorIa(48, 1.25), 1);
});

test('planilhas: ; com BOM e vírgula decimal, sem telefone nem cliente', () => {
	const csv = csvLigacoesIa([{ id_chamada: 'abc', dia: '2026-10-05', segundos_ia: 47.25, segundos_ia_tarifados: 48, cadencia_ia: '0/30/6', preco_minuto_ia: 1.25, valor_ia: 1, desfecho: 'cpc' },
		{ id_chamada: 'def', dia: '2026-10-05', segundos_ia: 0, segundos_ia_tarifados: 0, desfecho: 'caixa_postal' }]);
	assert.ok(csv.startsWith('﻿id_chamada;dia;'));
	assert.match(csv, /abc;05\/10\/2026;.*47,25;48;0\/30\/6;1,25;1;cpc;/);
	assert.match(csv, /não cobrada/);
	assert.doesNotMatch(csv, /telefone|id_cliente/);
	assert.match(csvResumoIa([{ dia: '2026-10-05', modelo: 'por_minuto', segundos_ia_tarifados: 78, valor: 1.625 }]), /;1,3;1,625/);
});

test('total do mês arredonda só no total, por preço (P5)', () => {
	const t = totalMesIa([{ segundos_ia_tarifados: 48, preco_minuto_ia: 1.25, valor: 1, ligacoes: 1, ligacoes_cobradas: 1 },
		{ segundos_ia_tarifados: 30, preco_minuto_ia: 1.25, valor: 0.625, ligacoes: 2, ligacoes_cobradas: 1 }]);
	assert.deepEqual([t.tarifados, t.minutos, t.valor, t.ligacoes, t.cobradas], [78, 1.3, 1.63, 3, 2]);
});

test('linhas novas da fatura do minuto falado contam como do agente', () => {
	for (const it of ['voz_minuto_ia', 'voz_minuto_ia_2', 'voz_minuto_ia_franquia', 'voz_minuto_ia_minimo']) assert.ok(ehItemFaturaVoz(it), it);
	assert.ok(!ehItemFaturaVoz('voz_minuto_ia_x'));
});

test('demonstrativo volta para o Faturamento', () => {
	assert.deepEqual(rotaPai('/empresa/faturamento/demonstrativo'), { to: '/empresa/faturamento', rotulo: 'Faturamento' });
});
