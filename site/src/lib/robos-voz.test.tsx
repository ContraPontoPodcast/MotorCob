// Robôs contratados (licenças), PR 5 (npm test): totais do Console (teto × vendidos × usáveis × sobra), estado do teto,
// "por quê" da equipe e do cliente (o cliente nunca vê o teto global) e o cartão do Console renderizado sem banco. Os
// números dos cenários são os do supabase/testes/testar_licencas_divisao.py (SQL 101).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { comLicenca, linhaDivisao, porQueCliente, porQueEquipe, resumoRobos, type LinhaDivisao } from './robos-voz';
import { RobosTeto } from '@/components/workspace/console/console-voz-robos';

const SQL101 = readFileSync('../supabase/migrations/20270214000001_voz_licencas_divisao.sql', 'utf8');

const L = (empresa_id: number, canais: number, limite: number, licencas: number | null, motivo: LinhaDivisao['motivo']): LinhaDivisao =>
	({ empresa_id, canais, limite, teto: limite, pico_multiplo: 1, licencas, motivo, contratado: 10 });

// overbooking do teste do SQL 101: teto 10; A 8 robôs/10 canais, B 6/6, C 4/2, D sem licença 5 canais
const OVER = [L(1, 10, 5, 8, 'teto'), L(2, 6, 4, 6, 'teto'), L(3, 2, 1, 4, 'teto'), L(4, 5, 0, null, 'legado')];

test('robôs: o SQL 101 devolve as colunas que a tela lê', () => {
	for (const c of ['licencas int', 'motivo text', 'limite int', 'canais int', 'contratado int']) assert.ok(SQL101.includes(c), c);
	for (const m of ["'teto'", "'tronco'", "'licencas'", "'legado'"]) assert.ok(SQL101.includes(m), m);
});

test('robôs: linha crua → tipada; banco sem o SQL 101 vira legado', () => {
	assert.deepEqual(linhaDivisao({ empresa_id: '7', canais: 4, limite: 3, teto: 3, pico_multiplo: 1, licencas: 5, motivo: 'tronco', contratado: null }),
		{ empresa_id: 7, canais: 4, limite: 3, teto: 3, pico_multiplo: 1, licencas: 5, motivo: 'tronco', contratado: null });
	const velha = linhaDivisao({ empresa_id: 1, canais: 30, limite: 7, teto: 14, pico_multiplo: 2, contratado: 10 });
	assert.equal(velha.motivo, 'legado');
	assert.equal(velha.licencas, null);
	assert.equal(comLicenca(velha), false);
	assert.equal(comLicenca(L(1, 0, 0, 0, 'legado')), false);
});

test('robôs: overbooking (vendidos 18, usáveis 16, sobra 0, limite total 10)', () => {
	const r = resumoRobos(OVER, 10);
	assert.deepEqual(r, { teto: 10, vendidos: 18, pct: 180, usaveis: 16, sobra: 0, semLicenca: 1, limiteTotal: 10, estado: 'over' });
});

test('robôs: dentro do teto, quase no teto e sem teto', () => {
	const cabe = [L(1, 10, 5, 5, 'licencas'), L(2, 4, 4, 8, 'tronco'), L(3, 6, 6, null, 'legado')];
	assert.deepEqual(resumoRobos(cabe, 20), { teto: 20, vendidos: 13, pct: 65, usaveis: 9, sobra: 11, semLicenca: 1, limiteTotal: 15, estado: 'dentro' });
	assert.equal(resumoRobos([L(1, 20, 18, 18, 'licencas')], 20).estado, 'quase');
	assert.equal(resumoRobos([], 0).estado, 'dentro');
	assert.equal(resumoRobos([L(1, 5, 0, 3, 'teto')], 0).estado, 'over');
});

test('robôs: por quê da equipe', () => {
	assert.equal(porQueEquipe(L(1, 10, 5, 5, 'licencas')), 'Igual às licenças.');
	assert.equal(porQueEquipe(L(1, 4, 4, 8, 'tronco')), 'O tronco tem 4 canais: limita a 4, não 8.');
	assert.match(porQueEquipe(L(1, 0, 0, 6, 'tronco')), /Sem tronco ativo: não disca/);
	assert.match(porQueEquipe(OVER[0]), /cai para 5 de 8 \(corte proporcional\)/);
	assert.match(porQueEquipe(OVER[3]), /não disca/);
	assert.match(porQueEquipe(L(4, 5, 5, null, 'legado')), /até os canais/);
	assert.match(porQueEquipe(L(4, 5, 2, null, 'legado')), /só a sobra do teto global \(2\)/);
});

test('robôs: o cliente nunca vê o teto global', () => {
	const t = porQueCliente(OVER[0]);
	assert.match(t, /Limite temporário da plataforma: 5 de 8 robôs/);
	assert.doesNotMatch(t, /teto|vendid|outras empresas/i);
	assert.match(porQueCliente(L(1, 4, 4, 8, 'tronco')), /Seu tronco tem 4 canais: hoje dá para usar 4 dos 8 robôs/);
	assert.equal(porQueCliente(L(1, 10, 5, 5, 'licencas')), '');
	for (const l of [...OVER, L(1, 4, 4, 8, 'tronco'), L(1, 0, 0, 6, 'tronco')]) assert.doesNotMatch(porQueCliente(l), /teto global|contratado com o provedor/i);
});

test('robôs: o cartão do Console mostra KPIs, marco do teto, alerta de overbooking e o por quê', () => {
	const html = renderToStaticMarkup(
		<RobosTeto divisao={OVER.map(l => ({ ...l }))} contrato={{ concorrencia_contratada: 10 }} nomeEmpresa={id => `Empresa ${String(id)}`}
			podeTroncos loading={false} onSalvo={() => {}} onEscolher={() => {}} />,
	);
	assert.match(html, /Robôs vendidos × teto contratado/);
	assert.match(html, /Overbooking/);
	assert.match(html, /Vendido 18 para um teto de 10 \(180%\)/);
	assert.match(html, /teto 10/);
	assert.match(html, /Teto global limita/);
	assert.match(html, /Sem licença/);
	assert.match(html, /Salvar teto/);
	assert.doesNotMatch(html, /Falta o SQL 101/);
	const velho = renderToStaticMarkup(
		<RobosTeto divisao={[{ empresa_id: 1, canais: 30, limite: 7, teto: 7, pico_multiplo: 1, contratado: 10 }]} contrato={{ concorrencia_contratada: 10 }}
			nomeEmpresa={() => 'X'} podeTroncos={false} loading={false} onSalvo={() => {}} onEscolher={() => {}} />,
	);
	assert.match(velho, /Falta o SQL 101/);
	assert.match(velho, /Nenhum robô vendido ainda/);
	assert.match(velho, /permissão de troncos de voz/);
});
