// Números em pt-BR nas condições (Segmentos, Personas, Estágios): "entre", a vírgula não aceita.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampoFaixa, CampoLista, CampoNumero } from '@/components/comuns/campos-condicao';
import { erroCondicao, fraseValor, lerLista, lerNumeroBR, lerNumeroGravado, normalizarCondicao, normalizarCondicoes, textoEdicao, trocarOperador } from '@/lib/condicoes';
import { validarEtapas, type Definicao } from '@/lib/estrategia';

const num = (t: unknown) => { const r = lerNumeroBR(t); return 'erro' in r ? r.erro : r.valor; };

test('lerNumeroBR: aceita o número como se escreve no Brasil', () => {
	assert.equal(num('1.500,50'), 1500.5);
	assert.equal(num('1500,5'), 1500.5);
	assert.equal(num('1500.50'), 1500.5);
	assert.equal(num('1.500'), 1500);          // pt-BR: mil e quinhentos
	assert.equal(num('1.000.000,25'), 1000000.25);
	assert.equal(num('R$ 1.500,50'), 1500.5);
	assert.equal(num('-3.000'), -3000);
	assert.equal(num('0,5'), 0.5);
	assert.equal(num(',5'), 0.5);
	assert.equal(num('1.5'), 1.5);             // 1 casa depois do ponto: só pode ser decimal
	assert.equal(num(42), 42);
});

test('lerNumeroBR: recusa com mensagem em pt-BR', () => {
	assert.match(String(num('')), /Informe um número/);
	assert.match(String(num('1,500.50')), /vírgula para os decimais/);
	assert.match(String(num('1.500.00')), /milhares vão de 3 em 3/);
	assert.match(String(num('1,5,0')), /milhares vão de 3 em 3/);
	assert.match(String(num('abc')), /Não é um número/);
});

test('valor salvo antes continua com o sentido que o motor dava', () => {
	// O motor (cluster.numero) lê texto sem vírgula com um ponto como decimal.
	assert.equal(lerNumeroGravado('1.500'), 1.5);
	assert.equal(lerNumeroGravado('1.500,50'), 1500.5);
	assert.equal(lerNumeroGravado('1.000.000'), 1000000);
	assert.equal(lerNumeroGravado(1500.5), 1500.5);
	assert.equal(lerNumeroGravado('abc'), null);
	assert.equal(textoEdicao('1.500'), '1,5');
	assert.equal(textoEdicao(1500.5), '1500,5');
	assert.equal(textoEdicao('SP'), 'SP');
	// Texto antigo nunca editado é gravado como o número que o motor já usava.
	assert.deepEqual(normalizarCondicao({ campo: 'saldo', op: '>=', valor: '1.500' }, 'numero'), { cond: { campo: 'saldo', op: '>=', valor: 1.5 } });
});

test('normalizar: grava número nas condições numéricas e faixa como [de, até]', () => {
	assert.deepEqual(normalizarCondicao({ campo: 'saldo', op: '>=', valor: 1500.5 }, 'numero'), { cond: { campo: 'saldo', op: '>=', valor: 1500.5 } });
	assert.deepEqual(normalizarCondicao({ campo: 'saldo', op: 'entre', valor: [1500.5, 3000] }, 'numero'), { cond: { campo: 'saldo', op: 'entre', valor: [1500.5, 3000] } });
	assert.match(erroCondicao({ campo: 'saldo', op: 'entre', valor: [3000, 1500] }, 'numero') ?? '', /menor ou igual/);
	assert.match(erroCondicao({ campo: 'saldo', op: 'entre', valor: [1500, ''] }, 'numero') ?? '', /"Até": Informe um número/);
	assert.match(erroCondicao({ campo: 'saldo', op: '>', valor: '1,500.5' }, 'numero') ?? '', /vírgula/);
	// "=" em coluna numérica aceita texto (o motor compara como texto)
	assert.deepEqual(normalizarCondicao({ campo: 'COD', op: '=', valor: 'ABC' }, 'numero'), { cond: { campo: 'COD', op: '=', valor: 'ABC' } });
	assert.deepEqual(normalizarCondicao({ campo: 'UF', op: 'em', valor: ['SP', ' RJ '] }, 'texto'), { cond: { campo: 'UF', op: 'em', valor: ['SP', 'RJ'] } });
	assert.match(erroCondicao({ campo: 'UF', op: 'em', valor: [] }, 'texto') ?? '', /pelo menos um valor/);
	const todas = normalizarCondicoes([{ campo: 'saldo', op: '>=', valor: 10 }, { campo: 'saldo', op: '<', valor: 'x' }], () => 'numero');
	assert.ok('erro' in todas && todas.erro.startsWith('Condição 2:'));
});

test('lista separa por ";" (a vírgula é decimal) e trocar operador ajusta o valor', () => {
	assert.deepEqual(lerLista('1500,50; 2000 ;; SP'), ['1500,50', '2000', 'SP']);
	assert.deepEqual(trocarOperador({ campo: 'saldo', op: '>=', valor: 1500 }, 'entre').valor, [1500, '']);
	assert.deepEqual(trocarOperador({ campo: 'fase', op: '=', valor: 'localizacao' }, 'em').valor, ['localizacao']);
	assert.equal(trocarOperador({ campo: 'fase', op: 'em', valor: ['localizacao', 'giro'] }, '=').valor, 'localizacao');
	assert.equal(fraseValor({ op: 'entre', valor: [1500.5, 3000] }), '1.500,5 e 3.000');
	assert.equal(fraseValor({ op: 'em', valor: ['SP', 'RJ'] }), 'SP; RJ');
});

test('Estágios: Salvar aceita vírgula e barra número mal escrito', () => {
	const def = (valor: unknown, op = '>='): Definicao => ({ etapas: [{ id: 'e1', nome: 'E1', ativo: true, condicoes: [{ campo: 'saldo', op, valor: valor as never }], referencia: { tipo: 'entrada' }, de: 1, ate: 30 }] } as unknown as Definicao);
	assert.deepEqual(validarEtapas(def(1500.5)), []);
	assert.deepEqual(validarEtapas(def('1500,50')), []);        // texto com vírgula (antes dava "precisa de um número")
	assert.deepEqual(validarEtapas(def([1500.5, 3000], 'entre')), []);
	assert.match(validarEtapas(def('1,500.50'))[0]?.mensagens[0] ?? '', /vírgula para os decimais/);
	assert.match(validarEtapas(def([3000, 1500], 'entre'))[0]?.mensagens[0] ?? '', /menor ou igual/);
});

test('Campos: mostram o valor em pt-BR e a faixa com dois campos', () => {
	const n = renderToStaticMarkup(<CampoNumero valor={1500.5} onChange={() => {}} aria-label="Valor" />);
	assert.match(n, /value="1500,5"/);
	assert.match(n, /inputMode="decimal"|inputmode="decimal"/);
	assert.match(n, /= 1\.500,5/);
	const antigo = renderToStaticMarkup(<CampoNumero valor="1.500" onChange={() => {}} />);
	assert.match(antigo, /value="1,5"/);
	const f = renderToStaticMarkup(<CampoFaixa valor={[1500.5, 3000]} onChange={() => {}} />);
	assert.match(f, /aria-label="De"[^>]*value="1500,5"|value="1500,5"[^>]*aria-label="De"/);
	assert.match(f, /value="3000"/);
	const l = renderToStaticMarkup(<CampoLista valor={['SP', 'RJ']} onChange={() => {}} />);
	assert.match(l, /value="SP; RJ"/);
});
