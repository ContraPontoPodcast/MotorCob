// Componentes do Fluxo do agente renderizados de verdade (react-dom/server), sem banco: o editor não deixa enviar para
// aprovação com pendência de validação, o quadro por ramos mostra "→ N5"/"↪ N13" e marca a etapa que impede.
// npm test (site/scripts/testar-componentes.mjs empacota com esbuild e roda com node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { estadoEnvio, resumoPendencias, validarLocal, type Definicao } from '@/lib/fluxo';
import { BarraEnvio, Quadro, type Marca } from '@/components/fluxo/quadro';
import { criarApiFixturas, definicaoV5 } from '@/components/fluxo/fixturas';

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
