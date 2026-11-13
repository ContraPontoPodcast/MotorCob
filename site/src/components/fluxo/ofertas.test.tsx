// Ofertas do agente (SQL 130/131/132; SPEC_OFERTAS_v2): a mesma trava da VM (casos de tests/dados/ofertas_casos.json),
// as 7 situações do protótipo com a regra do executor, a validação do banco, o formulário (4 modos, recomendado, sem
// API só o arquivo) e o grupo "Ofertas prontas" das colunas da carga (até 3 ofertas, nunca valor de cliente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	ALCADA_EXEMPLO, avaliar, cenarios, condicao, conversa, motivoDescarte, paraSalvarOfertas, recomendado, validarOfertas,
	type Alcada, type Oferta,
} from '@/lib/ofertas-voz';
import { FormOfertas } from '@/components/fluxo/ofertas';
import { MapeamentoCarga } from '@/components/comuns/mapeamento-carga';
import { CHAVES_OFERTA, validar } from '@/lib/mapeamento-carga';
import { OPCOES, VARIAVEIS } from '@/lib/fluxo';
import type { ConectorRow } from '@/components/fluxo/api';

const CASOS = JSON.parse(readFileSync(join(process.cwd(), '..', 'tests', 'dados', 'ofertas_casos.json'), 'utf8')) as {
	hoje: string; alcada: Alcada; descarte: { nome: string; oferta: Oferta; motivo: string | null }[];
};
const HOJE = '2026-11-12';
const nada = () => {};

test('ofertas: a trava é a mesma da VM (casos compartilhados)', () => {
	for (const c of CASOS.descarte) assert.equal(motivoDescarte(c.oferta, CASOS.alcada, CASOS.hoje), c.motivo, c.nome);
	assert.equal(motivoDescarte(CASOS.descarte[0].oferta, null, CASOS.hoje), 'acima_alcada', 'sem alçada nada passa');
});

test('ofertas: as 7 situações do protótipo, com a ordem padrão (API → arquivo)', () => {
	const cs = Object.fromEntries(cenarios(HOJE).map(c => [c.id, c]));
	const r = (id: string, modo: 'api_arquivo' | 'arquivo_api' | 'so_api' | 'so_arquivo' = 'api_arquivo') => avaliar(cs[id], modo, ALCADA_EXEMPLO, HOJE);
	assert.equal(r('normal').fonte, 'api');
	assert.deepEqual(r('normal').usadas?.map(o => o.id), ['A-7781', 'A-7782', 'A-7783']);
	assert.equal(r('fora').fonte, 'arquivo');
	assert.deepEqual(r('vencida').usadas?.map(o => o.id), ['A-7782', 'A-7783']);
	assert.equal(r('vencida').linhas.find(l => l.o.id === 'A-7790')?.motivo, 'vencida');
	assert.equal(r('acima').fonte, 'arquivo');
	assert.equal(r('vazia').fonte, null, 'API sem oferta não aciona o arquivo');
	assert.ok(r('vazia').apiSemOferta);
	assert.equal(r('nenhuma').usadas, null);
	assert.equal(r('fora', 'so_api').usadas, null);
	assert.equal(r('normal', 'so_arquivo').fonte, 'arquivo');
	assert.equal(r('normal', 'arquivo_api').fonte, 'arquivo');
	assert.equal(r('normal').linhas.filter(l => l.fonte === 'arquivo').every(l => l.naoUsada === 'reserva, não foi preciso'), true);
});

test('ofertas: a conversa usa as frases fixas, uma oferta por vez, e transfere quando pede outra', () => {
	const c = cenarios(HOJE).find(x => x.id === 'normal')!;
	const r = avaliar(c, 'api_arquivo', ALCADA_EXEMPLO, HOJE);
	const t = conversa(r, 'recusa1', 'api_arquivo').map(x => x.texto);
	assert.ok(t.includes(`Tenho uma condição para você: ${condicao(r.usadas![0])}`));
	assert.ok(t.some(x => x.startsWith('Entendo. Também tenho: 6 parcelas de R$ 260,00, com 22% de desconto.')));
	assert.ok(conversa(r, 'pede', 'api_arquivo').some(x => x.texto.startsWith('Essa condição eu não tenho aqui.')));
	const fora = avaliar(cenarios(HOJE).find(x => x.id === 'fora')!, 'so_api', ALCADA_EXEMPLO, HOJE);
	assert.ok(conversa(fora, 'aceita', 'so_api').some(x => x.texto.startsWith('Tive um problema aqui.')));
	assert.equal(condicao({ id: 'x', parcelas: 8, valor_parcela: 212.5, entrada: 200, validade: '2026-11-18' }), 'entrada de R$ 200,00 e mais 8 parcelas de R$ 212,50. Vale até 18/11.');
	assert.equal(condicao({ id: 'x', parcelas: 1, valor_parcela: 900, validade: '2026-11-18' }), 'à vista por R$ 900,00. Vale até 18/11.', 'sem desconto não fala de desconto');
});

test('ofertas: a validação do banco (ofertas_mailing_valida) e o recomendado', () => {
	assert.equal(validarOfertas({ modo: 'api_arquivo', conector_id: 3 }), '');
	assert.equal(validarOfertas({ modo: 'so_arquivo', conector_id: null }), '');
	assert.match(validarOfertas({ modo: 'so_api', conector_id: null }), /conector/);
	assert.deepEqual(paraSalvarOfertas({ modo: 'so_arquivo', conector_id: 3 }), { modo: 'so_arquivo', conector_id: null });
	assert.equal(recomendado(true), 'api_arquivo');
	assert.equal(recomendado(false), 'so_arquivo');
});

test('ofertas: o formulário mostra os 4 modos e, sem API, só o arquivo pode', () => {
	const con = { id: 3, nome: 'Buscar ofertas', finalidade: 'buscar_ofertas', situacao: 'ativo' } as ConectorRow;
	const html = renderToStaticMarkup(<FormOfertas valor={{ modo: 'api_arquivo', conector_id: 3 }} onTrocar={nada} conectores={[con]} />);
	for (const t of ['API, e o arquivo como reserva', 'Arquivo, e a API como reserva', 'Só a API', 'Só o arquivo', 'recomendado', 'sem oferta: transferir', 'nunca recebe o CPF', 'Buscar ofertas']) assert.ok(html.includes(t), t);
	const sem = renderToStaticMarkup(<FormOfertas valor={{ modo: 'so_arquivo', conector_id: null }} onTrocar={nada} conectores={[]} />);
	assert.equal((sem.match(/disabled=""/g) ?? []).length, 3, 'os 3 modos com API ficam desligados');
	assert.ok(!sem.includes('Conector da API'));
});

test('ofertas: o editor oferece a ordem da carteira e a API da etapa; a fala pode usar a frase fixa', () => {
	assert.deepEqual(OPCOES.origem_oferta.map(o => o[0]), ['arquivo', 'conector']);
	assert.ok(VARIAVEIS.includes('oferta.condicao') && VARIAVEIS.includes('oferta.validade'));
});

test('ofertas: as colunas oferta1..3 da carga (grupo próprio, sem repetir coluna)', () => {
	const cab = ['COD', 'SALDO', 'ATRASO', 'TEL', 'OF1_PARC', 'OF1_VLR', 'OF1_VAL'];
	const col = { id_cliente: 'COD', saldo: 'SALDO', dias_atraso: 'ATRASO', telefones: ['TEL'], oferta1_parcelas: 'OF1_PARC', oferta1_valor_parcela: 'OF1_VLR', oferta1_validade: 'OF1_VAL' };
	const html = renderToStaticMarkup(<MapeamentoCarga cabecalho={cab} colunas={col} reconhecido={{}} onTrocar={nada} linhas={[['C1', '10', '30', '11999990000', '6', '260,00', '20/11/2026']]} />);
	for (const t of ['Ofertas prontas (até 3 por cliente)', 'Oferta 1', 'Oferta 3', 'Valor da parcela', 'só em %']) assert.ok(html.includes(t), t);
	assert.ok(!html.includes('260,00'), 'nenhum valor de oferta de cliente aparece');
	assert.equal(CHAVES_OFERTA.length, 24);
	assert.equal(validar(col, cab), '');
	assert.match(validar({ ...col, oferta2_parcelas: 'OF1_PARC' }, cab), /mais de um campo/);
});
