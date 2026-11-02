// Percentual seguro da Mensageria (Painel do canal): denominador 0 ou dado ausente nunca vira "NaN%".
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pct, razaoPct } from '@/lib/mensageria-produtos';

test('razaoPct: conta normal', () => {
	assert.equal(razaoPct(25, 100), 25);
	assert.equal(razaoPct(0, 40), 0);
	assert.equal(razaoPct('3', '4'), 75);
});

test('razaoPct: denominador 0, negativo ou dado ausente → null', () => {
	assert.equal(razaoPct(5, 0), null);
	assert.equal(razaoPct(0, 0), null);
	assert.equal(razaoPct(5, -10), null);
	assert.equal(razaoPct(undefined, 100), null);
	assert.equal(razaoPct(null, 100), null);
	assert.equal(razaoPct(10, undefined), null);
	assert.equal(razaoPct('', 100), null);
	assert.equal(razaoPct(Number.NaN, 100), null);
	assert.equal(razaoPct('abc', 100), null);
	assert.equal(razaoPct(1, Number.POSITIVE_INFINITY), null);
});

test('pct: "—" quando não dá para calcular, "0,00%" quando é zero de verdade', () => {
	assert.equal(pct(undefined as unknown as number, 1200), '—');
	assert.equal(pct(10, 0), '—');
	assert.equal(pct(0, 0), '—');
	assert.equal(pct(0, 1200), '0,00%');
	assert.equal(pct(940, 1000), '94,0%');
	assert.equal(pct(5, 1000), '0,50%');
	for (const [v, t] of [[undefined, 10], [10, undefined], [null, null], [Number.NaN, 5], [5, Number.NaN]]) assert.ok(!pct(v, t).includes('NaN'));
});
