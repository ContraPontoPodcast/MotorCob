// Descrever segmentos e régua (etapa 5): as respostas por opção no site dão o MESMO resultado que o motor
// (tests/dados/segmentacao_proposta_dono.json, gerado por tests/gerar_segmentacao_proposta.py), contagens, matriz,
// conferências, bloqueios do Aplicar e a tabela da régua. Também renderiza as telas sem navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
	aplicarPatch, bloqueiosAplicar, comRespostas, conferencias, contarAcoes, corpoPrevia, desligados, efeitoAplicar, emOrdem,
	esperaAplicacao, explicarErrosGeracao, lerContagens, matrizDeOnde, respostasPadrao, tabelaRegua, temOQueLigar, textoCondicao,
	trocarOrdem, type Aplicacao, type Proposta,
} from '@/lib/segmentacao-ia';
import type { ResultadoPrevia } from '@/lib/previa-segmentacao';
import { DescreverSegmentacao } from '@/components/segmentacao-ia/descrever-segmentacao';

type Fixture = { proposta: Proposta; personas: { id: string; nome: string; canais: string[] }[]; casos: { respostas: Record<string, string>; esperado: { ordem: string[]; demais: string; segmentos: Record<string, Record<string, unknown>> } }[] };
const FX: Fixture = JSON.parse(readFileSync(join(process.cwd(), '..', 'tests', 'dados', 'segmentacao_proposta_dono.json'), 'utf8'));
const P = FX.proposta;
const TODOS = new Set(['whatsapp', 'rcs', 'sms', 'email', 'discador']);

test('respostas: mesmo resultado que o motor (paridade)', () => {
	for (const caso of FX.casos) {
		const x = comRespostas(P, caso.respostas);
		assert.deepEqual(x.ordem, caso.esperado.ordem);
		assert.equal(x.demais, caso.esperado.demais);
		for (const [ref, esp] of Object.entries(caso.esperado.segmentos)) {
			for (const [k, v] of Object.entries(esp)) assert.deepEqual((x.segmentos[ref] as unknown as Record<string, unknown>)[k] ?? null, v ?? null, `${ref}.${k}`);
		}
	}
});

test('padrão: as respostas padrão não mudam a proposta', () => {
	assert.deepEqual(comRespostas(P, respostasPadrao(P)).segmentos, P.segmentos);
	assert.equal(P.perguntas.length, 13);
});

test('aplicarPatch: pai que não existe é pulado; remover tira a chave', () => {
	const x = aplicarPatch(P, [{ caminho: ['segmentos', 'nao_existe', 'acao'], valor: 'novo' }, { caminho: ['segmentos', 's1', 'trechos'], valor: null, remover: true }]);
	assert.equal(x.segmentos.nao_existe, undefined);
	assert.equal('trechos' in x.segmentos.s1, false);
	assert.ok('trechos' in P.segmentos.s1);   // a original não muda
});

test('ordem, ações e corpo da prévia', () => {
	assert.deepEqual(emOrdem(P).map(s => s.codigo), ['JUR', 'A1', 'D90B', 'D90A', 'B1', 'X180']);
	assert.deepEqual(desligados(P).map(s => s.codigo), ['A2']);
	assert.deepEqual(contarAcoes(P), { novos: 3, alterados: 2, mantidos: 1, desligados: 1, estrategias: 5 });
	assert.deepEqual(corpoPrevia(P).segmentos.map(s => s.ref), ['atual_JUR', 's1', 's2', 's3', 's5', 's6']);
	const alt = comRespostas(P, { a2: 'alterar' });
	assert.deepEqual(emOrdem(alt).map(s => s.codigo), ['JUR', 'A1', 'D90A', 'A2', 'B1', 'X180']);   // D90B não é criado
	assert.deepEqual(trocarOrdem(P, 's2', 's3').ordem.slice(2, 4), ['s3', 's2']);
});

test('SQL 82: novo nasce pausado; alterado (ou com estratégia nova) segue na versão atual até ligar', () => {
	const ef = Object.fromEntries(emOrdem(P).map(s => [s.codigo, efeitoAplicar(s)]));
	assert.deepEqual(ef, { JUR: null, A1: 'versao_nova', D90B: 'pausado', D90A: 'pausado', B1: 'versao_nova', X180: 'pausado' });
	assert.equal(efeitoAplicar(P.segmentos.s4), null);                // A2 desligado aqui
	assert.equal(temOQueLigar(P), true);
	const so = { ...P, ordem: ['atual_JUR'], segmentos: { atual_JUR: P.segmentos.atual_JUR } };
	assert.equal(temOQueLigar(so), false);                             // só ordem/desligar: vale na hora
});

test('SQL 82: faixa "Aplicado" conta pausados e versões ainda esperando', () => {
	const ap = (espera: Aplicacao['criados']['espera']): Aplicacao => ({
		id: '1', credor_id: '9', aplicada_em: '2026-11-08T10:00:00Z', situacao: 'aplicada', ligada_em: null, resumo: {},
		criados: { pausados: [11, 12], espera },
	});
	const segs = [{ cluster_id: '11', em_uso: false }, { cluster_id: '12', em_uso: true }, { cluster_id: '20', em_uso: true }];
	assert.deepEqual(esperaAplicacao(ap({ versoes: { 20: {}, 21: { ligada_em: '2026-11-08T10:01:00Z' } } }), segs),
		{ pausados: ['11'], versoes: ['20'], total: 2 });
	assert.deepEqual(esperaAplicacao(ap({ versoes: { 20: {} }, substituida_por: 5 }), segs).versoes, []);   // substituída
	assert.deepEqual(esperaAplicacao(ap(null), segs), { pausados: ['11'], versoes: [], total: 1 });           // aplicada antes do SQL 82
});

// prévia do exemplo do dono (contagens do protótipo, tela 3)
const PREVIA: ResultadoPrevia = {
	data_base: '2026-11-07', clientes: 10000, demais: 214, campos_sem_dado: [],
	segmentos: [['atual_JUR', 380], ['s1', 3412], ['s2', 2106], ['s3', 1148], ['s5', 1587], ['s6', 1153]].map(([ref, n], i) => ({ posicao: i + 1, ref: ref as string, codigo: null, nome: null, clientes: n as number, batem: n as number, erro: null })),
	sobreposicao: [{ a: 1, b: 2, clientes: 38 }],
	de_onde: [
		{ de: 'JUR', para: 1, clientes: 380 }, { de: 'A1', para: 2, clientes: 3100 }, { de: 'A2', para: 3, clientes: 2106 }, { de: 'A2', para: 4, clientes: 1148 },
		{ de: 'B1', para: 5, clientes: 1587 }, { de: 'B1', para: 6, clientes: 713 }, { de: null, para: 2, clientes: 312 }, { de: null, para: 6, clientes: 440 }, { de: null, para: null, clientes: 214 },
	],
};

test('contagens: por segmento, mudam de segmento e a matriz "de onde vêm"', () => {
	const c = lerContagens(P, PREVIA);
	assert.equal(c.porRef.s1, 3412);
	assert.equal(c.mudam, 2106 + 1148 + 713 + 312 + 440);   // 4.719, como no protótipo
	assert.equal(c.hoje.A2, 3254);
	const m = matrizDeOnde(P, c);
	assert.deepEqual(m.colunas.map(x => x.codigo), ['JUR', 'A1', 'D90B', 'D90A', 'B1', 'X180', 'Demais']);
	assert.deepEqual(m.totais, [380, 3412, 2106, 1148, 1587, 1153, 214]);
	assert.equal(m.linhas.at(-1)!.de, 'Demais');
	assert.deepEqual(m.linhas.find(l => l.de === 'A2')!.valores, [0, 0, 2106, 1148, 0, 0, 0]);
});

test('conferências: sobreposição resolvida pela ordem, Demais, faixas que se cruzam e canal a ativar', () => {
	const c = lerContagens(P, PREVIA);
	const cf = conferencias(P, c, TODOS);
	assert.ok(cf.some(x => x.tom === 'ok' && x.titulo.startsWith('Nenhuma sobreposição entre os segmentos propostos')));
	assert.ok(cf.some(x => x.titulo.startsWith('Sobreposição resolvida pela ordem') && x.texto.includes('38 de JUR')));
	assert.ok(cf.some(x => x.titulo.startsWith('214 clientes não cabem')));
	const cruz = conferencias(P, { ...c, sobreposicao: [{ a: 's2', b: 's3', clientes: 1240 }] }, TODOS).find(x => x.troca);
	assert.equal(cruz?.titulo, 'Faixas se cruzam: 1.240 clientes cabem em D90B e D90A.');
	const voz = conferencias(comRespostas(P, { a1voz: 'ativar' }), c, TODOS);
	assert.ok(voz.some(x => x.tom === 'erro' && x.titulo.includes('Agente virtual')));
});

test('bloqueios do Aplicar: canal a ativar, carteira que mudou e confirmação', () => {
	const ok = bloqueiosAplicar(P, { canaisAtivos: TODOS, hashAtual: P.hash_base ?? null, confirmou: true });
	assert.deepEqual(ok, []);
	assert.equal(bloqueiosAplicar(P, { canaisAtivos: TODOS, hashAtual: P.hash_base ?? null, confirmou: false }).length, 1);
	const v = bloqueiosAplicar(comRespostas(P, { a1voz: 'ativar' }), { canaisAtivos: TODOS, hashAtual: null, confirmou: true });
	assert.match(v[0], /Ative Agente virtual/);
	const mudou = bloqueiosAplicar({ ...P, hash_base: 'a'.repeat(32) }, { canaisAtivos: TODOS, hashAtual: 'b'.repeat(32), confirmou: true });
	assert.match(mudou[0], /mudou desde a geração/);
});

test('tabela da régua por perfil: raias na ordem da carteira + Público geral', () => {
	const linhas = tabelaRegua(P.segmentos.s1.definicao, FX.personas);
	assert.deepEqual(linhas.map(l => l.perfil), ['Digital nativo', 'Conectado (WhatsApp + e-mail)', 'Atraso recente, ticket baixo', 'Celular sem WhatsApp confirmado', 'Demais (sem persona mapeada)']);
	assert.deepEqual(linhas[3].dias.map(d => d.acoes.map(a => a.canal).join('+')), ['rcs', 'sms', 'discador']);
	assert.deepEqual(linhas[4].dias.map(d => d.acoes.map(a => a.canal).join('+')), ['sms+discador', 'rcs+email+discador', 'discador']);
	const d90a = tabelaRegua(P.segmentos.s3.definicao, FX.personas);
	assert.equal(d90a[0].dias[1].segue, true);   // Digital nativo só tem raia no Dia 1
});

test('textos: condição em pt-BR com R$ e erros da geração', () => {
	assert.equal(textoCondicao({ campo: 'saldo', op: '<=', valor: 2000 }), 'Saldo total até R$ 2.000');
	assert.equal(textoCondicao({ campo: 'dias_atraso', op: 'entre', valor: [31, 90] }), 'Dias de atraso entre 31 e 90');
	assert.deepEqual(explicarErrosGeracao(['llm_indisponivel', 'llm_indisponivel']), ['A IA não respondeu agora. Tente de novo em alguns minutos.']);
	assert.match(explicarErrosGeracao(['condicao_invalida:s1.0', 'xyz'])[0], /faixa invertida/);
});

test('tela 2: texto, campos, canais, limites e o botão com os créditos', () => {
	const html = renderToStaticMarkup(<MemoryRouter><DescreverSegmentacao empresaId="1" credorId="2" credorNome="Cartões" outrasCarteiras={[]} personas={FX.personas}
		colunas={[{ nome: 'produto', tipo: 'texto' }]} segmentosHoje={4} onFechar={() => {}} onAplicado={() => {}} /></MemoryRouter>);
	assert.match(html, /Descrever segmentos e régua/);
	assert.match(html, /0 \/ 6\.000 caracteres/);
	assert.match(html, /Gerar proposta · 2 créditos/);
	assert.match(html, /Até 8 segmentos novos ou alterados/);
	assert.match(html, /nasce <b>pausado<\/b>/);
	assert.match(html, /Celular sem WhatsApp confirmado/);
	assert.doesNotMatch(html, /bg-white|bg-\[#f/);
});
