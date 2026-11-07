// Guarda do tema escuro (npm test): nenhum fundo claro fixo nos componentes da plataforma sem mapeamento no index.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achados, classesDoCss, fundoClaro } from './cores-claras.mjs';

test('fundoClaro: só fundo claro, com ou sem variante; translúcido e escuro ficam de fora', () => {
	for (const c of ['bg-white', 'hover:bg-[#f6fafb]', 'disabled:bg-[#F5F5F7]', 'bg-green-50', 'bg-amber-100', 'bg-[#fff]']) assert.ok(fundoClaro(c), c);
	for (const c of ['bg-white/25', 'bg-[#1D1D1F]', 'bg-[#0F4C5C]', 'bg-[var(--base-cartao)]', 'bg-green-500', 'text-white', 'border-[#fff]']) assert.ok(!fundoClaro(c), c);
});

test('classesDoCss desescapa os seletores e ignora comentários', () => {
	const s = classesDoCss('/* .bg-red-50 */ [data-tema="escuro"] .mc-platform .hover\\:bg-\\[\\#f6fafb\\]:hover { x: y }');
	assert.ok(s.has('hover:bg-[#f6fafb]'));
	assert.ok(!s.has('bg-red-50'));
});

test('componentes da plataforma: todo fundo claro fixo está mapeado para o tema escuro', () => {
	const a = achados();
	assert.deepEqual(a.map(x => `${x.arquivo}:${x.linha} ${x.classe}`), []);
});
