// Robôs contratados (licenças), PR 3 (npm test): a prévia da tela faz as mesmas contas do SQL 98 (os números são os
// do supabase/testes/testar_licencas_fatura.py), regras de bloqueio do SQL 93, avisos dos riscos, limite real,
// overbooking e os itens da fatura do agente (ITENS_FATURA_VOZ).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	avisos, bloqueios, diasEntre, franquiaCiclo, licencaEm, limiteReal, linhasLicenca, previaCiclo, segmentos, somarDias,
	totalMes, vendidoCom, type Edicao, type Licenca,
} from './licencas-voz';
import { ITENS_FATURA_VOZ, ehItemFaturaVoz } from './voz';
import { ROTAS_PAI, rotaPai } from './rota-pai';

const SQL98 = readFileSync('../supabase/migrations/20270205000001_voz_licencas_fatura.sql', 'utf8');
const SQL93 = readFileSync('../supabase/migrations/20270129000001_voz_licencas.sql', 'utf8');

const L = (vigente_desde: string, robos: number, x: Partial<Licenca> = {}): Licenca => ({
	vigente_desde, robos, modelo: 'por_robo', preco_robo: 6000, valor_fechado: null, franquia_min_robo: 4000,
	transcricao_inclusa: true, ...x,
});
const resumo = (ls: { item: string; valor: number }[]) => ls.map(l => `${l.item}=${l.valor.toFixed(2)}`).join(',');

test('datas: dias entre e somar dias (sem fuso)', () => {
	assert.equal(diasEntre('2026-03-01', '2026-03-31'), 30);
	assert.equal(somarDias('2026-02-28', 1), '2026-03-01');
	assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
});

test('vigência: a última com início até o dia; no mesmo dia, a gravação mais nova', () => {
	const ls = [L('2026-01-01', 10, { id: 1 }), L('2026-03-20', 12, { id: 3 }), L('2026-03-20', 14, { id: 4 })];
	assert.equal(licencaEm(ls, '2026-03-19')?.robos, 10);
	assert.equal(licencaEm(ls, '2026-03-20')?.robos, 14);
	assert.equal(licencaEm(ls, '2025-12-31'), null);
	assert.deepEqual(segmentos(ls, '2026-03-01', '2026-03-31').map(s => s.nd), [19, 0, 12]);
});

test('fatura igual ao SQL 98: início no meio do ciclo, ciclo cheio e aumento com pro rata', () => {
	const a = [L('2026-01-10', 10), L('2026-03-15', 15)];
	assert.equal(resumo(linhasLicenca(a, '2026-01-01', '2026-01-31')), 'voz_licenca_robo_ajuste=42580.65');
	assert.equal(linhasLicenca(a, '2026-01-01', '2026-01-31')[0].descricao, 'Agente virtual · robôs (licenças) · início em 10/01, 10 robôs (22 de 31 dias)');
	assert.equal(resumo(linhasLicenca(a, '2026-02-01', '2026-02-28')), 'voz_licenca_robo=60000.00');
	const mar = linhasLicenca(a, '2026-03-01', '2026-03-31');
	assert.equal(resumo(mar), 'voz_licenca_robo=60000.00,voz_licenca_robo_ajuste=16451.61');
	assert.deepEqual([mar[1].quantidade, mar[1].preco], [2.7419, 6000]);
	assert.equal(franquiaCiclo(a, '2026-03-01', '2026-03-31').franquia, 50968);
});

test('fatura igual ao SQL 98: valor fechado, troca de preço com crédito e duas no mesmo dia', () => {
	const b = [L('2026-02-01', 20, { modelo: 'valor_fechado', preco_robo: null, valor_fechado: 130000, transcricao_inclusa: false }),
		L('2026-03-21', 25, { modelo: 'valor_fechado', preco_robo: null, valor_fechado: 150000, transcricao_inclusa: false })];
	const lb = linhasLicenca(b, '2026-03-01', '2026-03-31');
	assert.equal(resumo(lb), 'voz_licenca_robo=130000.00,voz_licenca_robo_ajuste=7096.77');
	assert.deepEqual([lb[1].quantidade, lb[1].preco], [0.3548, 20000]);
	assert.equal(franquiaCiclo(b, '2026-03-01', '2026-03-31').franquia, 87097);
	const c = [L('2026-01-01', 10, { id: 1 }), L('2026-03-11', 10, { id: 2, preco_robo: 5000 }),
		L('2026-03-20', 12, { id: 3, preco_robo: 5000 }), L('2026-03-20', 14, { id: 4, preco_robo: 5000 })];
	assert.equal(resumo(linhasLicenca(c, '2026-03-01', '2026-03-31')),
		'voz_licenca_robo=60000.00,voz_licenca_robo_ajuste=-6774.19,voz_licenca_robo_ajuste_2=7741.94');
});

test('fatura igual ao SQL 98: ciclo com dia de corte 15 e licença zerada', () => {
	const f = [L('2026-03-01', 5), L('2026-04-01', 8)];
	assert.equal(resumo(linhasLicenca(f, '2026-03-15', '2026-04-14')), 'voz_licenca_robo=30000.00,voz_licenca_robo_ajuste=8129.03');
	const g = [L('2026-01-01', 3), L('2026-03-01', 0)];
	assert.deepEqual(linhasLicenca(g, '2026-03-01', '2026-03-31'), []);
	assert.equal(franquiaCiclo(g, '2026-03-01', '2026-03-31').tem, false);
});

test('prévia do ciclo: plataforma e transcrição incluídas, franquia, excedente e tronco', () => {
	const p = previaCiclo({ licencas: [L('2026-02-01', 10)], inicio: '2026-03-01', fim: '2026-03-31', minutosIA: 41032,
		precoMinutoIA: 2, minutosTranscricao: 300, precoTranscricao: 0.1, troncos: 2, precoTronco: 200 });
	assert.equal(resumo(p.linhas), 'voz_licenca_robo=60000.00,voz_plataforma=0.00,voz_minuto_ia_franquia=0.00,voz_minuto_ia=2064.00,voz_transcricao=0.00,gestao_tronco_sip=400.00');
	assert.deepEqual([p.franquia, p.excedente, p.total], [40000, 1032, 62464]);
	const sem = previaCiclo({ licencas: [L('2026-02-01', 10, { transcricao_inclusa: false })], inicio: '2026-03-01', fim: '2026-03-31',
		minutosIA: 0, precoMinutoIA: 2, minutosTranscricao: 1000, precoTranscricao: 0.1, troncos: 0, precoTronco: null });
	assert.equal(sem.linhas.find(l => l.item === 'voz_transcricao')?.valor, 100);
});

test('limite real: o menor de licenças, canais e parte do teto, com o motivo', () => {
	assert.deepEqual(limiteReal(10, 20, 30), { limite: 10, motivo: 'licencas' });
	assert.deepEqual(limiteReal(10, 6, 30), { limite: 6, motivo: 'tronco' });
	assert.deepEqual(limiteReal(10, 20, 4), { limite: 4, motivo: 'teto' });
	assert.deepEqual(limiteReal(10, null, null), { limite: 10, motivo: 'licencas' });
});

test('overbooking: vendido = as outras empresas no dia + a proposta', () => {
	const todas = [{ ...L('2026-01-01', 10), empresa_id: 1 }, { ...L('2026-01-01', 30), empresa_id: 2 }, { ...L('2026-12-01', 50), empresa_id: 2 }];
	assert.equal(vendidoCom(todas, 1, '2026-11-10', 15), 45);
	assert.equal(vendidoCom(todas, 1, '2026-12-01', 15), 65);
	assert.equal(totalMes(L('2026-01-01', 3)), 18000);
});

const ED: Edicao = { robos: 15, modelo: 'por_robo', preco: 6000, fechado: null, inicio: 'agora', fidelidade: 0, fidelidadeMin: 0, franquia: 4000, transcricao: true, motivo: 'Cliente ampliou a carteira.' };

test('bloqueios do SQL 93: redução só no próximo ciclo, fidelidade, motivo', () => {
	const atual = L('2026-01-01', 10, { fidelidade_meses: 12, fidelidade_ate: '2026-12-31', fidelidade_min: 10 });
	assert.deepEqual(bloqueios({ ...ED, fidelidade: 12, fidelidadeMin: 10 }, atual, '2026-11-10'), []);
	assert.match(bloqueios({ ...ED, robos: 8, fidelidade: 12, fidelidadeMin: 8 }, atual, '2026-11-10').join(' '), /próximo ciclo/);
	assert.match(bloqueios({ ...ED, robos: 8, inicio: 'proximo', fidelidade: 12, fidelidadeMin: 8 }, atual, '2026-12-01').join(' '), /mínimo de 10 robôs/);
	assert.match(bloqueios({ ...ED, fidelidade: 0 }, atual, '2026-11-10').join(' '), /tirar antes do fim/);
	assert.match(bloqueios({ ...ED, franquia: 3000, fidelidade: 12, fidelidadeMin: 10 }, atual, '2026-11-10').join(' '), /próximo ciclo/);
	assert.match(bloqueios({ ...ED, motivo: 'ok' }, null, '2026-11-10').join(' '), /motivo/);
	assert.match(bloqueios({ ...ED, modelo: 'valor_fechado', fechado: 1000, robos: 0 }, null, '2026-11-10').join(' '), /pelo menos 1 robô/);
});

test('avisos dos riscos: mudança agendada continua valendo; preço "agora" pelos dias; crédito', () => {
	const lista = [L('2026-01-01', 10), L('2026-12-01', 8)];
	const a = avisos({ ed: ED, atual: lista[0], lista, hoje: '2026-11-10', proximoCiclo: '2026-12-01' });
	assert.match(a.join(' '), /agendada para 01\/12\/2026 \(8 robôs\)/);
	const b = avisos({ ed: { ...ED, robos: 10, preco: 5000 }, atual: L('2026-01-01', 10), lista: [L('2026-01-01', 10)], hoje: '2026-11-10', proximoCiclo: '2026-12-01' });
	assert.match(b.join(' '), /pelos dias em que valeu/);
	assert.match(b.join(' '), /crédito pro rata/);
	assert.deepEqual(avisos({ ed: { ...ED, inicio: 'proximo' }, atual: L('2026-01-01', 10), lista: [L('2026-01-01', 10)], hoje: '2026-11-10', proximoCiclo: '2026-12-01' }), []);
});

test('o site conhece as linhas que o SQL 98 grava e a assinatura de salvar_licencas_voz', () => {
	for (const it of ['voz_licenca_robo_ajuste', 'voz_minuto_ia_franquia']) assert.ok(SQL98.includes(it), it);
	assert.ok((ITENS_FATURA_VOZ as readonly string[]).includes('voz_licenca_robo'));
	for (const it of ['voz_licenca_robo', 'voz_licenca_robo_ajuste', 'voz_licenca_robo_ajuste_2', 'voz_minuto_ia_franquia', 'voz_minuto_ia_minimo', 'gestao_tronco_sip'])
		assert.ok(ehItemFaturaVoz(it), it);
	for (const it of ['sms', 'ia_speech_analytics', 'contratos', '']) assert.ok(!ehItemFaturaVoz(it), it);
	const tela = readFileSync('src/components/workspace/empresa/robos-contratados.tsx', 'utf8');
	const params = SQL93.match(/function public\.salvar_licencas_voz\(([\s\S]*?)\)\s*returns/)?.[1]
		.split(',').map(p => p.trim().split(/\s+/)[0]) ?? [];
	assert.ok(params.length === 13);
	const usados = [...tela.matchAll(/rpc\('salvar_licencas_voz', \{([^}]*)\}/g)].flatMap(m => [...m[1].matchAll(/(\w+):/g)].map(x => x[1]));
	assert.ok(usados.length > 0);
	for (const u of usados) assert.ok(params.includes(u), `parâmetro inexistente: ${u}`);
});

test('voltar: editar e histórico voltam para a Contratação', () => {
	for (const r of ['/empresa/contratacao/robos', '/empresa/contratacao/robos/historico']) {
		assert.ok(r in ROTAS_PAI);
		assert.deepEqual(rotaPai(r, { equipe: true }), { to: '/empresa/contratacao', rotulo: 'Contratação' });
	}
});
