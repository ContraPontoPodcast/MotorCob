// Créditos de IA (SQL 78; telas 11 e 12 do Especialista). npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { AvisoCreditosIA, ContadorCreditosIA } from '@/components/ia/creditos-ia';
import { PainelUsoIA } from '@/components/workspace/empresa/uso-ia';
import { inteiroDigitado } from '@/components/workspace/console/console-creditos-ia';
import {
	avisoCreditos, diaDePico, nivelCreditos, normalizarUso, rotuloCreditos, textoContador, textoProjecao, type ResumoCreditos,
} from '@/lib/creditos-ia';

const base: ResumoCreditos = {
	competencia: '2026-11-01', inicio: '2026-11-01', fim: '2026-11-30', renova_em: '2026-12-01', usados: 87, franquia: 100,
	excedente: 0, media_7d: 12.43, projecao: 373, teto: null, preco_excedente: 1.9,
};

test('contador: o texto do protótipo', () => {
	assert.equal(textoContador(base), '87 de 100 no mês · excedente 0 · renova em 01/12');
	assert.equal(textoContador({ ...base, usados: 104, excedente: 4 }), '104 de 100 no mês · excedente 4 · renova em 01/12');
});

test('nível: 80% é atenção, 100% é excedente, franquia 0 é tudo excedente', () => {
	assert.equal(nivelCreditos({ usados: 79, franquia: 100 }), 'ok');
	assert.equal(nivelCreditos({ usados: 80, franquia: 100 }), 'atencao');
	assert.equal(nivelCreditos({ usados: 100, franquia: 100 }), 'excedente');
	assert.equal(nivelCreditos({ usados: 0, franquia: 0 }), 'ok');
	assert.equal(nivelCreditos({ usados: 1, franquia: 0 }), 'excedente');
});

test('rótulo dos botões (tela 11)', () => {
	assert.equal(rotuloCreditos(1, { usados: 100, franquia: 100 }), '1 crédito (excedente)');
	assert.equal(rotuloCreditos(2, { usados: 87, franquia: 100 }), '2 créditos');
	assert.equal(rotuloCreditos(2, { usados: 99, franquia: 100 }), '2 créditos (excedente)');
	assert.equal(rotuloCreditos(0, { usados: 100, franquia: 100 }), 'sem crédito');
});

test('projeção: ~373 e o excedente previsto', () => {
	const p = textoProjecao(base);
	assert.equal(p.valor, '~373');
	assert.equal(p.detalhe.replace(/\s/g, ' '), 'no ritmo dos últimos 7 dias · excedente ~273 × R$ 1,90');
	assert.equal(textoProjecao({ ...base, projecao: null }).valor, '—');
});

test('avisos: 80% com o dia de pico, 100% com o preço, teto pede o suporte', () => {
	const pico = diaDePico([{ dia: '2026-11-01', creditos: 4 }, { dia: '2026-11-04', creditos: 30 }]);
	const a80 = avisoCreditos(base, pico)!;
	assert.match(a80.texto, /Vocês já usaram 87 dos 100 créditos do mês \(aviso de 80%\)\. Nada é bloqueado/);
	assert.match(a80.texto, /O dia 04\/11 teve 30 créditos\./);
	const a100 = avisoCreditos({ ...base, usados: 104, excedente: 4 })!;
	assert.equal(a100.titulo, 'A franquia de 100 créditos deste mês acabou.');
	assert.match(a100.texto, /cobrado como excedente: R\$\s1,90\. Neste mês: 4 excedentes\. Nada fica bloqueado\. A franquia renova em 01\/12\./);
	assert.equal(avisoCreditos({ ...base, usados: 10 }), null);
	assert.match(avisoCreditos({ ...base, usados: 150, excedente: 50, teto: 150 })!.texto, /fale com o suporte/);
});

test('ContadorCreditosIA e AvisoCreditosIA: só quantidade, nunca custo', () => {
	const html = renderToStaticMarkup(<MemoryRouter><ContadorCreditosIA resumo={{ ...base, usados: 100, excedente: 4 }} /><AvisoCreditosIA resumo={{ ...base, usados: 104, excedente: 4 }} linkUso /></MemoryRouter>);
	assert.match(html, /Créditos de IA/);
	assert.match(html, /100 de 100/);
	assert.match(html, /data-creditos-nivel="excedente"/);
	assert.match(html, /Ver o uso de IA/);
	assert.doesNotMatch(html, /custo/i);
});

test('PainelUsoIA (tela 12): KPIs, tabela por função, por dia e Na fatura, sem custo', () => {
	const uso = normalizarUso({
		...base, hoje: '2026-11-07', atual: true, valor_excedente: 0,
		por_funcao: [
			{ grupo: 'Especialista · análise (Consultar / Analisar de novo)', creditos_por_uso: 2, usos: 14, creditos: 28 },
			{ grupo: 'Especialista · pergunta nova', creditos_por_uso: 1, usos: 23, creditos: 23 },
			{ grupo: 'Pré-análise ao salvar ou aplicar', creditos_por_uso: 0, usos: 22, creditos: 0 },
		],
		por_dia: [4, 9, 4, 30, 9, 21, 10].map((c, i) => ({ dia: `2026-11-0${i + 1}`, creditos: c })),
	});
	const html = renderToStaticMarkup(<MemoryRouter><PainelUsoIA uso={uso} /></MemoryRouter>);
	for (const t of ['Uso de IA', 'CICLO 01/11 A 30/11', '87 de 100', 'EXCEDENTE NO CICLO', 'PROJEÇÃO DO CICLO', '~373',
		'aviso de 80%', 'Especialista · análise (Consultar / Analisar de novo)', 'Por dia', '07/11 (hoje)', 'Na fatura',
		'Créditos de IA (franquia de 100, incluída no contrato)', 'incluído', 'Créditos de IA excedentes · 0 × R$']) {
		assert.ok(html.includes(t), t);
	}
	assert.doesNotMatch(html, /custo real|custo por|R\$ 0,56/i);
});

test('Console: inteiro digitado (franquia/teto)', () => {
	assert.equal(inteiroDigitado(''), null);
	assert.equal(inteiroDigitado('1.000'), 1000);
	assert.ok(Number.isNaN(inteiroDigitado('1,5') as number));
});
