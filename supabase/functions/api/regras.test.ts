// node --experimental-strip-types --test supabase/functions/api/regras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hojeSP, nomeSeguro, rota, semAcesso, sha256Hex, type Token, tokenDoCabecalho, tokenInvalido, validarCarga,
  validarLista } from "./regras.ts";

const TOK = "mc_" + "ab12".repeat(16);
const tok = (x: Partial<Token> = {}): Token => ({ id: 1, empresa_id: 1, prefixo: "mc_ab12ab12", escopos: ["cargas:enviar"],
  credor_ids: null, criado_por: "u", expira_em: "2099-01-01T00:00:00Z", revogado_em: null, ...x });
const q = (s: string) => new URLSearchParams(s);

test("rotas", () => {
  assert.deepEqual(rota("POST", "/api/v1/cargas"), { nome: "enviar_carga" });
  assert.deepEqual(rota("POST", "/functions/v1/api/v1/cargas/"), { nome: "enviar_carga" });
  assert.deepEqual(rota("GET", "/api/v1/cargas/42"), { nome: "status_carga", id: 42 });
  assert.deepEqual(rota("GET", "/api/v1/lista-do-dia"), { nome: "lista" });
  assert.equal(rota("DELETE", "/api/v1/cargas/42"), null);
  assert.equal(rota("GET", "/api/v1/cargas/abc"), null);
  assert.equal(rota("GET", "/api/v2/cargas"), null);
});

test("token no cabeçalho e hash", async () => {
  assert.equal(tokenDoCabecalho(`Bearer ${TOK}`), TOK);
  assert.equal(tokenDoCabecalho(TOK), null);
  assert.equal(tokenDoCabecalho("Bearer eyJhbGciOi.jwt.supabase"), null);
  assert.equal(tokenDoCabecalho(`Bearer ${TOK}x`), null);
  // igual a encode(sha256(convert_to(token,'UTF8')),'hex') no banco
  assert.equal(await sha256Hex("11988887766"), "07957c85a7805d5b436a6f6d664cba6ecd2d97bd8a87a7f3cd515cf6b6f80294");
});

test("token revogado, vencido, escopo e credor", () => {
  const agora = new Date("2026-10-11T12:00:00Z");
  assert.equal(tokenInvalido(null, agora), "token inválido");
  assert.equal(tokenInvalido(tok({ revogado_em: "2026-10-01" }), agora), "token revogado");
  assert.match(tokenInvalido(tok({ expira_em: "2026-10-11T11:59:59Z" }), agora)!, /vencido/);
  assert.equal(tokenInvalido(tok(), agora), null);
  assert.match(semAcesso(tok(), "lista:ler")!, /escopo lista:ler/);
  assert.equal(semAcesso(tok(), "cargas:enviar", 7), null);
  assert.match(semAcesso(tok({ credor_ids: [3] }), "cargas:enviar", 7)!, /credor/);
  assert.equal(semAcesso(tok({ credor_ids: [7] }), "cargas:enviar", 7), null);
});

test("carga: credor, tipo, nome e tamanho", () => {
  assert.deepEqual(validarCarga(q("credor=banco-x&tipo=geral&nome=carga out.csv"), 10),
    { credor: "banco-x", tipo: "base", nome: "carga_out.csv" });
  assert.match(validarCarga(q("tipo=base&nome=a.csv"), 10).erro!, /credor/);
  assert.match(validarCarga(q("credor=Banco X&tipo=base&nome=a.csv"), 10).erro!, /credor/);
  assert.match(validarCarga(q("credor=b&tipo=tudo&nome=a.csv"), 10).erro!, /tipo inválido/);
  assert.match(validarCarga(q("credor=b&tipo=base&nome=a.exe"), 10).erro!, /\.csv/);
  assert.match(validarCarga(q("credor=b&tipo=base&nome=a.csv"), 0).erro!, /vazio/);
  assert.match(validarCarga(q("credor=b&tipo=base&nome=a.csv"), 21 * 1024 * 1024).erro!, /20 MB/);
  assert.equal(nomeSeguro("../../etc/passwd"), "passwd");
  assert.equal(nomeSeguro("Carteira Março.xlsx"), "Carteira_Marco.xlsx");
});

test("lista do dia: credor, data e canal", () => {
  assert.deepEqual(validarLista(q("credor=banco-x&canal=sms"), "2026-10-11"),
    { credor: "banco-x", data: "2026-10-11", canal: "sms" });
  assert.match(validarLista(q("credor=banco-x&canal=pombo"), "2026-10-11").erro!, /canal/);
  assert.match(validarLista(q("credor=banco-x&canal=sms&data=11/10/2026"), "2026-10-11").erro!, /AAAA-MM-DD/);
  assert.equal(hojeSP(new Date("2026-10-12T02:30:00Z")), "2026-10-11");   // 23h30 em São Paulo
});
