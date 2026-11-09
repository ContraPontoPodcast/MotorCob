// Regras do Fluxo do agente no site (src/lib/fluxo.ts): quadro por ramos, pendências do banco em texto, o bloqueio do
// envio para aprovação, os números do Desempenho e os limites do roleplay (os mesmos de SQL 58, 59 e 66).
// node --experimental-strip-types --test site/fluxo/fluxo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	MODOS, SEMPRE, TIPOS, TRAVAS, acaoSistema, correcaoDe, tirarSensiveisDaFala, caminhosPara, numerosRoteiro, resultadoFinal, roteiro, seNaoEntender, textoVolta, comoCorrigir, estadoEnvio, explicar, falaOk, nomesEtapas, textoSaida, tituloRamo, variaveisDoTexto, variaveisSensiveis, funil, impedem, kpisDoFluxo, misturaModos, modoPredominante, nomeAnexo, novoBloco,
	proximoId, quadroPorRamos, removerBloco, roleplayValido, saidasFaltando, saidasPossiveis, somarMetricas, tipoDaSaida, validarLocal,
	type Bloco, type Definicao,
} from '../src/lib/fluxo.ts';
import { NUMERO_TRAVA, NOMES_TRAVA, etapaDoTeste, rotuloTrava, textoFim, travasDoTeste } from '../src/lib/fluxo.ts';
import { CERTEZAS, ORDEM_MODOS, cartoesModo, certezaEmPalavras, checarFala, exemplosDaSaida, modosDoTipo, palavras, pedeSenha } from '../src/lib/fluxo.ts';
import { comoSoa, dataPorExtenso, porExtenso, preencherTeste, reaisPorExtenso, trechosFalados, valoresTeste } from '../src/lib/falado.ts';

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
	assert.equal(MODOS.cognicao.nome, 'IA entende a resposta');
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

// ------------------------------------------------------------ redesenho PR1/PR2 (SPEC do novo editor do fluxo)
test('setas com nome: "Sou eu → Confirmar identidade"; nomes repetidos ganham o código só neles', () => {
	const d = negociador();
	const nomes = nomesEtapas(d);
	assert.equal(nomes.get('N2'), 'Confirmar identidade');
	assert.equal(nomes.get('N3'), 'Entender intenção');
	// três "Encerrar" sem título: o código entra entre parênteses para distinguir
	assert.equal(nomes.get('N7'), 'Encerrar (N7)');
	assert.equal(nomes.get('N14'), 'Encerrar (N14)');
	assert.equal(textoSaida(d.blocos[0].saidas[0], nomes), 'Sou eu → Confirmar identidade');
	assert.equal(textoSaida(s('x', 'Volta', 'N99'), nomes), 'Volta → etapa que não existe mais');
	for (const b of d.blocos) for (const x of b.saidas) assert.doesNotMatch(textoSaida(x, nomes), /[→↪] N\d/);
	// com título, o título vale
	const t = { ...d, blocos: d.blocos.map(b => (b.id === 'N14' ? { ...b, titulo: 'Recado neutro' } : b)) };
	assert.equal(nomesEtapas(t).get('N14'), 'Recado neutro');
});

test('ramos com nome de conversa e caminhos que ficam sem destino ao remover', () => {
	const d = negociador();
	const r = quadroPorRamos(d);
	const ramo = (n: string) => r.find(x => x.nome === n)!;
	assert.equal(tituloRamo(ramo('Já paguei'), d), 'Se disser "Já paguei"');
	assert.equal(tituloRamo(ramo('Se Chamar conector falhar'), d), 'Se Chamar conector falhar');
	assert.equal(tituloRamo(r[0], d), 'Caminho principal');
	assert.equal(tituloRamo({ nome: 'Sem acordo', origem: 'N5', blocos: [], tipo: 'ramo' }, d), 'Se a conversa terminar em "Sem acordo"');
	assert.equal(tituloRamo({ nome: 'Respondeu', origem: 'N4', blocos: [], tipo: 'ramo' }, d), 'Se der "Respondeu"');
	assert.deepEqual(caminhosPara(d, 'N9'), [{ de: 'N3', rotulo: 'Sem dinheiro' }, { de: 'N6', rotulo: 'Recusou' }]);
	assert.deepEqual(caminhosPara(d, 'N17'), []);
});

test('trava 1 ao digitar: validarLocal confere valor_antes_identidade com os mesmos casos do validador Python', () => {
	const { casos } = JSON.parse(readFileSync(new URL('../../tests/dados/fluxo_valor_antes_identidade_casos.json', import.meta.url), 'utf8')) as { casos: { nome: string; definicao: Definicao; esperado: string[] }[] };
	assert.ok(casos.length >= 8);
	for (const c of casos) assert.deepEqual(validarLocal(c.definicao).filter(e => e.startsWith('valor_antes_identidade')), c.esperado, c.nome);
	// o negociador do desenho não tem a pendência (o saldo só vem depois de "Confirmou")
	assert.ok(!validarLocal(negociador()).some(e => e.startsWith('valor_antes_identidade')));
	// variáveis: mesmo recorte do validador (conteúdo até o 1º "}", sem espaços nas pontas)
	assert.deepEqual(variaveisDoTexto('a {{ credor }} b {{saldo}} {{x} {{{{assessoria}}'), ['credor', 'saldo', '{{assessoria']);   // igual a FV.variaveis
	assert.deepEqual(variaveisSensiveis(blk('N1', 'abertura', 'arvore', [], { fala: '{{assessoria}} {{primeiro_nome}} {{credor}} {{credor}}' })), ['credor']);
	assert.equal(explicar('valor_antes_identidade:N1').bloco, 'N1');
	assert.match(comoCorrigir('valor_antes_identidade:N1'), /Confirmar identidade/);
});

test('o que corrigir: toda pendência de etapa que o editor marca diz como corrigir', () => {
	for (const c of ['sem_saida:N9', 'inalcancavel:N17', 'saida_faltando:N4', 'conector_inativo:N7', 'sem_alcada', 'valor_antes_identidade:N1', 'identidade_sem_conferencia:N2', 'transferir_humano_desligado:N5', 'generativo_sem_objetivo:N5']) assert.ok(comoCorrigir(c).length > 20, c);
	assert.equal(comoCorrigir('roleplay_ausente'), '');
});

test('travas: uma lista só, 7 itens, sem prometer o que o executor ainda não faz', () => {
	assert.equal(TRAVAS.length, 7);
	const tudo = [...TRAVAS.flat(), ...SEMPRE.flat()].join(' ');
	assert.doesNotMatch(tudo, /CPF|tema sensível|caixa postal/i);         // B2 e B4 ainda não estão no ar
	assert.ok(SEMPRE.some(([q]) => /Não me ligue/.test(q)) && SEMPRE.some(([q]) => /pessoa/.test(q)));
	assert.notEqual(MODOS.arvore.cor, MODOS.sistema.cor);
});

test('roteiro: capítulos na ordem da conversa (começo, motivo, negociação), ramos com nome, finais e soltos', () => {
	const d = negociador();
	const caps = roteiro(d);
	assert.deepEqual(caps.map(c => [c.titulo, c.blocos.map(b => b.id)]), [
		['Começo da ligação', ['N1', 'N2']],                   // até Confirmar identidade
		['Motivo da ligação', ['N3']],                         // antes da 1ª etapa de negociação
		['Negociação', ['N4', 'N5']],                          // do conector em diante
		['Se disser "Já paguei"', ['N8']],
		['Se disser "Sem dinheiro"', ['N9']],
		['Se Chamar conector falhar', ['N6']],
		['Finais usados por vários caminhos', ['N7', 'N13', 'N14']],
		['Etapas que nenhum caminho alcança', ['N17']],
	]);
	assert.equal(caps[1].sub, 'Só depois da identidade confirmada');
	assert.equal(caps[3].sub, 'A partir de Entender intenção');
	assert.deepEqual(caps.map(c => c.tipo), ['conversa', 'conversa', 'conversa', 'ramo', 'ramo', 'ramo', 'finais', 'solto']);
	// cada etapa aparece uma vez só, e todas aparecem
	const ids = caps.flatMap(c => c.blocos.map(b => b.id));
	assert.equal(new Set(ids).size, ids.length);
	assert.deepEqual([...ids].sort(), d.blocos.map(b => b.id).sort());
	// numeração na ordem de leitura
	const n = numerosRoteiro(caps);
	assert.deepEqual([...n.entries()].slice(0, 6), [['N1', 1], ['N2', 2], ['N3', 3], ['N4', 4], ['N5', 5], ['N8', 6]]);
	assert.equal(n.get('N17'), d.blocos.length);
});

test('roteiro: sem identidade, sem negociação e só finais depois do começo; fluxo vazio', () => {
	const loc: Definicao = { esquema: 1, blocos: [
		blk('N1', 'abertura', 'arvore', [s('titular', 'Sou eu', 'N2'), s('terceiro', 'Não é a pessoa', 'N3')]),
		blk('N2', 'identidade', 'cognicao', [s('confirmou', 'Confirmou', 'N4'), s('nao_confirmou', 'Não confirmou', 'N3')], { conector_id: 2 }),
		blk('N3', 'encerrar', 'arvore', [], { resultado: 'recado' }),
		blk('N4', 'transferir', 'arvore', [], { motivo: 'cpc' }),
	] };
	assert.deepEqual(roteiro(loc).map(c => [c.titulo, c.blocos.map(b => b.id)]), [['Começo da ligação', ['N1', 'N2']], ['Fim da ligação', ['N4']], ['Finais usados por vários caminhos', ['N3']]]);
	const semId: Definicao = { esquema: 1, blocos: [
		blk('N1', 'abertura', 'arvore', [s('titular', 'Sou eu', 'N2'), s('terceiro', 'Não é a pessoa', 'N3')]),
		blk('N2', 'pergunta', 'arvore', [s('sim', 'Sim', 'N3'), s('nao', 'Não', 'N3')]),
		blk('N3', 'encerrar', 'arvore', [], { resultado: 'recado' }),
	] };
	const c = roteiro(semId);
	assert.deepEqual(c.map(x => [x.titulo, x.sub, x.blocos.map(b => b.id)]), [['Começo da ligação', 'Quem atende e quem é a pessoa', ['N1']], ['Motivo da ligação', 'Depois da abertura', ['N2']], ['Finais usados por vários caminhos', 'Transferir e encerrar', ['N3']]]);
	assert.deepEqual(roteiro({ esquema: 1, blocos: [] }), []);
});

test('roteiro: volta dita na seta (sem repetir a etapa), "se não entender" igual ao executor, sistema e finais em palavras', () => {
	const d = negociador();
	d.blocos.find(b => b.id === 'N6')!.saidas.push(s('quer_outra', 'Quer outra condição', 'N5'));
	d.blocos.find(b => b.id === 'N5')!.repetir_max = 2;
	d.blocos.find(b => b.id === 'N5')!.saidas.push(s('sem_acordo', 'Sem acordo', 'N6', 'devolve'));   // N5 ↔ N6: uma volta
	const n = numerosRoteiro(roteiro(d));
	const n6 = d.blocos.find(b => b.id === 'N6')!;
	assert.equal(textoVolta(n6.saidas.find(x => x.quando === 'quer_outra')!, 'N6', n, d), 'volta; no máximo 2 vezes');
	assert.equal(textoVolta(n6.saidas.find(x => x.quando === 'aceitou')!, 'N6', n, d), '');   // N7 vem depois
	const sem = negociador();                                                                 // sem a volta, ir a uma etapa lida antes não é "volta"
	sem.blocos.find(b => b.id === 'N6')!.saidas.push(s('quer_outra', 'Quer outra condição', 'N5'));
	assert.equal(textoVolta(sem.blocos.find(b => b.id === 'N6')!.saidas.at(-1)!, 'N6', numerosRoteiro(roteiro(sem)), sem), '');
	// voz/fluxo.py › _tentar_de_novo: tentativas (padrão 2) − 1 repetições; depois, a saída de cada tipo
	const b = (id: string) => d.blocos.find(x => x.id === id)!;
	assert.deepEqual(seNaoEntender(b('N1')), { repete: 1, fala: 'Desculpe. Falo com {{primeiro_nome}}?', quando: 'terceiro' });
	assert.deepEqual(seNaoEntender(b('N2')), { repete: 1, fala: 'Desculpe, não entendi. Pode repetir, por exemplo, 15 de março?', quando: 'nao_confirmou' });
	assert.equal(seNaoEntender(b('N3'))?.quando, 'nao_entendido');
	assert.equal(seNaoEntender(b('N6'))?.quando, 'recusou');
	assert.equal(seNaoEntender(b('N9'))?.quando, 'nao_agendou');
	assert.deepEqual(seNaoEntender(blk('N20', 'pergunta', 'arvore', [], { fala: 'Posso seguir?', tentativas: 1 })), { repete: 0, fala: 'Posso seguir?', quando: 'sem_resposta' });
	for (const id of ['N4', 'N5', 'N7', 'N13']) assert.equal(seNaoEntender(b(id)), null, id);   // sistema, IA e finais não "ouvem"
	assert.equal(acaoSistema(blk('N30', 'condicao', 'sistema', [], { campo: 'ofertas_quantidade', op: '>=', valor: 1 })), 'Confere: Ofertas recebidas ≥ 1');
	assert.match(acaoSistema(b('N4')), /^Chama um conector do CRM\. Enquanto espera, diz: "Um instante, por favor\."$/);
	assert.equal(resultadoFinal(b('N14')), 'resultado: Recado neutro (terceiro)');
	assert.equal(resultadoFinal(b('N13')), 'transferida: Pediu um atendente');
});

// ---------------------------------------------------------------- correções de um clique (PR4)
test('correções de um clique: os mesmos casos que o validador Python confere (tests/dados/fluxo_correcoes_casos.json)', () => {
	const dados = JSON.parse(readFileSync(new URL('../../tests/dados/fluxo_correcoes_casos.json', import.meta.url), 'utf8')) as {
		conectores: { id: number; nome: string; finalidade: string; situacao: string }[];
		casos: { nome: string; codigo: string; botao: string; antes: Definicao; depois: Definicao }[];
		sem_botao: { nome: string; codigo: string; antes: Definicao }[];
	};
	assert.ok(dados.casos.length >= 10 && dados.sem_botao.length >= 3);
	for (const c of dados.casos) {
		const k = correcaoDe(c.antes, c.codigo, { conectores: dados.conectores });
		assert.ok(k, c.nome);
		assert.deepEqual(k.definicao, c.depois, c.nome);           // a regra não mudou sem regerar os casos
		assert.equal(k.botao, c.botao, c.nome);
		assert.ok(k.mudancas.length > 0 && k.mudancas.every(m => m.antes !== m.depois), c.nome);   // sempre mostra o antes → depois
		const antes = new Set(validarLocal(c.antes));
		const depois = validarLocal(c.depois);
		assert.ok(!depois.includes(c.codigo), c.nome);
		assert.deepEqual(depois.filter(e => !antes.has(e)), [], c.nome);
		assert.notEqual(k.definicao, c.antes);                    // não muda a definição recebida
	}
	for (const c of dados.sem_botao) assert.equal(correcaoDe(c.antes, c.codigo, { conectores: dados.conectores }), null, c.nome);
});

test('correções de um clique: a definição de entrada não é alterada (o rascunho só muda ao confirmar)', () => {
	const d = negociador();
	const copia = JSON.stringify(d);
	const k = correcaoDe(d, 'sem_saida:N9');
	assert.ok(k);
	assert.equal(JSON.stringify(d), copia);
	// N9 liga "Agendou" ao Encerrar de retorno que estava solto: some também o "inalcançável" de N17
	assert.deepEqual(k.definicao.blocos.find(b => b.id === 'N9')?.saidas.map(x => [x.quando, x.para]), [['agendou', 'N17'], ['nao_agendou', 'N13']]);
	assert.ok(!validarLocal(k.definicao).some(e => e === 'sem_saida:N9' || e === 'inalcancavel:N17'));
	assert.equal(k.mudancas[0].antes, 'sem destino');
	// pendência que não existe ou código desconhecido: sem botão
	assert.equal(correcaoDe(d, 'sem_saida:N99'), null);
	assert.equal(correcaoDe(d, 'fala_longa:N1'), null);
	assert.equal(correcaoDe(d, 'sem_alcada'), null);                // alçada é decisão da empresa: abre a gaveta
	// N17 tem quem poderia usá-la? Não: nenhum caminho chega e ela não leva a nada. Remover é seguro.
	assert.equal(correcaoDe(d, 'inalcancavel:N17')?.botao, 'Remover a etapa');
});

test('correções de um clique: tirar da fala o que não pode ser dito antes da identidade', () => {
	assert.equal(tirarSensiveisDaFala('Olá, bom dia! Aqui é a Lia, da {{assessoria}}, em nome do {{credor}}. Falo com {{primeiro_nome}}?'), 'Olá, bom dia! Aqui é a Lia, da {{assessoria}}. Falo com {{primeiro_nome}}?');
	assert.equal(tirarSensiveisDaFala('Olá. O {{credor}} pediu contato. Falo com {{primeiro_nome}}?'), 'Olá. Falo com {{primeiro_nome}}?');
	assert.equal(tirarSensiveisDaFala('{{credor}} aqui. Falo com {{primeiro_nome}}?'), 'Falo com {{primeiro_nome}}?');
	assert.equal(tirarSensiveisDaFala('Sobre R$ 1.380,00 do {{credor}}. Falo com {{primeiro_nome}}?'), 'Falo com {{primeiro_nome}}?');
	assert.equal(tirarSensiveisDaFala('Falo com {{primeiro_nome}}?'), 'Falo com {{primeiro_nome}}?');   // nada a tirar
	assert.equal(tirarSensiveisDaFala('{{saldo}}'), null);                                              // não sobra fala: sem botão
	assert.equal(tirarSensiveisDaFala('Em nome do {{credor}}, {{primeiro_nome}}.'), null);
});

// ---------------------------------------------------------------- PR5: detalhe da etapa
test('modos em cartões: 4 cartões com os nomes em palavras e os mesmos códigos de sempre', () => {
	assert.deepEqual(ORDEM_MODOS, ['arvore', 'cognicao', 'generativo', 'sistema']);
	assert.deepEqual(ORDEM_MODOS.map(m => MODOS[m].nome), ['Fala fixa', 'IA entende a resposta', 'IA conversa', 'Sem fala']);
	assert.deepEqual(ORDEM_MODOS.map(m => MODOS[m].antigo), ORDEM_MODOS);           // o código interno não mudou
	for (const tipo of Object.keys(TIPOS) as Bloco['tipo'][]) {
		for (const modo of modosDoTipo(tipo)) {
			const cs = cartoesModo({ tipo, modo });
			assert.equal(cs.length, 4, tipo);
			assert.deepEqual(cs.map(c => c.modo), ORDEM_MODOS);
			assert.deepEqual(cs.filter(c => c.escolhido).map(c => c.modo), [modo], `${tipo}:${modo}`);
			// disponível ⇔ o banco aceita o modo para o tipo; o que não vale sempre diz por quê
			for (const c of cs) {
				assert.equal(c.disponivel, modosDoTipo(tipo).includes(c.modo), `${tipo}:${c.modo}`);
				assert.equal(!!c.motivo, !c.disponivel, `${tipo}:${c.modo}`);
				assert.ok(c.frase.endsWith('.'), c.frase);
			}
		}
	}
	const abertura = cartoesModo({ tipo: 'abertura', modo: 'arvore' });
	assert.equal(abertura.find(c => c.modo === 'cognicao')?.motivo, 'Não vale para etapa com trava.');
	assert.equal(cartoesModo({ tipo: 'identidade', modo: 'cognicao' }).find(c => c.modo === 'generativo')?.motivo, 'Quem confere a identidade é o CRM, nunca a IA.');
	assert.equal(cartoesModo({ tipo: 'conector', modo: 'sistema' }).find(c => c.modo === 'arvore')?.motivo, 'Esta etapa não fala com o cliente.');
	assert.ok(cartoesModo({ tipo: 'oferta', modo: 'arvore' }).find(c => c.modo === 'cognicao')?.disponivel);
});

test('como soa: a mesma tabela de casos do Python (tests/dados/fala_por_extenso_casos.json)', () => {
	const t = JSON.parse(readFileSync(new URL('../../tests/dados/fala_por_extenso_casos.json', import.meta.url), 'utf8')) as { numeros: [number, string][]; falas: [string, string][] };
	assert.ok(t.numeros.length >= 20 && t.falas.length >= 20);
	for (const [n, e] of t.numeros) assert.equal(porExtenso(n), e, String(n));
	for (const [f, e] of t.falas) assert.equal(comoSoa(f), e, f);
	assert.equal(porExtenso(2, true), 'duas');
	assert.equal(porExtenso(201, true), 'duzentas e uma');
	assert.equal(reaisPorExtenso(1, 1), 'um real e um centavo');
	assert.equal(reaisPorExtenso(2_000_000), 'dois milhões de reais');
	assert.equal(dataPorExtenso(5, 12), 'cinco de dezembro');
	assert.equal(dataPorExtenso(0, 5), null);
	assert.deepEqual(trechosFalados('6× de R$ 230,00 em 05/12. Ok?'), [{ de: '6×', para: 'seis vezes' }, { de: 'R$ 230,00', para: 'duzentos e trinta reais' }, { de: '05/12', para: 'cinco de dezembro' }]);
});

test('como soa: preenche com o cliente de teste do simulador e não repete "R$"', () => {
	const v = valoresTeste('Aurora Cobranças', 'Cartão Aurora');
	assert.equal(v.primeiro_nome, 'Ana');
	assert.equal(comoSoa(preencherTeste('Consta {{saldo}} no {{credor}}.', v)), 'Consta mil trezentos e oitenta reais no Cartão Aurora.');
	assert.equal(preencherTeste('Consta R$ {{saldo}}.', v), 'Consta R$ 1.380,00.');
	assert.equal(comoSoa(preencherTeste('{{oferta.parcelas}} parcelas de {{oferta.valor_parcela}}, a primeira em {{oferta.vencimento}}.', v)), 'seis parcelas de duzentos e trinta reais, a primeira em cinco de dezembro.');
	assert.equal(preencherTeste('{{desconhecida}}', v), '{{desconhecida}}');
});

test('checagens da fala: tamanho para o ouvido, uma pergunta, trava 1, senha e números lidos', () => {
	const base = { antesDaIdentidade: true, credorAntes: false, sensiveis: [] as string[], trechos: [] as { de: string; para: string }[] };
	const curta = checarFala({ ...base, fala: 'Olá! Falo com {{primeiro_nome}}?', falada: 'Olá! Falo com Ana?' });
	assert.deepEqual(curta.map(c => c.estado), ['ok', 'ok', 'ok', 'ok']);
	assert.equal(curta[0].texto, '4 palavras (curta para o ouvido)');
	const longa = 'palavra '.repeat(30) + '?';
	const c2 = checarFala({ ...base, fala: longa + ' E agora?', falada: longa });
	assert.equal(c2[0].estado, 'atencao');
	assert.match(c2[0].texto, /^30 palavras, cerca de 12 s: longa para o ouvido/);
	assert.equal(c2[1].estado, 'atencao');
	assert.match(c2[1].texto, /^2 perguntas/);
	assert.match(checarFala({ ...base, fala: 'x', falada: 'p '.repeat(41) })[0].texto, /longa demais para voz/);
	const credor = checarFala({ ...base, fala: 'Falo em nome do {{credor}}?', falada: 'Falo em nome do Cartão Aurora?', credorAntes: true, sensiveis: ['credor'] });
	assert.deepEqual(credor.find(c => c.estado === 'erro'), { estado: 'erro', texto: 'Cita {{credor}} antes de confirmar a identidade (trava 1)' });
	// depois da identidade, a trava 1 não se aplica (não aparece)
	assert.ok(!checarFala({ ...base, fala: 'Consta {{saldo}}.', falada: 'Consta mil reais.', antesDaIdentidade: false }).some(c => /identidade/.test(c.texto)));
	assert.equal(checarFala({ ...base, fala: 'Me passa a senha do cartão', falada: 'Me passa a senha do cartão' }).find(c => c.estado === 'erro')?.texto, 'Pede senha ou número de cartão (trava 2: nunca)');
	assert.ok(pedeSenha('Qual o NÚMERO DO CARTÃO?') && pedeSenha('o código de segurança') && !pedeSenha('o pagamento é pelo link'));
	const num = checarFala({ ...base, fala: 'Consta {{saldo}}.', falada: 'Consta mil trezentos e oitenta reais.', antesDaIdentidade: false, trechos: [{ de: 'R$ 1.380,00', para: 'mil trezentos e oitenta reais' }] });
	assert.deepEqual(num[num.length - 1], { estado: 'info', texto: 'Números como vão ser lidos: "R$ 1.380,00" → "mil trezentos e oitenta reais"' });
	assert.deepEqual(checarFala({ ...base, fala: '  ', falada: '' }), [{ estado: 'erro', texto: 'Sem fala escrita.' }]);
	assert.equal(palavras('Olá, Ana! — tudo bem?'), 4);
});

test('o cliente pode responder: exemplos da etapa ou do catálogo, e certeza em palavras', () => {
	const d = negociador();
	const n3 = { ...d.blocos.find(b => b.id === 'N3')!, params: { ...d.blocos.find(b => b.id === 'N3')!.params, exemplos: { ja_paguei: ['paguei ontem'] } } };
	assert.deepEqual(exemplosDaSaida(n3, 'ja_paguei'), { exemplos: ['paguei ontem'], doCatalogo: false });
	assert.deepEqual(exemplosDaSaida(n3, 'quero_negociar'), { exemplos: ['Quero parcelar.', 'Como eu pago?'], doCatalogo: true });
	assert.deepEqual(exemplosDaSaida(d.blocos.find(b => b.id === 'N1')!, 'terceiro').exemplos, ['Não, aqui é a vizinha.', 'Ela não está.']);
	assert.deepEqual(exemplosDaSaida(blk('P', 'pergunta', 'arvore'), 'sim'), { exemplos: ['Sim'], doCatalogo: false });
	assert.deepEqual(exemplosDaSaida(blk('C', 'conector', 'sistema'), 'respondeu'), { exemplos: [], doCatalogo: true });
	assert.deepEqual(CERTEZAS.map(c => c[1]), ['Menos exigente', 'Normal', 'Mais exigente']);
	assert.equal(certezaEmPalavras(0.7), 'Normal');
	assert.equal(certezaEmPalavras(undefined), 'Normal');
	assert.equal(certezaEmPalavras(0.8), 'Personalizada (0,80)');
});

// ---------------------------------------------------------------- PR6: testar ao lado
test('testar ao lado: a etapa acesa é a última do caminho; as anteriores passaram', () => {
	const d = negociador();
	assert.deepEqual(etapaDoTeste(null, d), { atual: null, passou: new Set(), terminou: false });
	const e = etapaDoTeste({ caminho: ['N1', 'N2', 'N3', 'NX'], encerrada: false }, d);        // id que não existe é ignorado
	assert.equal(e.atual, 'N3');
	assert.deepEqual([...e.passou], ['N1', 'N2']);
	assert.equal(e.terminou, false);
	// volta (N5 → N6 → N5): a etapa atual não aparece como "passou"
	const v = etapaDoTeste({ caminho: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N5'], encerrada: true }, d);
	assert.equal(v.atual, 'N5');
	assert.ok(!v.passou.has('N5') && v.passou.has('N6'));
	assert.equal(v.terminou, true);
});

test('testar ao lado: qual trava agiu, quando e onde', () => {
	assert.deepEqual(Object.values(NUMERO_TRAVA).sort(), [1, 2, 3, 4, 5, 6, 7]);
	for (const k of Object.keys(NUMERO_TRAVA)) assert.ok(NOMES_TRAVA[k], k);
	const turnos = [
		{ pessoa: null, bloco: 'N1', falas: [{ bloco: 'N1' }], travas: [] },
		{ pessoa: 'Sou eu.', bloco: 'N2', falas: [{ bloco: 'N2' }], travas: [] },
		{ pessoa: 'Não me ligue mais.', bloco: 'N2', falas: [{ bloco: 'N2' }], travas: ['nao_me_ligue'], fim: 'opt_out' },
	];
	const t = travasDoTeste(turnos);
	assert.deepEqual(t, [{ turno: 2, trava: 'nao_me_ligue', numero: 3, nome: '"Não me ligue"', etapa: 'N2', pessoa: 'Não me ligue mais.' }]);
	assert.equal(rotuloTrava(t[0]), 'Trava 3 · "Não me ligue"');
	assert.equal(rotuloTrava({ numero: null, nome: 'Repetição' }), 'Repetição');
	assert.equal(travasDoTeste([{ pessoa: 'x', bloco: null, falas: [], travas: ['repeticao'] }])[0].numero, null);
	assert.equal(textoFim('opt_out'), 'opt-out');
	assert.equal(textoFim('transferida · pedido_humano'), 'transferida · pedido humano');
});
