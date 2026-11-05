// Componentes do Fluxo do agente renderizados de verdade (react-dom/server), sem banco: o editor não deixa enviar para
// aprovação com pendência de validação, o quadro por ramos mostra "→ N5"/"↪ N13" e marca a etapa que impede.
// npm test (site/scripts/testar-componentes.mjs empacota com esbuild e roda com node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { estadoEnvio, resumoPendencias, validarLocal, type Definicao } from '@/lib/fluxo';
import { BarraEnvio, Quadro, type Marca } from '@/components/fluxo/quadro';
import { criarApiFixturas, definicaoV5 } from '@/components/fluxo/fixturas';
import { MemoryRouter } from 'react-router';
import { PERMISSAO_EQUIPE_FLUXO, ProvedorFixturas, permissoesFluxo, type CtxFluxo } from '@/components/fluxo/contexto';
import { ListaFluxos } from '@/components/fluxo/lista';

const nada = () => {};
const botao = (html: string, nome: string) => html.match(new RegExp(`<button[^>]*>${nome}</button>`))?.[0] ?? '';

test('editor: com pendência de validação, "Enviar para aprovação" fica desabilitado e diz o motivo', async () => {
	const api = criarApiFixturas();
	const erros = await api.bloqueios(105);                      // v5 do desenho: N9 sem saída, N17 inalcançável, C4 e alçada
	assert.ok(erros.includes('sem_saida:N9') && erros.includes('inalcancavel:N17') && erros.includes('conector_inativo:N7') && erros.includes('sem_alcada'), erros.join(','));
	const estado = estadoEnvio({ situacao: 'rascunho', erros, sujo: false, podeEditar: true });
	const html = renderToStaticMarkup(<BarraEnvio situacao="rascunho" estado={estado} podeEditar podeAprovar onEnviar={nada} onAprovar={nada} onUsar={nada} />);
	const enviar = botao(html, 'Enviar para aprovação');
	assert.ok(enviar, html);
	assert.match(enviar, /disabled=""/);
	assert.match(enviar, /aria-describedby="motivo-envio"/);
	assert.match(html, /id="motivo-envio"[^>]*>\d+ pendências impedem o envio\.</);
	assert.match(botao(html, 'Aprovar'), /disabled=""/);         // quem aprova também não passa por cima
	assert.equal(resumoPendencias(erros.filter(e => !e.startsWith('roleplay'))), 'Uma etapa sem saída, uma etapa inalcançável, um conector sem configurar e uma carteira sem alçada.');
});

test('editor: sem pendência (só aviso de roleplay), envia', () => {
	const estado = estadoEnvio({ situacao: 'rascunho', erros: ['roleplay_ausente'], sujo: false, podeEditar: true });
	const html = renderToStaticMarkup(<BarraEnvio situacao="rascunho" estado={estado} podeEditar podeAprovar={false} onEnviar={nada} onAprovar={nada} onUsar={nada} />);
	assert.doesNotMatch(botao(html, 'Enviar para aprovação'), /disabled=""/);
	assert.doesNotMatch(html, />Aprovar</);                      // sem a permissão, nem aparece
});

test('editor: quem só edita não vê "Colocar em uso"; quem aprova vê', () => {
	const ok = { ok: false, motivo: '' };
	assert.doesNotMatch(renderToStaticMarkup(<BarraEnvio situacao="aprovado_empresa" estado={ok} podeEditar podeAprovar={false} onEnviar={nada} onAprovar={nada} onUsar={nada} />), /Colocar em uso<\/button>/);
	assert.match(renderToStaticMarkup(<BarraEnvio situacao="aprovado_empresa" estado={ok} podeEditar={false} podeAprovar onEnviar={nada} onAprovar={nada} onUsar={nada} />), /Colocar em uso<\/button>/);
});

test('quadro por ramos: caminho principal, ramos, saídas "→ N" e "↪ N" e a etapa que impede', () => {
	const d: Definicao = definicaoV5();
	const marcas = new Map<string, Marca>(validarLocal(d).map(e => [e.split(':')[1], 'erro'] as [string, Marca]).filter(([id]) => !!id));
	const html = renderToStaticMarkup(<Quadro definicao={d} marcas={marcas} vista="quadro" onAbrir={nada} />);
	assert.match(html, /aria-label="Caminho principal"/);
	assert.match(html, /aria-label="Já paguei"/);
	assert.match(html, /aria-label="Finais compartilhados"/);
	assert.match(html, /aria-label="Sem ligação"/);              // N17: nenhum caminho chega
	assert.match(html, /Sou eu <b[^>]*>→ N2<\/b>/);
	assert.match(html, /Não entendi 2× <b[^>]*>↪ N13<\/b>/);
	assert.match(html, /data-etapa="N9"[^>]*style="[^"]*var\(--estado-erro\)/);
	assert.match(html, /N9 · Agendar retorno<\/b><span[^>]*>impede</);
	const lista = renderToStaticMarkup(<Quadro definicao={d} marcas={marcas} vista="lista" onAbrir={nada} />);
	assert.match(lista, /<details open=""/);                     // no celular/lista: o caminho principal vem aberto
});

// SQL 68 · a equipe MotorCX monta o fluxo do cliente (cria, edita, duplica, testa e envia), mas não aprova nem coloca em uso
test('permissões: equipe com responder_chamados edita e envia; nunca aprova, coloca em uso nem mexe na alçada', () => {
	assert.equal(PERMISSAO_EQUIPE_FLUXO, 'responder_chamados');
	assert.deepEqual(permissoesFluxo({ permissoes: [], equipe: true, equipeMonta: true }), { editar: true, aprovar: false, alcada: false, ver: true });
	// mesmo que a lista de permissões do cliente venha cheia (o Master tem todas), a equipe não aprova
	assert.deepEqual(permissoesFluxo({ permissoes: ['editar_canais', 'aprovar_roteiro_voz', 'editar_credores'], equipe: true, equipeMonta: true }),
		{ editar: true, aprovar: false, alcada: false, ver: true });
	assert.deepEqual(permissoesFluxo({ permissoes: ['editar_canais'], equipe: true, equipeMonta: false }), { editar: false, aprovar: false, alcada: false, ver: true });
});

test('permissões: o cliente continua igual (editar_canais edita; aprovar_roteiro_voz aprova; editar_credores, a alçada)', () => {
	assert.deepEqual(permissoesFluxo({ permissoes: ['editar_canais'], equipe: false, equipeMonta: false }), { editar: true, aprovar: false, alcada: false, ver: true });
	assert.deepEqual(permissoesFluxo({ permissoes: ['aprovar_roteiro_voz', 'editar_credores'], equipe: false, equipeMonta: true }), { editar: false, aprovar: true, alcada: true, ver: true });
	assert.deepEqual(permissoesFluxo({ permissoes: [], equipe: false, equipeMonta: true }), { editar: false, aprovar: false, alcada: false, ver: false });
});

test('editor da equipe: envia para aprovação, mas não vê Aprovar nem Colocar em uso', () => {
	const p = permissoesFluxo({ permissoes: [], equipe: true, equipeMonta: true });
	const estado = estadoEnvio({ situacao: 'rascunho', erros: [], sujo: false, podeEditar: p.editar });
	const html = renderToStaticMarkup(<BarraEnvio situacao="rascunho" estado={estado} podeEditar={p.editar} podeAprovar={p.aprovar} onEnviar={nada} onAprovar={nada} onUsar={nada} />);
	assert.ok(botao(html, 'Enviar para aprovação'), html);
	assert.doesNotMatch(botao(html, 'Enviar para aprovação'), /disabled=""/);
	assert.doesNotMatch(html, />Aprovar</);
	const aprovado = renderToStaticMarkup(<BarraEnvio situacao="aprovado_empresa" estado={{ ok: false, motivo: '' }} podeEditar={p.editar} podeAprovar={p.aprovar} onEnviar={nada} onAprovar={nada} onUsar={nada} />);
	assert.doesNotMatch(aprovado, /Colocar em uso<\/button>/);
});

const ctxEquipe = (equipeMonta: boolean): CtxFluxo => ({
	empresa: { id: 1, slug: 'aurora', nome: 'Aurora (teste)' }, credor: null, credores: [], permissoes: [], equipe: true, equipeMonta,
	api: criarApiFixturas(), demo: true, rota: () => '/',
});

test('lista: a equipe com a permissão vê "Novo fluxo"; sem ela, não', () => {
	const lista = (c: CtxFluxo) => renderToStaticMarkup(<MemoryRouter><ProvedorFixturas valor={c}><ListaFluxos /></ProvedorFixturas></MemoryRouter>);
	assert.match(lista(ctxEquipe(true)), /Novo fluxo<\/button>/);
	assert.doesNotMatch(lista(ctxEquipe(false)), /Novo fluxo<\/button>/);
});
