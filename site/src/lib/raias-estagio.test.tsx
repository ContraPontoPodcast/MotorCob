// Raias por persona dentro do estágio (passo Régua): colunas "Dia N do ciclo", ↻ × N, raias e a ordem dos canais na
// célula igual ao motor (os MESMOS casos de tests/dados/raias_semantica.json rodam em tests/test_raias_estagio.py).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Acao, Definicao, Etapa } from '@/lib/estrategia';
import {
	adicionarRaia, conectorDoModo, diasDoEstagio, finalDoEstagio, leituraDaCelula, modeloRaias, quemRecebe,
	removerRaia, resumoDoEstagio, rotuloCurto, simularCelula,
} from '@/lib/raias-estagio';

type Caso = { nome: string; acoes: Acao[]; com_contato: string[]; esperado: [string, string][] };
const CASOS: Caso[] = JSON.parse(readFileSync(join(process.cwd(), '..', 'tests', 'dados', 'raias_semantica.json'), 'utf8')).casos;

test('ordem dos canais na célula = motor (estrategia.resolver), caso a caso', () => {
	assert.ok(CASOS.length >= 10);
	for (const c of CASOS) {
		const com = new Set(c.com_contato);
		assert.deepEqual(simularCelula(c.acoes, a => com.has(a.canal)), c.esperado, c.nome);
	}
});

test('conectores e leitura da célula dizem o que o motor faz', () => {
	assert.equal(conectorDoModo('senao', true), '');
	assert.equal(conectorDoModo('senao', false), '↳ senão');
	assert.equal(conectorDoModo(undefined, false), '↳ senão');
	assert.equal(conectorDoModo('junto', false), '+ junto');
	assert.equal(conectorDoModo('reserva', false), '↻ reserva');
	assert.equal(conectorDoModo('sempre', false), 'e sempre');
	const l = leituraDaCelula([{ canal: 'agente_voz', modo: 'sempre' }, { canal: 'discador', modo: 'reserva' }, { canal: 'email', modo: 'junto' }], c => c);
	assert.deepEqual(l, [
		'agente_voz: vai se houver contato',
		'discador: se agente_voz foi, só se agente_voz não contatar no dia; se não foi, vai no lugar',
		'email: junto, se a ação de cima foi',
	]);
});

test('raia da persona: só ela; sem contato → Público geral; "sem ação" → nada; sem raia → geral', () => {
	const dia: Acao[] = [
		{ canal: 'sms', modo: 'sempre' },
		{ canal: 'rcs', modo: 'sempre', personas: ['7'] },
		{ canal: 'sem_acao', modo: 'sempre', personas: ['8'] },
	];
	const todos = () => true;
	assert.deepEqual(quemRecebe(dia, '7', todos), { raia: 'persona', canais: [['rcs', '']] });
	assert.deepEqual(quemRecebe(dia, '7', a => a.canal !== 'rcs'), { raia: 'geral', canais: [['sms', '']] });
	assert.deepEqual(quemRecebe(dia, '8', todos), { raia: 'nada', canais: [] });
	assert.deepEqual(quemRecebe(dia, '9', todos), { raia: 'geral', canais: [['sms', '']] });
	assert.deepEqual(quemRecebe(dia, null, todos), { raia: 'geral', canais: [['sms', '']] });
});

const DEF: Definicao = {
	localizacao: {
		dias_sem_contato_para_ncp: 4,
		passos: {
			'1': [{ canal: 'sms', modo: 'sempre' }, { canal: 'discador', modo: 'reserva' }, { canal: 'sms', modo: 'sempre', personas: ['7'] }],
			'2': [{ canal: 'rcs', modo: 'sempre' }, { canal: 'whatsapp', modo: 'sempre', personas: ['8'] }],
			'3': [{ canal: 'discador', modo: 'sempre' }],
		},
	},
	giro: { ciclo_dias: 3, max_ciclos: 6, passos: { '1': [{ canal: 'sms', modo: 'sempre' }] } },
	etapas: [
		{ id: 'tres-dias', nome: 'Três dias', ativo: true, condicoes: [{ campo: 'saldo', op: '>', valor: 100 }], referencia: { tipo: 'entrada' }, de: 0, ate: 30, ciclo: { dias: 3, vezes: 4 }, passos: { '1': [{ canal: 'whatsapp', modo: 'sempre' }, { canal: 'sms', modo: 'senao' }] } },
		{ id: 'janela', nome: 'Janela', ativo: true, condicoes: [{ campo: 'saldo', op: '>', valor: 100 }], referencia: { tipo: 'atraso' }, de: 31, ate: 90, saidas: { fim_janela: 'sai' }, passos: { '35': [{ canal: 'sms', modo: 'sempre' }], '95': [{ canal: 'email', modo: 'sempre' }] } },
	] as Etapa[],
};
const ORDEM = ['8', '7', '9'];

test('Cliente novo: colunas D+N · Dia N até o dia antes do Não CPC, raias na ordem da carteira', () => {
	const m = modeloRaias(DEF, 'localizacao', ORDEM);
	assert.deepEqual(m.colunas.map(c => `${c.titulo} · ${c.sub}`), ['D+1 · Dia 1', 'D+2 · Dia 2', 'D+3 · Dia 3']);
	assert.equal(m.final, 'D+4 sem CPC → Não CPC');
	assert.equal(m.repete, null);
	assert.deepEqual(m.linhas.map(l => l.lane), ['pub', '8', '7']);
	assert.deepEqual(m.semRaia, ['9']);
	const p7 = m.linhas.find(l => l.lane === '7')!;
	assert.deepEqual(p7.celulas.map(c => c.segueGeral), [false, true, true]);
	assert.deepEqual(m.linhas[0].celulas[0].acoes.map(a => a.canal), ['sms', 'discador']);
	assert.match(m.resumo, /Dia 1 = 1ª lista do cliente · vira Não CPC no D\+4/);
	// persona aberta pelo "+ raia" aparece mesmo antes de ter ação
	assert.deepEqual(modeloRaias(DEF, 'localizacao', ORDEM, ['9']).linhas.map(l => l.lane), ['pub', '8', '7', '9']);
});

test('Não CPC: "Dia N do ciclo", ↻ × voltas e o fim do ciclo', () => {
	const m = modeloRaias(DEF, 'giro', ORDEM);
	assert.deepEqual(m.colunas.map(c => c.titulo), ['Dia 1 do ciclo', 'Dia 2 do ciclo', 'Dia 3 do ciclo']);
	assert.equal(m.repete, '↻ × 6');
	assert.deepEqual(m.ciclo, { dias: 3, vezes: 6 });
	assert.equal(m.final, '↻ × 6 · depois aguarda enriquecimento');
	assert.match(resumoDoEstagio(DEF, 'giro'), /Ciclo de 3 dias × 6 voltas/);
});

test('estágio próprio com ciclo de 3 dias: colunas do ciclo, ↻ × vezes, saída no fim', () => {
	const m = modeloRaias(DEF, 'tres-dias', ORDEM);
	assert.equal(m.tipo, 'etapa');
	assert.deepEqual(m.colunas.map(c => c.titulo), ['Dia 1 do ciclo', 'Dia 2 do ciclo', 'Dia 3 do ciclo']);
	assert.equal(m.repete, '↻ × 4');
	assert.equal(m.final, '↻ × 4 · depois volta ao geral');
	assert.equal(rotuloCurto(DEF, 'tres-dias', 2), 'Dia 2 do ciclo');
});

test('estágio próprio sem ciclo e janela longa: só os dias com régua; dia fora do prazo marcado', () => {
	assert.deepEqual(diasDoEstagio(DEF, 'janela'), [35, 95]);
	const m = modeloRaias(DEF, 'janela', ORDEM);
	assert.deepEqual(m.colunas.map(c => [c.titulo, c.fora]), [['Atraso 35', false], ['Atraso 95', true]]);
	assert.equal(finalDoEstagio(DEF, 'janela'), 'Fim do prazo (90) · sai da régua');
	// janela curta aparece inteira
	const curta = { ...DEF, etapas: [{ ...DEF.etapas![1], de: 1, ate: 5, passos: {} }] };
	assert.deepEqual(diasDoEstagio(curta, 'janela'), [1, 2, 3, 4, 5]);
});

test('preventivo e quebra: dias desenhados, D-N / D+N', () => {
	const d: Definicao = { preventivo: { passos: { '-3': [], '0': [] } }, quebra: { passos: { '1': [], '5': [] } } };
	assert.deepEqual(modeloRaias(d, 'preventivo', []).colunas.map(c => c.titulo), ['D-3', 'D0']);
	assert.deepEqual(modeloRaias(d, 'quebra', []).colunas.map(c => c.titulo), ['D+1', 'D+5']);
});

test('+ raia de persona copia o Público geral em cada dia; dia com raia própria não muda; tirar volta ao geral', () => {
	const passos = DEF.localizacao!.passos;
	const novo = adicionarRaia(passos, '9', [1, 2, 3], ORDEM);
	assert.deepEqual(novo['1'].map(a => [a.canal, a.modo, a.personas?.join() ?? '']), [
		['sms', 'sempre', ''], ['discador', 'reserva', ''], ['sms', 'sempre', '7'], ['sms', 'sempre', '9'], ['discador', 'reserva', '9'],
	]);
	// ordem da carteira: 8 antes de 9
	assert.deepEqual(novo['2'].map(a => a.personas?.join() ?? ''), ['', '8', '9']);
	const de7 = adicionarRaia(passos, '7', [1, 2], ORDEM);
	assert.deepEqual(de7['1'], passos['1']);                 // já tinha raia no dia 1
	assert.deepEqual(de7['2'].map(a => a.personas?.join() ?? ''), ['', '8', '7']);
	assert.deepEqual(removerRaia(novo, '9'), passos);
	// ninguém mais grava nada para o estágio: o original não mudou
	assert.equal(passos['1'].length, 3);
});
