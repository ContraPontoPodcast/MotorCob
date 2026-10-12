// node --experimental-strip-types --test supabase/functions/assistente/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACOES, anonimizar, ESQUEMA, montarMensagens, montarResposta, SEM_RESPOSTA, validarPedido } from "./regras.ts";

test("valida o pedido", () => {
  assert.equal(validarPedido(null).erro, "pedido inválido");
  assert.equal(validarPedido({ pergunta: "   " }).erro, "escreva a pergunta");
  assert.equal(validarPedido({ pergunta: "x".repeat(501) }).erro, "pergunta com mais de 500 caracteres");
  assert.equal(validarPedido({ pergunta: "oi", origem: "email" }).erro, "origem inválida");
  assert.equal(validarPedido({ pergunta: "oi", tela: "<script>" }).erro, "tela inválida");
  assert.equal(validarPedido({ pergunta: "oi", empresa_id: "1;drop" }).erro, "empresa inválida");
  assert.equal(validarPedido({ pergunta: "oi", historico: [{ papel: "sistema", texto: "x" }] }).erro, "histórico inválido");
  assert.deepEqual(validarPedido({ pergunta: "  como   crio uma campanha? ", tela: "/mensageria/sms" }).pedido, {
    pergunta: "como crio uma campanha?", origem: "busca", tela: "/mensageria/sms", empresa_id: null, historico: [],
  });
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
