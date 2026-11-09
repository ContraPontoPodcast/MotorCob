// Componentes do Fluxo do agente renderizados de verdade (react-dom/server), sem banco: o editor não deixa enviar para
// aprovação com pendência de validação, o quadro por ramos mostra as setas com o nome da etapa e marca a que impede,
// as 7 travas ficam à vista, o "O que corrigir" diz o quê e como, e o Roteiro (vista principal) lê como a conversa.
// npm test (site/scripts/testar-componentes.mjs empacota com esbuild e roda com node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { SEMPRE, TRAVAS, correcaoDe, estadoEnvio, explicar, resumoPendencias, trocarBloco, validarLocal, type Definicao, type Pendencia } from '@/lib/fluxo';
import { AntesDepois, OQueCorrigir as OQueCorrigirComBotao } from '@/components/fluxo/corrigir';
import { EmQualquerMomento, FaixaTravas } from '@/components/fluxo/travas';
import { OQueCorrigir, textoCredorAntes } from '@/components/fluxo/etapa';
import { BarraEnvio, Quadro, type Marca } from '@/components/fluxo/quadro';
import { Roteiro } from '@/components/fluxo/roteiro';
import { ABAS_EDITOR, AbasEditor, abaDaUrl } from '@/components/fluxo/abas-editor';
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

test('mapa (quadro por ramos): caminho principal, ramos, setas com o nome da etapa e a etapa que impede', () => {
	const d: Definicao = definicaoV5();
	const marcas = new Map<string, Marca>(validarLocal(d).map(e => [e.split(':')[1], 'erro'] as [string, Marca]).filter(([id]) => !!id));
	const html = renderToStaticMarkup(<Quadro definicao={d} marcas={marcas} onAbrir={nada} />);
	assert.match(html, /aria-label="Caminho principal"/);
	assert.match(html, /aria-label="Já paguei"/);
	assert.match(html, /aria-label="Finais compartilhados"/);
	assert.match(html, /aria-label="Sem ligação"/);              // N17: nenhum caminho chega
	// U1: nada de "→ N2" nem "↪ N13"; a seta diz o nome
	assert.match(html, /Sou eu <span aria-hidden="true">→<\/span><span class="sr-only">, então<\/span> <b[^>]*>Confirmar identidade<\/b>/);
	assert.match(html, /Não entendi 2× <span aria-hidden="true">→<\/span><span class="sr-only">, então<\/span> <b[^>]*>Transferir · atendente<\/b>/);
	assert.doesNotMatch(html, /[→↪]\s*(<[^>]+>\s*)*N\d/);
	assert.doesNotMatch(html, /↪/);
	assert.match(html, /Se disser &quot;Já paguei&quot;<span[^>]*> · em Entender intenção<\/span>/);
	// U3: N9 sem saída não aparece como "fim"; os finais dizem "Fim da ligação"
	assert.match(html, /data-etapa="N9"[^>]*style="[^"]*var\(--estado-erro\)/);
	assert.match(html, />Agendar retorno<\/b><span[^>]*>impede</);
	const n9 = html.slice(html.indexOf('data-etapa="N9"'), html.indexOf('</button>', html.indexOf('data-etapa="N9"')));
	assert.match(n9, /Nenhuma resposta ligada/);
	assert.doesNotMatch(n9, />fim</);
	assert.match(html, /Fim da ligação/);
	// U6: cadeado na Abertura, não na conversa livre (IA)
	const cartao = (id: string) => html.slice(html.indexOf(`data-etapa="${id}"`), html.indexOf('</button>', html.indexOf(`data-etapa="${id}"`)));
	assert.match(cartao('N1'), /Etapa com trava fixa/);
	assert.doesNotMatch(cartao('N5'), /Etapa com trava fixa/);
});

test('travas: as 7 sempre à vista, numeradas, recolhíveis e sem botão de remover; e "Em qualquer momento da ligação"', () => {
	const html = renderToStaticMarkup(<FaixaTravas />);
	assert.match(html, /aria-label="Travas fixas"/);
	assert.match(html, /7 travas fixas · valem em toda a ligação/);
	assert.equal((html.match(/<li /g) ?? []).length, 7);
	TRAVAS.forEach(([t], i) => assert.ok(html.includes(`${i + 1}. ${t.replace(/"/g, '&quot;')}`), t));
	assert.match(html, /aria-expanded="true"[^>]*>Recolher</);
	assert.doesNotMatch(html, /Remover|remover/);
	assert.match(renderToStaticMarkup(<FaixaTravas recolhidaInicial />), /<ol[^>]*hidden=""/);
	const sempre = renderToStaticMarkup(<EmQualquerMomento />);
	assert.match(sempre, /Em qualquer momento da ligação/);
	assert.equal((sempre.match(/<li /g) ?? []).length, SEMPRE.length);
	assert.match(sempre, /Ainda sem tratamento próprio: tema sensível/);
});

test('o que corrigir na etapa: credor na abertura aparece ao digitar, com o motivo e como corrigir', () => {
	const d = definicaoV5();
	const n1 = d.blocos.find(b => b.id === 'N1')!;
	const digitado = { ...n1, params: { ...n1.params, fala: 'Olá, aqui é a {{assessoria}}, em nome de {{credor}}. Falo com {{primeiro_nome}}?' } };
	assert.ok(!validarLocal(d).includes('valor_antes_identidade:N1'));
	assert.ok(validarLocal(trocarBloco(d, digitado)).includes('valor_antes_identidade:N1'));
	assert.equal(textoCredorAntes(digitado), 'Esta fala cita {{credor}} antes de confirmar a identidade, em algum caminho.');
	const html = renderToStaticMarkup(<OQueCorrigir impede texto={textoCredorAntes(digitado)} como="Tire o credor desta fala." />);
	assert.match(html, /role="alert"/);
	assert.match(html, /O que corrigir:/);
	assert.match(html, /impede o envio/);
	assert.match(html, /Tire o credor desta fala\./);
	const aviso = renderToStaticMarkup(<OQueCorrigir impede={false} texto="Sem personas." />);
	assert.match(aviso, /role="status"/);
	assert.doesNotMatch(aviso, /impede o envio/);
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

test('roteiro: capítulos na ordem da conversa, ramos com nome, "o agente diz / pode responder → então", sem códigos', () => {
	const d: Definicao = definicaoV5();
	const marcas = new Map<string, Marca>(validarLocal(d).map(e => [e.split(':')[1], 'erro'] as [string, Marca]).filter(([id]) => !!id));
	const html = renderToStaticMarkup(<Roteiro definicao={d} marcas={marcas} onAbrir={nada} />);
	const caps = [...html.matchAll(/<section aria-label="([^"]+)"/g)].map(m => m[1]);
	assert.deepEqual(caps.slice(0, 3), ['Começo da ligação', 'Motivo da ligação', 'Negociação']);
	assert.ok(caps.includes('Se disser &quot;Já paguei&quot;'), caps.join(' | '));
	assert.equal(caps[caps.length - 1], 'Etapas que nenhum caminho alcança');      // N17
	// ordem: Abertura (1) antes de Confirmar identidade (2) antes de Entender intenção (3)
	const pos = (id: string) => html.indexOf(`data-etapa="${id}"`);
	assert.ok(pos('N1') < pos('N2') && pos('N2') < pos('N3') && pos('N3') < pos('N4'));
	assert.match(html, /aria-label="Etapa 1: Abertura"/);
	// o agente diz, com as variáveis em destaque; o cliente pode responder → então [nome], com link para a etapa
	assert.match(html, /O agente diz/);
	assert.match(html, /\{\{primeiro_nome\}\}<\/span>/);
	assert.match(html, /O cliente pode responder/);
	assert.match(html, />Sou eu<\/span><span[^>]*><span aria-hidden="true"> → <\/span><span class="sr-only">, <\/span>então <a href="#etapa-N2"[^>]*>Confirmar identidade<\/a>/);
	assert.doesNotMatch(html, /[→↪]\s*(<[^>]+>\s*)*(então\s*)?(<[^>]+>\s*)*N\d/);   // nunca "→ N5"
	// IA: objetivo e "a conversa termina quando"; sistema: o que faz, sem fala
	assert.match(html, /Objetivo da IA/);
	assert.match(html, /A conversa termina quando/);
	assert.match(html, /Chama um conector do CRM\. Enquanto espera, diz:/);
	assert.match(html, />Se CRM falhou</);                        // a falha diz "Se …", sem estragar a sigla
	const n8 = html.slice(pos('N8'), html.indexOf('</article>', pos('N8')));   // 1 tentativa: não repete; "Sem resposta" não ligada
	assert.match(n8, /Se não entender<\/span><span[^>]*>transfere para um atendente/);
	assert.doesNotMatch(html, /\(volta\)/);                       // no v5 não há volta: "Quer outra condição" só vai adiante
	// se não entender: o que o executor faz hoje; se não ouvir nada: ainda sem tratamento próprio
	const n2 = html.slice(pos('N2'), pos('N3'));
	assert.match(n2, /Se não entender/);
	assert.match(n2, /pede de novo 1 vez/);
	assert.match(n2, /então <a href="#etapa-N14"[^>]*>Encerrar · recado neutro<\/a>/);
	assert.match(n2, /Se não ouvir nada.*Ainda sem tratamento próprio/);
	const n3 = html.slice(pos('N3'), pos('N4'));
	assert.doesNotMatch(n3, />Não entendi 2×</);                  // "Não entendi" vai para "Se não entender", não é resposta
	// finais e a etapa sem saída (U3)
	assert.match(html, /Fim da ligação/);
	assert.match(html, /Sem atendente livre/);
	const n9 = html.slice(pos('N9'), html.indexOf('</article>', pos('N9')));
	assert.match(n9, /Nenhuma resposta ligada/);
	assert.match(n9, /impede o envio/);
	// a etapa abre pelo nome; os capítulos recolhem
	assert.match(html, /<button type="button"[^>]*>Abertura<\/button>/);
	assert.match(html, /aria-expanded="true" aria-controls="cap-comeco"/);
	assert.match(renderToStaticMarkup(<Roteiro definicao={d} marcas={marcas} onAbrir={nada} recolhidos={['comeco']} />), /<ol id="cap-comeco" hidden=""/);
});

test('abas do editor: Roteiro é a padrão; Mapa, Respostas prontas, Testes e Versões e aprovação', () => {
	assert.deepEqual(ABAS_EDITOR.map(a => a.nome), ['Roteiro', 'Mapa', 'Respostas prontas', 'Testes', 'Versões e aprovação']);
	assert.equal(abaDaUrl(null), 'roteiro');
	assert.equal(abaDaUrl('mapa'), 'mapa');
	assert.equal(abaDaUrl('qualquer'), 'roteiro');
	const html = renderToStaticMarkup(<MemoryRouter><AbasEditor atual="roteiro" onTrocar={nada} /></MemoryRouter>);
	assert.match(html, /role="tablist" aria-label="Partes do fluxo"/);
	assert.match(html, /aria-selected="true"[^>]*>Roteiro</);
	assert.match(html, /<option value="versoes">Versões e aprovação<\/option>/);   // no celular, um select
});

test('o que corrigir dentro da etapa (PR4): no cartão do roteiro, com motivo, como corrigir e o botão de um clique', async () => {
	const api = criarApiFixturas();
	const d: Definicao = definicaoV5();
	const erros = await api.bloqueios(105);
	const conectores = await api.conectores(1);
	const porBloco = new Map<string, Pendencia[]>();
	for (const e of erros.map(explicar)) if (e.bloco) porBloco.set(e.bloco, [...(porBloco.get(e.bloco) ?? []), e]);
	const marcas = new Map<string, Marca>([...porBloco.keys()].map(id => [id, 'erro'] as [string, Marca]));
	const acao = (codigo: string) => { const c = correcaoDe(d, codigo, { conectores }); return c ? { rotulo: c.botao, onClick: nada } : null; };
	const html = renderToStaticMarkup(<Roteiro definicao={d} marcas={marcas} onAbrir={nada} pendencias={porBloco} acao={acao} />);
	const cartao = (id: string) => { const i = html.indexOf(`data-etapa="${id}"`); return html.slice(i, html.indexOf('</article>', i)); };
	// N9 sem saída: o que é, o que fazer e o botão (liga "Agendou" ao Encerrar de retorno que estava solto)
	const n9 = cartao('N9');
	assert.match(n9, /aria-label="O que corrigir nesta etapa"/);
	assert.match(n9, /O que corrigir:<\/b><span[^>]*>Etapa sem saída\./);
	assert.match(n9, /Ligue as respostas desta etapa a uma próxima etapa/);
	assert.match(n9, /<button[^>]*>Ligar &quot;Agendou&quot; a Encerrar · retorno e &quot;Não agendou&quot; a Transferir · atendente<\/button>/);
	// N7: o boleto do CRM ainda em rascunho; dá para seguir com o link do MotorCX
	assert.match(cartao('N7'), /<button[^>]*>Usar o link do MotorCX por enquanto<\/button>/);
	// N17 inalcançável e solta: remover (o botão abre o antes → depois; nada muda sem confirmar)
	assert.match(cartao('N17'), /<button[^>]*>Remover a etapa<\/button>/);
	// etapa sem pendência: nada de "O que corrigir"
	assert.doesNotMatch(cartao('N2'), /O que corrigir/);
});

test('o que corrigir (PR4): pendência sem correção automática fica sem botão; atalho do fluxo; antes → depois', () => {
	const sem = renderToStaticMarkup(<OQueCorrigirComBotao impede texto="Uma etapa está com código inválido." />);
	assert.doesNotMatch(sem, /<button/);
	const fluxo = renderToStaticMarkup(<OQueCorrigirComBotao fluxo impede texto="A carteira não tem alçada cadastrada." acao={{ rotulo: 'Cadastrar alçada', onClick: nada }} />);
	assert.match(fluxo, /O que corrigir \(fluxo\):/);
	assert.match(fluxo, /<button[^>]*>Cadastrar alçada<\/button>/);
	const sujo = renderToStaticMarkup(<OQueCorrigirComBotao impede texto="x" acao={{ rotulo: 'Tirar o credor da abertura', onClick: nada, disabled: true, motivo: 'Salve a etapa antes.' }} />);
	assert.match(sujo, /<button[^>]*disabled=""[^>]*>Tirar o credor da abertura<\/button>/);
	assert.match(sujo, /Salve a etapa antes\./);
	// antes → depois do credor na abertura (pergunta Q6: sempre mostra antes de mudar)
	const d = definicaoV5();
	const n1 = d.blocos.find(b => b.id === 'N1')!;
	const comCredor = trocarBloco(d, { ...n1, params: { fala: 'Olá, bom dia! Aqui é a Lia, da {{assessoria}}, em nome do {{credor}}. Falo com {{primeiro_nome}}?' } });
	const c = correcaoDe(comCredor, 'valor_antes_identidade:N1');
	assert.ok(c);
	assert.equal(c.botao, 'Tirar o credor da abertura');
	const html = renderToStaticMarkup(<AntesDepois c={c} />);
	assert.match(html, /<span class="sr-only">Antes: <\/span>Olá, bom dia! Aqui é a Lia, da \{\{assessoria\}\}, em nome do \{\{credor\}\}\. Falo/);
	assert.match(html, /<span class="sr-only">Depois: <\/span>Olá, bom dia! Aqui é a Lia, da \{\{assessoria\}\}\. Falo com \{\{primeiro_nome\}\}\?/);
	assert.match(html, /Nada vai para ligação sem aprovação\./);
});

test('mapa e abas (PR4): o cartão do mapa diz o que corrigir; a aba Roteiro mostra a contagem', async () => {
	const d: Definicao = definicaoV5();
	const erros = (await criarApiFixturas().bloqueios(105)).map(explicar);
	const porBloco = new Map<string, Pendencia[]>();
	for (const e of erros) if (e.bloco) porBloco.set(e.bloco, [...(porBloco.get(e.bloco) ?? []), e]);
	const mapa = renderToStaticMarkup(<Quadro definicao={d} marcas={new Map()} onAbrir={nada} pendencias={porBloco} />);
	const i = mapa.indexOf('data-etapa="N9"');
	assert.match(mapa.slice(i, mapa.indexOf('</button>', i)), /O que corrigir: <\/b>Etapa sem saída\..*Toque para corrigir\./);
	const n = erros.filter(e => e.impede).length;
	const abas = renderToStaticMarkup(<MemoryRouter><AbasEditor atual="roteiro" onTrocar={nada} contagens={{ roteiro: n }} /></MemoryRouter>);
	assert.match(abas, new RegExp(`>Roteiro<span[^>]*>${n}</span>`));
	assert.match(abas, new RegExp(`<option value="roteiro"[^>]*>Roteiro \\(${n}\\)</option>`));
});
