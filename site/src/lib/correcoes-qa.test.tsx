// Regressões do QA da implantação (go-live): canais, faturamento, mensagens de erro, segmento.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	CANAIS_CONFIGURAVEIS, CONFLITO_CREDOR_CANAIS, canaisConfiguraveis, lerCusto, linhasCarteira, linhasEmpresa,
	naoPerturbeParaBanco, naoPerturbeParaTela, type CanalTela,
} from '@/lib/canais-config';
import { comNomeDaEmpresa, listaSemContato, mensagemRascunhos } from '@/lib/console-faturas';
import { destinatariosFaturas, montarPainel } from '@/lib/faturamento-painel';
import { mensagemDeNegocio } from '@/lib/supabase';
import { erroCodigo, PACOTE_PADRAO } from '@/components/clusters/cluster-form';

const padrao: Record<string, CanalTela> = Object.fromEntries(CANAIS_CONFIGURAVEIS.map(c => [c, {
	canal: c, ativo: true, janela_inicio: '08:00', janela_fim: '20:00', sabado: true, capacidade_dia: null, custo: null,
	tentativas_dia: null, respeitar_nao_perturbe: '', numeros_por_cliente: null, produto_padrao: null,
}]));

test('B2: canais da empresa gravam só os 6 canais do CHECK (sem o enriquecimento)', () => {
	const linhas = linhasEmpresa('7', {}, padrao);
	assert.deepEqual(linhas.map(l => l.canal), ['whatsapp', 'rcs', 'agente_voz', 'discador', 'sms', 'email']);
	assert.ok(!canaisConfiguraveis.some(c => c.id === 'enriquecimento'));
	assert.ok(linhas.every(l => l.empresa_id === '7'));
});

test('B2: "Respeitar Não Perturbe" vai ao banco como boolean (coluna boolean)', () => {
	assert.equal(naoPerturbeParaBanco('sim'), true);
	assert.equal(naoPerturbeParaBanco('nao'), false);
	assert.equal(naoPerturbeParaBanco(''), null);
	assert.equal(naoPerturbeParaTela(true), 'sim');
	assert.equal(naoPerturbeParaTela(false), 'nao');
	assert.equal(naoPerturbeParaTela(null), '');
	const l = linhasEmpresa('1', { sms: { ...padrao.sms, respeitar_nao_perturbe: 'sim' } }, padrao).find(x => x.canal === 'sms')!;
	assert.equal(l.respeitar_nao_perturbe, true);
});

test('B3: ajustes da carteira usam a chave (credor_id, canal) e "voltar ao da empresa" grava {}', () => {
	assert.equal(CONFLITO_CREDOR_CANAIS, 'credor_id,canal');
	const rows = { whatsapp: { ...padrao.whatsapp, ativo: false } };
	const novas = linhasCarteira('1', '9', rows, padrao, { whatsapp: ['ativo'] }, {});
	assert.deepEqual(novas, [{ empresa_id: '1', credor_id: '9', canal: 'whatsapp', ajustes: { ativo: false } }]);
	// tinha ajuste no SMS ao carregar, a pessoa voltou tudo ao da empresa: grava {} (herda)
	const volta = linhasCarteira('1', '9', {}, padrao, { sms: [] }, { sms: ['ativo'] });
	assert.deepEqual(volta, [{ empresa_id: '1', credor_id: '9', canal: 'sms', ajustes: {} }]);
	// produto padrão vazio não vai como null (o gatilho recusaria): some a chave
	const prod = linhasCarteira('1', '9', {}, padrao, { sms: ['produto_padrao'] }, {});
	assert.deepEqual(prod, []);
});

test('B20: custo aceita vírgula (pt-BR) e recusa negativo', () => {
	assert.deepEqual(lerCusto('0,06'), { valor: 0.06 });
	assert.deepEqual(lerCusto('0.06'), { valor: 0.06 });
	assert.deepEqual(lerCusto('R$ 1,50'), { valor: 1.5 });
	assert.deepEqual(lerCusto(''), { valor: null });
	assert.ok('erro' in lerCusto('-1'));
	assert.ok('erro' in lerCusto('abc'));
});

test('B5/B18: segmento sem pacote usa o padrão do banco; código longo é avisado (nunca cortado)', () => {
	assert.equal(PACOTE_PADRAO, 'básico');
	assert.equal(erroCodigo('MED'), null);
	assert.match(erroCodigo('medio-entre') ?? '', /sem hífen/);
	assert.match(erroCodigo('MEDIO') ?? '', /no máximo 4/);
});

test('B8: painel de faturas montado do banco (aberta no cartão, anteriores na lista, contatos por papel_contrato)', () => {
	const p = montarPainel({
		ciclo: { modelo_pagamento: 'pos', formas: ['boleto', 'pix'] },
		empresa: { cnpj: '00.000.000/0001-00' },
		faturas: [
			{ id: 2, competencia: '2026-10-01', situacao: 'aberta', situacao_atual: 'vencida', valor_total: '100.50', vencimento: '2026-11-10' },
			{ id: 1, competencia: '2026-09-01', situacao: 'paga', situacao_atual: 'paga', valor_total: 80, vencimento: '2026-10-10' },
			{ id: 3, competencia: '2026-11-01', situacao: 'rascunho', situacao_atual: 'rascunho', valor_total: 1, vencimento: '2026-12-10' },
		],
		itens: [{ fatura_id: 2, ordem: 1, item: 'orquestracao', descricao: 'Orquestração · CPFs ativos no mês', quantidade: 3000, preco: 0.35, valor: 1050 }],
		notas: [{ fatura_id: 1, numero: '12', link_pdf: 'https://nf.exemplo/1.pdf', situacao: 'autorizada' }],
		saldo: null, recargas: [{ id: 5, situacao: 'pendente' }], cartao: null,
		contatos: [{ email: 'fin@exemplo.invalid', papel_contrato: 'financeiro', recebe_faturas: false }],
	});
	assert.equal(p.modelo, 'pos');
	assert.equal(p.fatura_aberta?.id, 2);
	assert.equal(p.fatura_aberta?.situacao, 'vencida');
	assert.equal(p.fatura_aberta?.valor_total, 100.5);
	assert.equal((p.fatura_aberta?.itens as unknown[]).length, 1);
	assert.deepEqual(p.faturas.map(f => f.id), [1]);                  // rascunho nunca aparece ao cliente
	assert.equal((p.faturas[0].nota as { link_pdf: string }).link_pdf, 'https://nf.exemplo/1.pdf');
	assert.equal(p.recargas[0].situacao, 'aguardando');
	assert.equal(p.dados.email_financeiro, 'fin@exemplo.invalid');
	assert.deepEqual(p.dados.formas, ['boleto', 'pix']);
	assert.deepEqual(destinatariosFaturas([{ email: 'a@x.invalid', recebe_faturas: true }, { email: 'b@x.invalid', papel_contrato: 'financeiro' }]), ['a@x.invalid']);
});

test('B9/B10: Console › Faturamento com o nome da empresa, mensagem dos rascunhos e "sem contato" (text[])', () => {
	const l = comNomeDaEmpresa([{ id: 1, empresa_id: 2 }, { id: 2, empresa_id: 1 }], [{ id: 1, nome: 'Beta' }, { id: 2, nome: 'Alfa', situacao: 'ativa' }]);
	assert.deepEqual(l.map(f => f.empresa), ['Alfa', 'Beta']);
	assert.equal(l[0].empresa_situacao, 'ativa');
	assert.match(mensagemRascunhos(0), /^Nenhum rascunho novo/);
	assert.equal(mensagemRascunhos(1), '1 rascunho gerado para o ciclo.');
	assert.equal(mensagemRascunhos(3), '3 rascunhos gerados para o ciclo.');
	assert.deepEqual(listaSemContato(['Recupera QA']), ['Recupera QA']);
	assert.deepEqual(listaSemContato([]), []);
	assert.deepEqual(listaSemContato(null), []);
});

test('erros: regra de negócio do banco (P0001 em pt-BR) aparece; erro técnico fica genérico', () => {
	assert.equal(mensagemDeNegocio({ code: 'P0001', message: 'só dá para fechar mês que já terminou' }), 'Só dá para fechar mês que já terminou.');
	assert.equal(mensagemDeNegocio({ code: 'P0001', message: 'escolha pelo menos uma fatura.' }), 'Escolha pelo menos uma fatura.');
	assert.equal(mensagemDeNegocio({ code: '23502', message: 'null value in column "x" violates not-null constraint' }), null);
	assert.equal(mensagemDeNegocio({ code: 'P0001', message: 'function foo() does not exist' }), null);
	assert.equal(mensagemDeNegocio({ code: '42501', message: 'permission denied for table x' }), null);
	assert.equal(mensagemDeNegocio(null), null);
});
