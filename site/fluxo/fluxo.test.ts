// Regras do Fluxo do agente no site (src/lib/fluxo.ts): quadro por ramos, pendências do banco em texto, o bloqueio do
// envio para aprovação, os números do Desempenho e os limites do roleplay (os mesmos de SQL 58, 59 e 66).
// node --experimental-strip-types --test site/fluxo/fluxo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	MODOS, TIPOS, estadoEnvio, explicar, falaOk, funil, impedem, kpisDoFluxo, misturaModos, modoPredominante, nomeAnexo, novoBloco,
	proximoId, quadroPorRamos, removerBloco, roleplayValido, saidasFaltando, saidasPossiveis, somarMetricas, tipoDaSaida, validarLocal,
	type Bloco, type Definicao,
} from '../src/lib/fluxo.ts';

const s = (quando: string, rotulo: string, para: string, tipo: 'normal' | 'devolve' | 'falha' = 'normal') => ({ quando, rotulo, para, tipo });
const blk = (id: string, tipo: Bloco['tipo'], modo: Bloco['modo'], saidas: ReturnType<typeof s>[] = [], params: Record<string, unknown> = {}): Bloco => ({ id, tipo, modo, params: { ...TIPOS[tipo].params(), ...params }, saidas });

/** Negociador do desenho (v5): N9 sem saída e N17 inalcançável. */
function negociador(): Definicao {
	return { esquema: 1, blocos: [
		blk('N1', 'abertura', 'arvore', [s('titular', 'Sou eu', 'N2'), s('terceiro', 'Não é a pessoa', 'N14')]),
		blk('N2', 'identidade', 'cognicao', [s('confirmou', 'Confirmou', 'N3'), s('nao_confirmou', 'Não confirmou', 'N14'), s('falhou', 'Conector falhou', 'N13', 'falha')], { conector_id: 2 }),
		blk('N3', 'intencao', 'cognicao', [s('quero_negociar', 'Quer negociar', 'N4'), s('ja_paguei', 'Já paguei', 'N8'), s('sem_dinheiro', 'Sem dinheiro', 'N9'), s('nao_entendido', 'Não entendi', 'N13')], { intencoes: ['quero_negociar', 'ja_paguei', 'sem_dinheiro'] }),
		blk('N4', 'conector', 'sistema', [s('respondeu', 'Respondeu', 'N5'), s('falhou', 'Falhou', 'N6', 'falha')]),
		blk('N5', 'generativa', 'generativo', [s('fechou_acordo', 'Fechou acordo', 'N7', 'devolve'), s('fora_alcada', 'Fora da alçada', 'N13', 'devolve')], { objetivo: 'Fechar acordo com uma das ofertas recebidas.' }),
		blk('N7', 'encerrar', 'arvore', [], { resultado: 'promessa' }),
		blk('N6', 'oferta', 'cognicao', [s('aceitou', 'Aceitou', 'N7'), s('recusou', 'Recusou', 'N9')]),
		blk('N8', 'encerrar', 'arvore', [], { resultado: 'recusa' }),
		blk('N9', 'retorno', 'cognicao'),
		blk('N17', 'encerrar', 'arvore', [], { resultado: 'retorno_agendado' }),
		blk('N13', 'transferir', 'arvore'),
		blk('N14', 'encerrar', 'arvore', [], { resultado: 'recado' }),
	] };
}

test('quadro por ramos: caminho principal em cima, ramos com o nome da saída, finais compartilhados e soltos', () => {
	const r = quadroPorRamos(negociador());
	assert.equal(r[0].nome, 'Caminho principal');
	assert.deepEqual(r[0].blocos.map(b => b.id), ['N1', 'N2', 'N3', 'N4', 'N5']);     // N7 tem duas entradas: vai para os finais
	const nomes = r.map(x => x.nome);
	assert.ok(nomes.includes('Já paguei'));
	assert.ok(nomes.includes('Sem dinheiro'));
	assert.ok(nomes.includes('Se Chamar conector falhar'), nomes.join(' | '));
	const finais = r.find(x => x.tipo === 'finais');
	assert.deepEqual(finais?.blocos.map(b => b.id), ['N7', 'N13', 'N14']);
	assert.deepEqual(r.find(x => x.tipo === 'solto')?.blocos.map(b => b.id), ['N17']);
	// toda etapa aparece uma vez só
	const todas = r.flatMap(x => x.blocos.map(b => b.id)).sort();
	assert.deepEqual(todas, negociador().blocos.map(b => b.id).sort());
});

test('validação local aproxima o banco: sem saída, inalcançável e saída obrigatória', () => {
	const e = validarLocal(negociador());
	assert.ok(e.includes('sem_saida:N9'));
	assert.ok(e.includes('inalcancavel:N17'));
	const sem = { ...negociador(), blocos: negociador().blocos.filter(b => b.tipo !== 'abertura') };
	assert.ok(validarLocal(sem).includes('abertura_ausente'));
	const n4 = negociador().blocos.find(b => b.id === 'N4')!;
	assert.deepEqual(saidasFaltando({ ...n4, saidas: [n4.saidas[0]] }), ['Falhou']);
	// identidade com conector exige a saída "falhou"; sem conector, não
	const id = blk('N2', 'identidade', 'cognicao', [], { conector_id: null });
	assert.equal(saidasPossiveis(id).find(x => x.quando === 'falhou')?.obrig, false);
	assert.equal(tipoDaSaida({ tipo: 'generativa' }, 'sem_acordo'), 'devolve');
	assert.equal(tipoDaSaida({ tipo: 'conector' }, 'falhou'), 'falha');
});

test('códigos do banco viram texto; roleplay é aviso, nunca bloqueio', () => {
	assert.deepEqual(explicar('sem_saida:N9'), { codigo: 'sem_saida:N9', bloco: 'N9', texto: 'Etapa sem saída. A conversa ficaria parada aqui.', impede: true });
	assert.equal(explicar('sem_alcada').bloco, undefined);
	assert.equal(explicar('roleplay_reprovadas:3').impede, false);
	assert.match(explicar('roleplay_reprovadas:3').texto, /^3 conversas/);
	assert.match(explicar('caso_falhou:31').texto, /#31/);
	assert.equal(impedem(['sem_saida:N9', 'roleplay_ausente', 'conector_inativo:N7']).length, 2);
});

test('enviar para aprovação fica bloqueado, com o motivo, enquanto houver pendência', () => {
	const base = { situacao: 'rascunho' as const, sujo: false, podeEditar: true };
	const comErro = estadoEnvio({ ...base, erros: ['sem_saida:N9', 'inalcancavel:N17', 'conector_inativo:N7', 'sem_alcada'] });
	assert.equal(comErro.ok, false);
	assert.equal(comErro.motivo, '4 pendências impedem o envio.');
	assert.equal(estadoEnvio({ ...base, erros: ['sem_saida:N9'] }).motivo, '1 pendência impede o envio.');
	assert.equal(estadoEnvio({ ...base, erros: ['roleplay_ausente'] }).ok, true);           // aviso não bloqueia
	assert.equal(estadoEnvio({ ...base, erros: [] }).ok, true);
	assert.equal(estadoEnvio({ ...base, erros: [], sujo: true }).ok, false);
	assert.equal(estadoEnvio({ ...base, erros: [], podeEditar: false }).ok, false);
	assert.equal(estadoEnvio({ ...base, situacao: 'em_uso', erros: [] }).ok, false);
});

test('novo bloco, remover e mistura de modos', () => {
	const d = negociador();
	assert.equal(proximoId(d.blocos), 'N18');
	const nb = novoBloco('generativa', d.blocos);
	assert.equal(nb.modo, 'generativo');
	assert.deepEqual(nb.saidas, []);
	const sem13 = removerBloco(d, 'N13');
	assert.ok(sem13.blocos.every(b => b.saidas.every(x => x.para !== 'N13')));
	const m = misturaModos(d);
	assert.equal(m.reduce((a, x) => a + x.pct, 0), 100);
	assert.equal(MODOS.cognicao.nome, 'Entende e escolhe');
	assert.match(modoPredominante(d), /^Misto · fala fixa/);
});

test('desempenho: KPIs e funil só com contagens', () => {
	const d = negociador();
	const m = somarMetricas([
		{ bloco_id: 'N1', chegaram: 100, saidas: { titular: 80, terceiro: 20 } },
		{ bloco_id: 'N1', chegaram: 100, saidas: { titular: 80, terceiro: 20 } },
		{ bloco_id: 'N2', chegaram: 160, saidas: { confirmou: 120, nao_confirmou: 40 } },
		{ bloco_id: 'N3', chegaram: 120, saidas: { quero_negociar: 60, sem_dinheiro: 60 } },
		{ bloco_id: 'N7', chegaram: 30, saidas: {} },
		{ bloco_id: 'N13', chegaram: 10, saidas: {} },
	]);
	const k = kpisDoFluxo(d, m);
	assert.equal(k.atendidas, 200);
	assert.equal(k.identidade, 120);
	assert.equal(k.acordos, 30);                  // sem registrar: encerrar com resultado promessa
	assert.equal(k.transferidas, 10);
	assert.equal(k.taxaIdentidade, 0.6);
	const f = funil(d, m);
	assert.equal(f[0].bloco.id, 'N1');
	assert.deepEqual(f[0].saidas.map(x => x.rotulo), ['Não é a pessoa']);      // quem seguiu o caminho não "saiu"
	assert.equal(f[2].sairamAqui, 60);
});

test('falas de teste, roleplay e anexos seguem os limites do banco', () => {
	assert.equal(falaOk('Sou eu.'), true);
	assert.equal(falaOk('meu cpf é 12345678901'), false);
	assert.equal(falaOk('fulano@exemplo.com'), false);
	assert.equal(roleplayValido(6, 20), true);
	assert.equal(roleplayValido(11, 10), false);
	assert.equal(roleplayValido(10, 21), false);
	assert.equal(roleplayValido(10, 20), true);
	assert.equal(/[0-9]{10,}/.test(nomeAnexo('Política 2026 1234567890123.pdf', 'abc')), false);
	assert.match(nomeAnexo('Política de ofertas.xlsx', 'xyz'), /^xyz_Politica_de_ofertas\.xlsx$/);
});
