// PR7 do redesenho: caminho da versão (4 fases, uma ação principal), checklist "Antes de aprovar", "o que muda" em
// palavras e as abas Versões e aprovação, Testes e Respostas prontas. Renderizados com react-dom/server, sem banco.
// npm test (site/scripts/testar-componentes.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { TIPOS, type Definicao } from '@/lib/fluxo';
import { acaoDaFase, antesDeAprovar, diferencas, faseVersao, resumoDiferencas } from '@/lib/fluxo-versao';
import { AbaVersoes, AcaoPrincipal, CaminhoVersao, ChecklistAprovar, ListaDiferencas, type PropsAbaVersoes } from '@/components/fluxo/versao';
import { AbaRespostas, AbaTestes } from '@/components/fluxo/abas-editor';
import { criarApiFixturas, definicaoV4, definicaoV5 } from '@/components/fluxo/fixturas';
import { ProvedorFixturas, type CtxFluxo } from '@/components/fluxo/contexto';
import type { RespostaRow, VersaoRow } from '@/components/fluxo/api';

const nada = () => {};
const botao = (html: string, nome: string) => html.match(new RegExp(`<button[^>]*>${nome}</button>`))?.[0] ?? '';
const agora = '2026-10-31T13:00:00Z';
const versao = (id: number, n: number, situacao: VersaoRow['situacao'], definicao: Definicao, extra: Partial<VersaoRow> = {}): VersaoRow => ({
	id, fluxo_id: 1, empresa_id: 1, credor_id: 11, versao: n, situacao, definicao, motivo: null, parecer: null, criado_em: agora, atualizado_em: agora,
	aprovado_em: situacao === 'rascunho' ? null : agora, em_uso_em: situacao === 'em_uso' ? '2026-10-22T12:00:00Z' : null, arquivado_em: situacao === 'arquivado' ? '2026-10-21T12:00:00Z' : null, enviado_aprovacao_em: null, ...extra,
});

test('fases: Rascunho (desenho com pendência) → Testes → Aprovação (enviada ou aprovada) → Em uso; arquivada fica fora', () => {
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: ['sem_saida:N9'] }), 0);
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: ['sem_alcada'] }), 0);
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: [] }), 1);
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: ['caso_falhou:31'] }), 1);          // caso falhou: Testes
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: ['roleplay_ausente'] }), 1);        // aviso não segura
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: [], enviadoEm: agora }), 2);
	assert.equal(faseVersao({ situacao: 'rascunho', bloqueios: ['caso_falhou:31'], enviadoEm: agora }), 1);
	assert.equal(faseVersao({ situacao: 'aprovado_empresa', bloqueios: [] }), 2);
	assert.equal(faseVersao({ situacao: 'em_uso', bloqueios: [] }), 3);
	assert.equal(faseVersao({ situacao: 'arquivado', bloqueios: [] }), null);
});

test('ação principal: uma por fase, com as permissões de sempre', () => {
	const a = (x: Partial<Parameters<typeof acaoDaFase>[0]>) => acaoDaFase({ situacao: 'rascunho', bloqueios: [], podeEditar: true, podeAprovar: false, versao: 5, ...x });
	assert.equal(a({ bloqueios: ['sem_saida:N9'] }).rotulo, 'Corrigir 1 ponto');
	assert.equal(a({ bloqueios: ['sem_saida:N9'], podeEditar: false, podeAprovar: true }).tipo, 'nenhuma');   // quem aprova não corrige nem passa por cima
	assert.equal(a({ bloqueios: ['caso_falhou:31'] }).rotulo, 'Ver os testes');
	assert.equal(a({ casos: { passaram: 3, total: 3 } }).rotulo, 'Enviar para aprovação');
	assert.match(a({ casos: { passaram: 3, total: 3 } }).nota, /3 de 3 casos de teste passaram/);
	assert.equal(a({ podeEditar: true, podeAprovar: true }).tipo, 'enviar');                        // quem tem as duas: enviar é a principal
	assert.equal(a({ podeEditar: false, podeAprovar: true }).rotulo, 'Revisar e aprovar');
	assert.equal(a({ enviadoEm: agora, podeAprovar: true }).rotulo, 'Revisar e aprovar');
	assert.equal(a({ enviadoEm: agora }).tipo, 'nenhuma');                                           // quem só edita espera
	assert.equal(a({ situacao: 'aprovado_empresa', podeAprovar: true }).rotulo, 'Colocar em uso');
	assert.equal(a({ situacao: 'aprovado_empresa' }).tipo, 'nenhuma');
	assert.equal(a({ situacao: 'em_uso', podeAprovar: true }).tipo, 'nenhuma');
	const html = renderToStaticMarkup(<AcaoPrincipal acao={a({ enviadoEm: agora })} onAcao={nada} />);
	assert.doesNotMatch(html, /<button/);
	assert.match(html, /Aguardando quem tem Aprovar roteiro de voz/);
});

test('caminho da versão: 4 fases, a atual marcada e o que falta em cada uma', () => {
	const r = { versao: 5, desenho: 2, casos: { passaram: 7, total: 8, falharam: 1 }, avisosPersonas: 1, enviadoEm: null, aprovadoEm: null, situacao: 'rascunho' as const, emUso: { versao: 4, desde: '2026-10-22T12:00:00Z' } };
	const html = renderToStaticMarkup(<CaminhoVersao fase={0} r={r} />);
	for (const f of ['Rascunho', 'Testes', 'Aprovação', 'Em uso']) assert.match(html, new RegExp(`>${f}<`));
	assert.match(html, /data-fase="0"[^>]*aria-current="step"|aria-current="step"[^>]*data-fase="0"/);
	assert.match(html, /2 pontos a corrigir/);
	assert.match(html, /7 de 8 casos passaram/);
	assert.match(html, /personas: 1 aviso/);
	assert.match(html, /ainda não enviada/);
	assert.match(html, /hoje: v4 em uso desde 22\/10/);
});

test('antes de aprovar: desenho, 7 travas, casos, personas (aviso), respostas sem revisão (aviso) e alçada', () => {
	const itens = antesDeAprovar({
		bloqueios: ['sem_saida:N9', 'sem_alcada', 'caso_falhou:31'], avisos: ['roleplay_reprovadas:3'],
		casos: [{ id: 31, passou: false }, { id: 32, passou: true }], respostas: [{ revisado_em: agora }, { revisado_em: null }], alcada: null,
	});
	const por = Object.fromEntries(itens.map(i => [i.id, i]));
	assert.deepEqual(itens.map(i => i.id), ['desenho', 'travas', 'casos', 'personas', 'respostas', 'alcada']);
	assert.equal(por.desenho.estado, 'erro'); assert.match(por.desenho.texto, /1 ponto a corrigir/);
	assert.equal(por.travas.estado, 'ok'); assert.match(por.travas.texto, /^7 travas fixas/);
	assert.equal(por.casos.estado, 'erro'); assert.match(por.casos.texto, /1 de 2 falhou/);
	assert.equal(por.personas.estado, 'aviso'); assert.equal(por.personas.impede, false);
	assert.equal(por.respostas.estado, 'aviso'); assert.match(por.respostas.texto, /1 sem revisão/);
	assert.equal(por.alcada.estado, 'erro'); assert.match(por.alcada.texto, /não cadastrada/);
	const ok = antesDeAprovar({ bloqueios: [], avisos: [], casos: [{ id: 31, passou: true }], respostas: [], alcada: { desconto_max_pct: 40, parcelas_max: 12 } });
	assert.ok(ok.every(i => i.estado === 'ok'), JSON.stringify(ok));
	assert.match(ok.find(i => i.id === 'alcada')!.texto, /até 40% de desconto e 12 parcelas/);
	const html = renderToStaticMarkup(<ChecklistAprovar itens={itens} onIr={nada} />);
	assert.match(html, /data-check="casos" data-estado="erro"/);
	assert.match(html, />ver nos testes</);
});

test('o que muda da v4 (em uso) para a v5: resposta que perdeu o destino e conector novo, em palavras', () => {
	const conectores = [{ id: 3, nome: 'Registrar acordo' }, { id: 4, nome: 'Gerar boleto ou link' }];
	const d = diferencas(definicaoV4(), definicaoV5(), { conectores });
	assert.deepEqual(d.map(x => [x.tipo, x.id]).sort(), [['alterada', 'N7'], ['alterada', 'N9']]);
	const n7 = d.find(x => x.id === 'N7')!;
	assert.deepEqual(n7.detalhes, ['Conectores: Registrar acordo, Gerar boleto ou link (antes: Registrar acordo).']);
	const n9 = d.find(x => x.id === 'N9')!;
	assert.ok(n9.detalhes.includes('Saiu a resposta "Agendou" (ia para Encerrar · retorno).'), n9.detalhes.join(' | '));
	assert.equal(resumoDiferencas(d), '2 alteradas.');
	assert.deepEqual(diferencas(definicaoV4(), definicaoV4()), []);
	assert.equal(resumoDiferencas([]), 'Nenhuma diferença no desenho.');
});

test('o que muda: etapa nova, removida, fala antes → depois e destino trocado', () => {
	const v4 = definicaoV4();
	const v5: Definicao = { esquema: 1, blocos: [
		...v4.blocos.filter(b => b.id !== 'N16').map(b => b.id === 'N1' ? { ...b, params: { ...b.params, fala: 'Olá! Falo com {{primeiro_nome}}?' } }
			: b.id === 'N8' ? { ...b, saidas: b.saidas.map(s => s.quando === 'informou_data' ? { ...s, para: 'N13' } : s) } : b),
		{ id: 'N20', tipo: 'pergunta', modo: 'arvore', titulo: 'Repetir o acordo', params: { ...TIPOS.pergunta.params(), fala: 'Posso confirmar o acordo?' }, saidas: [] },
	] };
	const d = diferencas(v4, v5);
	const por = new Map(d.map(x => [x.id, x]));
	assert.equal(por.get('N20')?.tipo, 'nova');
	assert.ok(por.get('N20')!.detalhes.includes('Diz: "Posso confirmar o acordo?"'));
	assert.equal(por.get('N16')?.tipo, 'removida');
	assert.equal(d[d.length - 1].tipo, 'removida');                       // removidas no fim
	assert.ok(por.get('N1')!.detalhes.some(t => t.startsWith('Fala: "Olá! Falo com {{primeiro_nome}}?" (antes: "Olá, aqui é a central')), por.get('N1')!.detalhes.join(' | '));
	assert.ok(por.get('N8')!.detalhes.some(t => /agora vai para Transferir · atendente \(antes: Encerrar · alega pagamento\)/.test(t)), por.get('N8')!.detalhes.join(' | '));
	const html = renderToStaticMarkup(<ListaDiferencas itens={d} onAbrirEtapa={nada} />);
	assert.match(html, /Nova etapa &quot;Repetir o acordo&quot;/);
	assert.match(html, /Saiu a etapa &quot;Encerrar · alega pagamento&quot;/);
});

function propsVersoes(x: Partial<PropsAbaVersoes> = {}): PropsAbaVersoes {
	const v5 = versao(105, 5, 'rascunho', definicaoV5());
	const versoes = [v5, versao(104, 4, 'em_uso', definicaoV4()), versao(103, 3, 'arquivado', definicaoV4())];
	return {
		v: v5, versoes, checklist: antesDeAprovar({ bloqueios: [], avisos: [], casos: [], respostas: [], alcada: null }), conectores: [],
		podeEditar: true, podeAprovar: true, ocupado: false, impede: 0, comparar: null, onComparar: nada,
		onAprovar: nada, onEnviar: nada, onUsar: nada, onAbrir: nada, onVoltar: async () => true, onIr: nada, onAbrirEtapa: nada, ...x,
	};
}

test('aba Versões e aprovação: checklist, parecer e Aprovar só para quem aprova; Aprovar travado com pendência', () => {
	const html = renderToStaticMarkup(<AbaVersoes {...propsVersoes()} />);
	assert.match(html, /Antes de aprovar a v5/);
	assert.match(html, /Parecer de quem aprova \(opcional\)/);
	assert.doesNotMatch(botao(html, 'Aprovar'), /disabled=""/);
	assert.match(html, /O que muda da v4 \(em uso\) para a v5/);
	assert.match(html, />Voltar para esta</);                              // v3 arquivada, quem aprova
	assert.match(html, />Comparar</);
	const travado = renderToStaticMarkup(<AbaVersoes {...propsVersoes({ impede: 2 })} />);
	assert.match(botao(travado, 'Aprovar'), /disabled=""/);
	assert.match(travado, /2 pendências impedem a aprovação\./);
	const soEdita = renderToStaticMarkup(<AbaVersoes {...propsVersoes({ podeAprovar: false })} />);
	assert.doesNotMatch(soEdita, />Aprovar</);
	assert.doesNotMatch(soEdita, /Parecer de quem aprova/);
	assert.doesNotMatch(soEdita, />Voltar para esta</);
	assert.ok(botao(soEdita, 'Enviar para aprovação'));
});

test('aba Versões e aprovação: comparar com outra versão mostra "← Comparação com a v4 (em uso)"', () => {
	const html = renderToStaticMarkup(<AbaVersoes {...propsVersoes({ comparar: 103 })} />);
	assert.match(html, /O que muda da v3 para a v5/);
	assert.match(html, /aria-label="Voltar para Comparação com a v4 \(em uso\)"/);
	const primeira = renderToStaticMarkup(<AbaVersoes {...propsVersoes({ versoes: [versao(105, 1, 'rascunho', definicaoV5())], v: versao(105, 1, 'rascunho', definicaoV5()) })} />);
	assert.match(primeira, /É a primeira versão deste fluxo/);
});

const ctx = (permissoes: string[]): CtxFluxo => ({
	empresa: { id: 1, slug: 'aurora', nome: 'Aurora (teste)' }, credor: null, credores: [], permissoes, equipe: false, equipeMonta: false,
	api: criarApiFixturas(), demo: true, rota: () => '/',
});

test('aba Respostas prontas: fila de revisão; só quem aprova vê "Revisar e aprovar"', () => {
	const respostas: RespostaRow[] = [
		{ id: 1, fluxo_versao_id: 105, bloco_id: 'N5', pergunta: 'Isso suja meu nome?', resposta: 'Com o acordo em dia, sai em até 5 dias úteis.', revisado_em: agora },
		{ id: 2, fluxo_versao_id: 105, bloco_id: 'N5', pergunta: 'Posso pagar no cartão?', resposta: 'O pagamento é pelo link.', revisado_em: null },
	];
	const r = (podeAprovar: boolean) => renderToStaticMarkup(<ProvedorFixturas valor={ctx([])}><AbaRespostas respostas={respostas} definicao={definicaoV5()} podeAprovar={podeAprovar} onAbrirEtapa={nada} onMudou={nada} /></ProvedorFixturas>);
	const aprova = r(true);
	assert.match(aprova, /Para revisar \(1\)/);
	assert.match(aprova, /Posso pagar no cartão\?/);
	assert.doesNotMatch(aprova, /Isso suja meu nome\?/);                 // a fila mostra só o que falta revisar
	assert.ok(botao(aprova, 'Revisar e aprovar'));
	const edita = r(false);
	assert.doesNotMatch(edita, /Revisar e aprovar/);
	assert.match(edita, /Quem tem Aprovar roteiro de voz revisa aqui/);
});

test('aba Testes: caso que falhou diz onde parou e leva à etapa; Rodar todos só para quem edita', () => {
	const casos = [{ id: 31, fluxo_id: 1, nome: 'Sem dinheiro: agenda retorno', falas: ['Sou eu'], caminho_esperado: [], resultado_esperado: 'retorno_agendado', conectores_falham: [], ativo: true }];
	const resultados = [{ caso_id: 31, fluxo_versao_id: 105, passou: false, caminho_obtido: ['N1', 'N2', 'N3', 'N9'], resultado_obtido: null, executado_em: agora }];
	const r = (podeEditar: boolean) => renderToStaticMarkup(<MemoryRouter><ProvedorFixturas valor={ctx([])}>
		<AbaTestes versao={{ id: 105, versao: 5 }} definicao={definicaoV5()} casos={casos} resultados={resultados} falharam={1} avisos={[]} podeEditar={podeEditar} emUso={{ id: 104, versao: 4 }} onMudou={nada} onAbrirEtapa={nada} />
	</ProvedorFixturas></MemoryRouter>);
	const html = r(true);
	assert.match(html, /0 de 1 passaram nesta versão · 1 falhou/);
	assert.match(html, /Parou em “Agendar retorno”; esperado: retorno agendado/);
	assert.match(html, />Abrir a etapa</);
	assert.match(html, /Rodar todos/);
	assert.doesNotMatch(r(false), /Rodar todos/);
});
