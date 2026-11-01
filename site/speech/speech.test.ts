// Regras do Speech Analytics no site (src/lib/speech.ts): as mesmas do banco (SQL 60).
// node --experimental-strip-types --test site/speech/speech.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abaValida, ajustarItem, etapaRel, faixaDe, idItem, marcarTermo, porFaixa, rotuloOferta, termoProibido, textoTemDadoPessoal, type ItemChecklist } from '../src/lib/speech.ts';

test('busca recusa CPF, telefone e e-mail, como termo_busca_proibido', () => {
	for (const t of ['123.456.789-09', '12345678909', '(11) 98765-4321', '11 9 8765 4321', 'fulano@exemplo.com']) assert.equal(termoProibido(t), true, t);
	for (const t of ['boleto falso', 'pagar no dia 15', 'procon', 'R$ 2.380,00']) assert.equal(termoProibido(t), false, t);
});

test('texto livre com dado pessoal é barrado antes de ir ao banco', () => {
	assert.equal(textoTemDadoPessoal('ligou do (11) 98765-4321'), true);
	assert.equal(textoTemDadoPessoal('Reclamação respondida pelo SAC'), false);
});

test('faixas sem último lugar: alfabética dentro da faixa, menos de 30 fica sem nota', () => {
	const r = porFaixa([
		{ ref: 'OP-1', apelido: 'Téo', n: 158, nota: 70.4 }, { ref: 'OP-2', apelido: 'Bia', n: 212, nota: 94.2 },
		{ ref: 'OP-3', apelido: 'Ana', n: 140, nota: 71 }, { ref: 'OP-4', apelido: 'Lia', n: 22, nota: 88.8 },
	]);
	assert.deepEqual(r.faixas[2].map(o => o.apelido), ['Ana', 'Téo']);
	assert.deepEqual(r.semNota.map(o => o.ref), ['OP-4']);
	assert.equal(r.top5[0].apelido, 'Bia');
	assert.equal(faixaDe(90), 0);
	assert.equal(faixaDe(69.9), 3);
});

test('item de lei não muda; padrão ajustado vira "ajustado"', () => {
	const lei: ItemChecklist = { id: 'ck_cpc', texto: 'Confirmou a identidade', gravidade: 'bloqueante', aplica: 'ambos', peso: 3, origem: 'padrao', trava: true, on: true };
	assert.deepEqual(ajustarItem(lei, { on: false }), lei);
	const ok: ItemChecklist = { ...lei, id: 'ck_oferta', trava: false, gravidade: 'importante', peso: 2 };
	assert.equal(ajustarItem(ok, { peso: 3 }).origem, 'ajustado');
	assert.equal(ajustarItem(ok, { on: false }).origem, 'padrao');
	assert.equal(idItem('Informou o protocolo?', ['cl_informou_o_protocolo']), 'cl_informou_o_protocolo_2');
});

test('destaque do termo e etapas do relatório', () => {
	assert.deepEqual(marcarTermo('Vou no Procon e no procon', 'procon'), [['Vou no ', false], ['Procon', true], [' e no ', false], ['procon', true]]);
	assert.equal(etapaRel('enviado'), 2);
	assert.equal(abaValida('xyz'), 'visao');
});

test('oferta (SQL 63): só parcelas e faixa de desconto, como codigos_speech_ok', () => {
	assert.equal(rotuloOferta('6x'), '6x');
	assert.equal(rotuloOferta('avista_d10_20'), 'À vista · desconto de 10–20%');
	assert.equal(rotuloOferta('12x_d50_mais'), '12x · desconto acima de 50%');
	assert.equal(rotuloOferta('sem_oferta'), 'Sem oferta do CRM');
});
