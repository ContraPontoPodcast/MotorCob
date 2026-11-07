// Estágios da estratégia como o motor os lê (passos Estágios, Régua e Revisar), avisos de "sem estágio", nome da
// estratégia criada de um modelo, salvar sem apagar a régua padrão e "Montar esteira pelas personas" por estágio.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { definicaoVazia, modeloClassicos, playbookDefinicao, type Definicao } from '@/lib/estrategia';
import { algumEstagioLigado, avisoSemEstagio, copiarReguaPadrao, estagiosDaEstrategia, nomeEstrategiaModelo, situacaoReguaFase } from '@/lib/estagios-regua';
import { removerMensagensCanaisSemMensagem } from '@/lib/mensagem-dia';
import { diasComAcao, estagiosParaPersonas, limparPersonas, montarRaias, normalizarDefinicao, passosDoEstagio, personasComRaia } from '@/components/orquestracao/personas-carteira';
import { ReguaTopo } from '@/components/orquestracao/regua-topo';
import type { PersonaUsuario } from '@/lib/supabase';

test('situação da régua igual ao motor: sem "passos" = padrão; "passos" vazio = ninguém recebe; desligado', () => {
	const def = {
		localizacao: { ativo: true },
		cpc: { ativo: true },
		giro: { ativo: true, passos: {} },
		preventivo: { ativo: false, passos: { 1: [{ canal: 'sms', modo: 'sempre' }] } },
		quebra: { passos: { 1: [{ canal: 'sms', modo: 'sempre' }] } },
	} as unknown as Definicao;
	assert.equal(situacaoReguaFase(def, 'localizacao'), 'padrao');
	assert.equal(situacaoReguaFase(def, 'cpc'), 'padrao');
	assert.equal(situacaoReguaFase(def, 'giro'), 'vazia');
	assert.equal(situacaoReguaFase(def, 'preventivo'), 'desligado');
	assert.equal(situacaoReguaFase(def, 'quebra'), 'propria');
	assert.equal(situacaoReguaFase({ cpc: { ordem: [{ canal: 'whatsapp' }], junto: [] } } as unknown as Definicao, 'cpc'), 'propria');
});

test('estágios da estratégia: nomes, ordem e etapas iguais ao passo Estágios', () => {
	const def: Definicao = {
		...modeloClassicos(),
		rotulos_fases: { localizacao: 'Novos da semana' },
		etapas: [{ id: 'ticket-alto', nome: 'Ticket alto', ativo: true, condicoes: [{ campo: 'saldo', op: '>', valor: 5000 }], de: 1, ate: 30 }],
		ordem_etapas: ['ticket-alto', 'quebra', 'preventivo', 'cpc', 'giro', 'localizacao'],
	};
	const e = estagiosDaEstrategia(def);
	assert.deepEqual(e.map(x => x.nome), ['Ticket alto', 'Acordo atrasado', 'Acordo em dia', 'Contatado (CPC)', 'Sem contato após as tentativas', 'Novos da semana']);
	assert.equal(e[0].tipo, 'etapa');
	assert.equal(e[0].regua, 'vazia');
	assert.match(e[0].texto, /o motor ignora/);
	assert.ok(e.slice(1).every(x => x.regua === 'padrao'));
	// a barra do passo Régua mostra os MESMOS estágios (nada de "Cliente novo · Deu CPC · Não CPC · Acordo")
	const html = renderToStaticMarkup(<ReguaTopo def={def} selecionado="cpc" onEscolher={() => {}} onEditar={() => {}} />);
	for (const n of ['Ticket alto', 'Acordo atrasado', 'Acordo em dia', 'Contatado (CPC)', 'Novos da semana']) assert.ok(html.includes(n), n);
	assert.ok(!html.includes('Deu CPC'));
	assert.ok(html.includes('segue a ordem padrão do motor'));
});

test('avisos de "sem estágio": um só quando nada está ligado, lista curta quando são muitos, detalhe quando poucos', () => {
	const vazia = definicaoVazia();
	const todas = ['quebra', 'preventivo', 'cpc', 'giro', 'localizacao'] as const;
	assert.equal(algumEstagioLigado(vazia), false);
	const um = avisoSemEstagio(vazia, [...todas], 10000);
	assert.equal(um.tipo, 'nenhum');
	assert.equal(um.tipo === 'nenhum' && um.texto, 'Nenhum estágio ligado: os 10.000 clientes deste segmento ficam sem estágio. Ligue pelo menos um.');
	const semNumero = avisoSemEstagio(vazia, [...todas], null);
	assert.ok(semNumero.tipo === 'nenhum' && semNumero.texto.includes('os clientes deste segmento'));
	const tres = { ...vazia, cpc: { ativo: true } } as unknown as Definicao;
	const v = avisoSemEstagio(tres, ['quebra', 'preventivo', 'giro'], 5);
	assert.equal(v.tipo, 'varias');
	const poucos = avisoSemEstagio(modeloClassicos(), ['giro'], 5);
	assert.deepEqual(poucos, { tipo: 'detalhe', itens: ['Quem está em Sem contato após as tentativas fica sem estágio.'] });
	assert.deepEqual(avisoSemEstagio(modeloClassicos(), [], 5), { tipo: 'ok' });
});

test('nome da estratégia de um modelo: "<Modelo> · <Segmento>", sem cortar no meio', () => {
	assert.equal(nomeEstrategiaModelo('Estágios clássicos', 'teste'), 'Estágios clássicos · teste');
	assert.equal(nomeEstrategiaModelo('  Só digital ', ''), 'Só digital');
	const longo = nomeEstrategiaModelo('Estágios clássicos', 'Clientes com ticket muito alto e atraso acima de cento e oitenta dias');
	assert.ok(longo.length <= 80, longo);
	assert.ok(longo.endsWith('…'));
	assert.ok(!/princip…/.test(longo));
});

test('salvar não apaga a régua padrão: fase sem "passos" continua sem (o motor segue o padrão)', () => {
	const def = modeloClassicos();
	const salvo = removerMensagensCanaisSemMensagem(normalizarDefinicao(limparPersonas(def, new Set()), []));
	for (const f of ['localizacao', 'giro', 'preventivo', 'quebra'] as const) {
		assert.ok(!('passos' in (salvo[f] as object)), f);
		assert.equal(situacaoReguaFase(salvo, f), 'padrao');
	}
});

test('começar da régua padrão: a fase passa a ter os dias do padrão (régua própria, editável)', () => {
	const d = copiarReguaPadrao(modeloClassicos(), 'localizacao');
	assert.deepEqual(Object.keys(d.localizacao!.passos), Object.keys(playbookDefinicao().localizacao!.passos));
	assert.equal(situacaoReguaFase(d, 'localizacao'), 'propria');
	assert.equal(situacaoReguaFase(copiarReguaPadrao(modeloClassicos(), 'cpc'), 'cpc'), 'propria');
});

test('montar pelas personas: por estágio, só com dias, marcadas = quem já tem raia', () => {
	const p = (id: string, nome: string) => ({ id, nome, cor: '#000', descricao: '' }) as unknown as PersonaUsuario;
	const personas = [p('1', 'Digital nativo'), p('2', 'Conectado')];
	const modelos = { 'Digital nativo': ['whatsapp', 'sms'], Conectado: ['email'] };
	const def = { ...modeloClassicos(), giro: { ativo: true, passos: { 1: [{ canal: 'sms', modo: 'sempre' }, { canal: 'whatsapp', modo: 'sempre', personas: ['2'] }], 3: [{ canal: 'sms', modo: 'sempre' }] } } } as unknown as Definicao;
	assert.ok(!estagiosParaPersonas(def).some(e => e.id === 'cpc'));
	assert.deepEqual(diasComAcao(passosDoEstagio(def, 'localizacao')), []);          // sem dias: nada de personas
	assert.deepEqual(diasComAcao(passosDoEstagio(def, 'giro')), [1, 3]);
	assert.deepEqual([...personasComRaia(passosDoEstagio(def, 'giro'))], ['2']);    // Não CPC: só quem já tem raia
	assert.deepEqual([...personasComRaia(passosDoEstagio(def, 'localizacao'))], []);
	const novos = montarRaias(passosDoEstagio(def, 'giro')!, [personas[0]], [1, 3], modelos);
	assert.deepEqual(novos['1'].map(a => `${a.canal}:${(a.personas ?? []).join()}`), ['sms:', 'whatsapp:2', 'whatsapp:1']);
	assert.deepEqual(novos['3'].map(a => `${a.canal}:${(a.personas ?? []).join()}`), ['sms:', 'sms:1']);
});
