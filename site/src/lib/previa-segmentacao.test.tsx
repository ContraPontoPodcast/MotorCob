// Prévia de segmentação (SQL 76) e os três caminhos da Segmentação (protótipo aprovado).
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaminhosSegmentacao } from '@/components/clusters/caminhos-segmentacao';
import { dataCurta, montarProposta, REF_EDITADO, resumirEditado, type ResultadoPrevia } from '@/lib/previa-segmentacao';

const emUso = [
	{ id: '3', codigo: 'B1', nome: 'Longo', ordem: 30, condicoes: [{ campo: 'dias_atraso', op: '>', valor: 90 }] },
	{ id: '1', codigo: 'JUR', nome: 'Jurídico', ordem: 10, condicoes: [] },
	{ id: '2', codigo: 'A1', nome: 'Primeiro', ordem: 20, condicoes: [{ campo: 'dias_atraso', op: 'entre', valor: [1, 30] }] },
];

test('montarProposta: editado no lugar dele, na ordem do motor', () => {
	const p = montarProposta(emUso, { id: '2', codigo: 'A1', nome: 'Primeiro', ordem: 20, condicoes: [{ campo: 'dias_atraso', op: 'entre', valor: [0, 30] }] });
	assert.deepEqual(p.segmentos.map(s => s.ref), ['1', REF_EDITADO, '3']);
	assert.deepEqual(p.segmentos[1].condicoes, [{ campo: 'dias_atraso', op: 'entre', valor: [0, 30] }]);
});

test('montarProposta: segmento novo vai para o fim; mesma ordem desempata pelo código', () => {
	const p = montarProposta(emUso, { id: null, codigo: 'X180', nome: 'Acima de 180', ordem: 40, condicoes: [] });
	assert.deepEqual(p.segmentos.map(s => s.codigo), ['JUR', 'A1', 'B1', 'X180']);
	const q = montarProposta(emUso, { id: null, codigo: 'AA', nome: 'x', ordem: 20, condicoes: [] });
	assert.deepEqual(q.segmentos.map(s => s.codigo), ['JUR', 'A1', 'AA', 'B1']);
});

test('resumirEditado: quem fica, quem fica acima e de onde vêm', () => {
	const r: ResultadoPrevia = {
		data_base: '2026-11-06', clientes: 1000, demais: 100,
		segmentos: [
			{ posicao: 1, ref: '1', codigo: 'JUR', nome: 'J', clientes: 50, batem: 50, erro: null },
			{ posicao: 2, ref: REF_EDITADO, codigo: 'A1', nome: 'A', clientes: 400, batem: 420, erro: null },
			{ posicao: 3, ref: '3', codigo: 'B1', nome: 'B', clientes: 450, batem: 450, erro: null },
		],
		sobreposicao: [{ a: 1, b: 2, clientes: 20 }, { a: 2, b: 3, clientes: 0 }],
		de_onde: [{ de: 'A1', para: 2, clientes: 300 }, { de: null, para: 2, clientes: 100 }, { de: 'B1', para: 3, clientes: 450 }],
		campos_sem_dado: [],
	};
	const s = resumirEditado(r)!;
	assert.equal(s.clientes, 400);
	assert.deepEqual(s.acima, [{ codigo: 'JUR', clientes: 20 }]);
	assert.deepEqual(s.deOnde, [{ de: 'A1', clientes: 300 }, { de: 'Demais', clientes: 100 }]);
	assert.equal(dataCurta(s.dataBase), '06/11');
});

test('Segmentação: três cartões iguais, "Descrever" ligado (etapa 5) e escondido sem permissão', () => {
	const html = renderToStaticMarkup(<CaminhosSegmentacao onNovo={() => {}} onUsar={() => {}} onDescrever={() => {}} />);
	const botoes = html.match(/<button[^>]*>/g) ?? [];
	assert.equal(botoes.length, 3);
	assert.equal(new Set(botoes.map(b => (b.match(/class="([^"]*)"/) ?? [])[1])).size, 1);   // mesmo tamanho e miolo
	assert.match(html, /Novo segmento/);
	assert.match(html, /Usar segmento da empresa/);
	assert.match(html, /Descrever segmentos e régua.*IA/);
	assert.doesNotMatch(html, /em breve/);
	assert.equal((html.match(/disabled=""/g) ?? []).length, 0);
	const sem = renderToStaticMarkup(<CaminhosSegmentacao onNovo={() => {}} onUsar={() => {}} onDescrever={() => {}} podeDescrever={false} />);
	assert.equal((sem.match(/<button[^>]*>/g) ?? []).length, 2);
	assert.doesNotMatch(sem, /Descrever segmentos/);
});
