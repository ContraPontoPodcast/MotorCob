import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assinar, autorizar, conferirCaso, falaOk, minutosPrevia, pacoteOuvir, pacoteVM, PERMISSAO, respostaTela, urlOuvir, urlRoleplay,
  validarPedido, variaveisTeste,
} from "./regras.ts";

const cliente = { id: "u1", ativo: true, equipe: false, empresa_id: 7 };
const versao = { id: 31, fluxo_id: 4, empresa_id: 7, credor_id: 2, definicao: { esquema: 1, blocos: [] } };

test("pedido: simular com falas e conectores para falhar; rodar_casos só com a versão", () => {
  assert.deepEqual(validarPedido({ versao: 31, falas: ["Sou eu"] }).pedido, { acao: "simular", versao: 31, falas: ["Sou eu"], falhar: [], cenarios: {} });
  assert.deepEqual(validarPedido({ acao: "rodar_casos", versao: 31 }).pedido, { acao: "rodar_casos", versao: 31 });
  assert.equal(validarPedido({ versao: 31, falas: ["Sou eu"], falhar: [1] }).pedido?.acao, "simular");
  assert.equal(validarPedido({ versao: "31" }).erro, "versão inválida");
  assert.equal(validarPedido({ versao: 31, acao: "apagar" }).erro, "ação inválida: simular, rodar_casos, roleplay ou ouvir");
  assert.equal(validarPedido({ versao: 31, falas: [], definicao: {} }).erro, "pedido inválido");
  assert.equal(validarPedido({ acao: "rodar_casos", versao: 31, falas: [] }).erro, "pedido inválido");
  assert.equal(validarPedido({ versao: 31, falhar: [0] }).erro, "conectores para falhar inválidos");
  assert.equal(validarPedido({ versao: 31, falas: Array(31).fill("oi") }).erro, "até 30 falas");
  assert.equal(validarPedido(null).erro, "pedido inválido");
});

test("falas: sem documento, telefone ou e-mail (como falas_teste_voz_ok)", () => {
  assert.equal(falaOk("15 de março"), true);
  assert.equal(falaOk("meu cpf é 12345678901"), false);
  assert.equal(falaOk("ana@exemplo.com"), false);
  assert.equal(falaOk(""), false);
  assert.equal(falaOk("x".repeat(301)), false);
  assert.equal(validarPedido({ versao: 1, falas: ["meu telefone 11987654321"] }).erro?.startsWith("fala inválida"), true);
});

test("quem pode: cliente ativo, mesma empresa, editar_canais", () => {
  assert.equal(PERMISSAO, "editar_canais");
  assert.equal(autorizar(cliente, true, versao), null);
  assert.equal(autorizar(cliente, false, versao), "sem permissão");
  assert.equal(autorizar({ ...cliente, empresa_id: 8 }, true, versao), "versão não encontrada");
  assert.equal(autorizar(cliente, true, null), "versão não encontrada");
  assert.equal(autorizar({ ...cliente, equipe: true }, true, versao), "a equipe MotorCX testa pelo Console");
  assert.equal(autorizar({ ...cliente, ativo: false }, true, versao), "acesso desativado");
});

test("pacote da VM: sem credencial, com exemplo e cliente fictício", () => {
  const p = pacoteVM({
    versao, conectores: [{ id: 1, nome: "Buscar ofertas", segredo_ref: "crm/7/1/x", cabecalhos_fixos: { "X-A": "b" }, exemplo_resposta: { offers: [] } }],
    alcada: { id: 3, parcelas_max: 6 }, base: [{ bloco_id: "N5", pergunta: "Suja meu nome?", resposta: "Não, com o acordo em dia." }],
    falas: ["Sou eu"], falhar: [1], variaveis: variaveisTeste("Aurora", null),
  });
  assert.equal("segredo_ref" in p.conectores[0], false);
  assert.equal("cabecalhos_fixos" in p.conectores[0], false);
  assert.deepEqual(p.conectores[0].exemplo_resposta, { offers: [] });
  assert.deepEqual(p.base, { N5: [["Suja meu nome?", "Não, com o acordo em dia."]] });
  assert.equal(p.variaveis.primeiro_nome, "Ana");
  assert.equal(p.variaveis.credor, "Credor de teste");
  assert.equal("dado_carga_vm" in p, false);                     // identidade só pelo CRM
  assert.equal(pacoteVM({ ...{ versao, conectores: [], base: [], falas: [], falhar: [], variaveis: {} }, alcada: {} }).alcada, null);
});

test("assinatura HMAC igual à da VM (vetor em voz/simulador_http, tests/test_voz_simulador_http.py)", async () => {
  const vetor = JSON.parse(readFileSync(new URL("../../../tests/dados/vetor_assinatura_simulador.json", import.meta.url), "utf-8"));
  assert.equal(await assinar(vetor.chave, vetor.carimbo, vetor.corpo), vetor.assinatura);
});

test("caso de teste: caminho exato e resultado", () => {
  const caso = { id: 1, nome: "x", falas: ["a"], caminho_esperado: ["N1", "N2"], resultado_esperado: "recado", conectores_falham: [], ativo: true };
  assert.equal(conferirCaso(caso, { caminho: ["N1", "N2"], resultado: "recado", turnos: [] }), true);
  assert.equal(conferirCaso(caso, { caminho: ["N1", "N2", "N3"], resultado: "recado", turnos: [] }), false);
  assert.equal(conferirCaso(caso, { caminho: ["N1", "N2"], resultado: "promessa", turnos: [] }), false);
  assert.equal(conferirCaso({ ...caso, resultado_esperado: null }, { caminho: ["N1", "N2"], resultado: "x", turnos: [] }), true);
});

test("resposta para a tela: fala, bloco, caminho, intenção e conectores", () => {
  const r = respostaTela({ turnos: [{ falas: [] }], caminho: ["N1"], resultado: null, encerrada: false, conectores: [], passos: [{ x: 1 }] });
  assert.deepEqual(Object.keys(r).sort(), ["caminho", "conectores", "encerrada", "resultado", "turnos"]);
});

test("roleplay: personas e quantidade (SQL 59)", () => {
  assert.deepEqual(validarPedido({ acao: "roleplay", versao: 31, personas: [1, 2], n: 5 }).pedido, { acao: "roleplay", versao: 31, personas: [1, 2], n: 5 });
  assert.equal(validarPedido({ acao: "roleplay", versao: 31, personas: [], n: 5 }).erro, "de 1 a 10 personas");
  assert.equal(validarPedido({ acao: "roleplay", versao: 31, personas: [1], n: 21 }).erro, "de 1 a 20 conversas por persona (até 200 no lote)");
  assert.equal(validarPedido({ acao: "roleplay", versao: 31, personas: Array.from({ length: 10 }, (_, i) => i + 1), n: 20 }).pedido?.acao, "roleplay");   // 200 cabe
  assert.equal(validarPedido({ acao: "roleplay", versao: 31, personas: Array.from({ length: 11 }, (_, i) => i + 1), n: 1 }).erro, "de 1 a 10 personas");
  assert.equal(validarPedido({ acao: "roleplay", versao: 31, personas: [1], n: 2, falas: [] }).erro, "pedido inválido");
  assert.equal(urlRoleplay("https://vm.exemplo:8443/simular"), "https://vm.exemplo:8443/roleplay");
});

test("caso vindo do roleplay (caminho vazio) confere só o resultado", () => {
  const caso = { id: 2, nome: "Roleplay", falas: ["a"], caminho_esperado: [], resultado_esperado: "opt_out", conectores_falham: [], ativo: true };
  assert.equal(conferirCaso(caso, { caminho: ["N1", "N3"], resultado: "opt_out", turnos: [] }), true);
  assert.equal(conferirCaso(caso, { caminho: ["N1"], resultado: "recado", turnos: [] }), false);
});

test("SQL 66: cenário escolhido para o conector simulado (sucesso, tempo, 401)", () => {
  assert.deepEqual(validarPedido({ versao: 31, falas: [], cenarios: { "1": "tempo", "2": "401" } }).pedido,
    { acao: "simular", versao: 31, falas: [], falhar: [], cenarios: { "1": "tempo", "2": "401" } });
  for (const ruim of [{ "1": "500" }, { x: "tempo" }, ["tempo"], { "0": "tempo" }, Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), "tempo"]))]) {
    assert.match(validarPedido({ versao: 31, cenarios: ruim }).erro ?? "", /cenários inválidos/);
  }
  const p = pacoteVM({ versao, conectores: [], alcada: null, base: [], falas: [], falhar: [], variaveis: {}, cenarios: { "1": "401" } });
  assert.deepEqual(p.cenarios, { "1": "401" });
});

test("SQL 66: ouvir a voz — texto curto sem dado pessoal, voz da empresa e minutos estimados", () => {
  assert.deepEqual(validarPedido({ acao: "ouvir", versao: 31, texto: "Um instante, por favor." }).pedido, { acao: "ouvir", versao: 31, texto: "Um instante, por favor." });
  assert.match(validarPedido({ acao: "ouvir", versao: 31, texto: "cpf 12345678901" }).erro ?? "", /texto inválido/);
  assert.match(validarPedido({ acao: "ouvir", versao: 31, texto: "x".repeat(501) }).erro ?? "", /texto inválido/);
  assert.equal(validarPedido({ acao: "ouvir", versao: 31, texto: "oi", falas: [] }).erro, "pedido inválido");
  assert.equal(urlOuvir("https://1-2-3-4.sslip.io:8443/simular"), "https://1-2-3-4.sslip.io:8443/ouvir");
  assert.deepEqual(pacoteOuvir("Oi", "voz_pt1", { primeiro_nome: "Ana" }), { texto: "Oi", voz_id: "voz_pt1", variaveis: { primeiro_nome: "Ana" } });
  assert.equal("voz_id" in pacoteOuvir("Oi", "../x", {}), false);
  assert.equal(minutosPrevia(900), 1);
  assert.equal(minutosPrevia(45), 0.05);
});
