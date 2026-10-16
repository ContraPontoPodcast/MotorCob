// node --experimental-strip-types --test supabase/functions/assistente/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACOES, acoesPermitidas, anonimizar, blocoRespostasEquipe, type Contexto, conversaParaChamado, custoUsd, ESQUEMA,
  MODELO, montarMensagens, montarResposta, motivoDoChamado, respostaDaEquipe, SEM_RESPOSTA, TEMAS, textoContexto, textoParcial,
  validarPedido } from "./regras.ts";

test("valida o pedido", () => {
  assert.equal(validarPedido(null).erro, "pedido inválido");
  assert.equal(validarPedido({ pergunta: "   " }).erro, "escreva a pergunta");
  assert.equal(validarPedido({ pergunta: "x".repeat(501) }).erro, "pergunta com mais de 500 caracteres");
  assert.equal(validarPedido({ pergunta: "oi", origem: "email" }).erro, "origem inválida");
  assert.equal(validarPedido({ pergunta: "oi", tela: "<script>" }).erro, "tela inválida");
  assert.equal(validarPedido({ pergunta: "oi", empresa_id: "1;drop" }).erro, "empresa inválida");
  assert.equal(validarPedido({ pergunta: "oi", historico: [{ papel: "sistema", texto: "x" }] }).erro, "histórico inválido");
  assert.deepEqual(validarPedido({ pergunta: "  como   crio uma campanha? ", tela: "/mensageria/sms" }).pedido, {
    pergunta: "como crio uma campanha?", origem: "busca", tela: "/mensageria/sms", tela_nome: null, frente: null,
    empresa_id: null, historico: [], stream: false,
  });
  const p = validarPedido({ pergunta: "oi", tela_nome: "Mensageria › Campanhas", frente: "motorcli", stream: true }).pedido!;
  assert.deepEqual([p.tela_nome, p.frente, p.stream], ["Mensageria › Campanhas", "motorcli", true]);
  assert.equal(validarPedido({ pergunta: "oi", tela_nome: "<b>x</b>" }).erro, "tela inválida");
  assert.equal(validarPedido({ pergunta: "oi", frente: "outra" }).erro, "frente inválida");
});

test("histórico guarda só as últimas mensagens", () => {
  const historico = Array.from({ length: 20 }, (_, i) => ({ papel: i % 2 ? "assistente" : "usuario", texto: `m${i}` }));
  const p = validarPedido({ pergunta: "e agora?", historico }).pedido!;
  assert.equal(p.historico.length, 8);
  assert.equal(p.historico[7].texto, "m19");
});

test("apaga CPF, CNPJ, telefone, e-mail e números longos", () => {
  const r = anonimizar("CPF 123.456.789-09, cnpj 12.345.678/0001-90, fone (11) 98765-4321, ana@exemplo.com, contrato 9988776655443");
  assert.equal(r.texto, "CPF [CPF], cnpj [CNPJ], fone [telefone], [e-mail], contrato [número]");
  assert.ok(r.removeu);
  assert.equal(anonimizar("12345678909").texto, "[CPF]");
  assert.equal(anonimizar("+55 21 912345678").texto, "[telefone]");
  const limpo = anonimizar("Como subo a lista de 160 caracteres em 2026?");
  assert.equal(limpo.removeu, false);
});

test("mensagens alternadas, começando e terminando no usuário", () => {
  const m = montarMensagens([
    { papel: "assistente", texto: "olá" },
    { papel: "usuario", texto: "oi" },
    { papel: "usuario", texto: "meu cpf 123.456.789-09" },
    { papel: "assistente", texto: "não preciso dele" },
  ], "como vejo o painel?", "/inicio");
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
  assert.equal(m[0].content, "oi\nmeu cpf [CPF]");
  assert.equal(m[2].content, "[Tela atual: /inicio]\ncomo vejo o painel?");
  assert.deepEqual(montarMensagens([{ papel: "usuario", texto: "a" }], "b", null).map((x) => x.content), ["a\nb"]);
});

test("monta a resposta só com ações conhecidas", () => {
  const r = montarResposta({ respondida: true, texto: " Em Campanhas. ", passos: ["Abra", "", 3], acao: "abrir_campanhas" });
  assert.deepEqual(r, { respondida: true, texto: "Em Campanhas.", passos: ["Abra"], acao: { id: "abrir_campanhas", rotulo: "Abrir Campanhas" } });
  assert.equal(montarResposta({ respondida: true, texto: "x", passos: [], acao: "https://golpe.com" }).acao, null);
  assert.equal(montarResposta({ respondida: true, texto: "x", passos: [], acao: "nenhuma" }).acao, null);
  assert.deepEqual(montarResposta({ respondida: false, texto: "não sei", passos: [], acao: "nenhuma" }).acao, SEM_RESPOSTA.acao);
  assert.deepEqual(montarResposta("lixo"), SEM_RESPOSTA);
  assert.deepEqual(montarResposta({ texto: "" }), SEM_RESPOSTA);
  assert.equal(montarResposta({ respondida: true, texto: "x".repeat(5000), passos: [], acao: "nenhuma" }).texto.length, 1500);
});

test("o esquema lista todas as ações e 'nenhuma'", () => {
  assert.deepEqual(ESQUEMA.properties.acao.enum, [...Object.keys(ACOES), "nenhuma"]);
});

const ctx: Contexto = { papel: "operacao", equipe: false, empresa_id: 7, frentes: ["motorcob"], modulos: ["mensageria"],
  pode: { ver_faturamento: false, gerenciar_usuarios: false, editar_canais: false, gerenciar_api: false } };

test("modelo aprovado e esquema com tema e resposta da equipe", () => {
  assert.equal(MODELO, "claude-sonnet-5-5");
  assert.deepEqual(ESQUEMA.properties.tema.enum, [...TEMAS]);
  assert.deepEqual(ESQUEMA.required, ["respondida", "texto", "passos", "acao", "tema", "resposta_equipe"]);
});

test("telas que a pessoa pode abrir e o contexto que vai junto", () => {
  const p = acoesPermitidas(ctx);
  assert.ok(p.has("abrir_campanhas") && p.has("abrir_chamado") && p.has("abrir_relatorios"));
  assert.ok(!p.has("abrir_lista_dia") && !p.has("abrir_faturamento") && !p.has("abrir_config_mensageria") && !p.has("abrir_tokens_api"));
  assert.equal(acoesPermitidas({ ...ctx, equipe: true }).size, Object.keys(ACOES).length);
  const t = textoContexto(ctx, null, "Mensageria › Campanhas", p);
  assert.match(t, /^\[Contexto: perfil Operação · frente MotorCob · módulos: Mensageria · tela: Mensageria › Campanhas · telas que pode abrir: /);
  assert.doesNotMatch(t, /abrir_chamado|abrir_lista_dia/);
  assert.equal(textoContexto(null, null, null, p), "");
  const m = montarMensagens([], "como agendo?", "/mensageria/sms", t);
  assert.match(m[0].content, /^\[Contexto: .*\]\n\[Tela atual: \/mensageria\/sms\]\ncomo agendo\?$/s);
});

test("resposta respeita as telas permitidas, o tema e as respostas da equipe", () => {
  const r = montarResposta({ respondida: true, texto: "x", passos: [], acao: "abrir_faturamento", tema: "Empresa", resposta_equipe: 4 },
    acoesPermitidas(ctx), new Set([4]));
  assert.equal(r.acao, null);
  assert.equal(r.tema, "Empresa");
  assert.equal(r.resposta_equipe, 4);
  const r2 = montarResposta({ respondida: true, texto: "x", passos: [], acao: "abrir_campanhas", tema: "Inventado", resposta_equipe: 99 },
    acoesPermitidas(ctx), new Set([4]));
  assert.deepEqual([r2.acao?.id, r2.tema, r2.resposta_equipe], ["abrir_campanhas", null, null]);
});

test("custo por resposta pelos tokens (cache de 1 hora incluído)", () => {
  assert.equal(custoUsd("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 300, cache_creation_input_tokens: 0,
    cache_read_input_tokens: 15000 }), 0.008);
  assert.equal(custoUsd("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 15000 }), 0.06);
  assert.equal(custoUsd("modelo-novo", { output_tokens: 1000 }), 0.025);
});

test("texto parcial do JSON enquanto chega", () => {
  assert.equal(textoParcial('{"respondida":true,"te'), null);
  assert.equal(textoParcial('{"respondida":true,"texto":"Na pró'), "Na pró");
  assert.equal(textoParcial('{"respondida":true,"texto":"Use \\"Agendar\\"\\nd'), 'Use "Agendar"\nd');
  assert.equal(textoParcial('{"texto":"a\\u00'), "a");
  assert.equal(textoParcial('{"texto":"a\\u00e7ão","passos":[]}'), "ação");
  assert.equal(textoParcial('{"texto":"fim\\'), "fim");
});

test("respostas da equipe: bloco para o modelo e uso sem o modelo no teto", () => {
  const lista = [{ id: 3, pergunta: "Consigo mudar o remetente do SMS?", resposta: "Não: é um número curto da operadora.",
    passos: [], acao: "abrir_config_mensageria", tela: "/mensageria", frente: "motorcob" }];
  assert.match(blocoRespostasEquipe(lista), /^# RESPOSTAS DA EQUIPE\n\n## 3\. Consigo mudar o remetente do SMS\? \(só MotorCob\)\nNão/);
  assert.equal(blocoRespostasEquipe([]), "");
  assert.equal(respostaDaEquipe("Dá para mudar o remetente do SMS?", lista, "motorcob")?.id, 3);
  assert.equal(respostaDaEquipe("Dá para mudar o remetente do SMS?", lista, "motorcli"), null);
  assert.equal(respostaDaEquipe("Como baixo a Lista do dia?", lista, null), null);
});

test("chamado: motivo pela tela e conversa sem dado pessoal", () => {
  assert.equal(motivoDoChamado("/mensageria/sms/campanhas"), "mensageria");
  assert.equal(motivoDoChamado("/empresa/faturamento"), "faturamento");
  assert.equal(motivoDoChamado(null), "outro");
  const c = conversaParaChamado([{ papel: "usuario", texto: "o cliente 123.456.789-09 não recebeu" },
    { papel: "assistente", texto: "Veja em Clientes." }], "Clientes", "👎 Não respondeu");
  assert.equal(c, "Tela: Clientes\nPergunta: o cliente [CPF] não recebeu\nResposta: Veja em Clientes.\nAvaliação: 👎 Não respondeu");
});
