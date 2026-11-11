import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assinarVM, dadosAbandono, dadosRegistro, erroDoBanco, limparTurnos, MAX_FALAS_OPERADOR, pacoteAvaliar, pacoteTurno, somarTurno,
  temFalaDoOperador, tempoEsgotado, validarPedido, type Contexto,
} from "./regras.ts";

const TOKEN = "a".repeat(64);
const ctx = (x: Partial<Contexto> = {}): Contexto => ({
  sessao: 9, origem: "link", modo: "texto", situacao: "em_andamento", segundos: 125.4, duracao_max_s: 480,
  cenario: { persona_nome: "Rita (fictícia)", objetivo: "Diz que já pagou." }, checklist: { versao_id: 3, itens: [{ id: "ck_cpc" }] },
  turnos: [{ quem: "persona", texto: "Alô?", t: 0 }, { quem: "operador", texto: "Boa tarde", t: 5 }], tokens: 40, saldo: "R$ 2.340,00", ...x,
});

test("pedido: turno, encerrar e sair; token só 64 hex; texto só no turno e até 600", () => {
  assert.deepEqual(validarPedido({ acao: "turno", sessao: 9, token: TOKEN, texto: "Boa tarde" }).pedido, { acao: "turno", sessao: 9, token: TOKEN, texto: "Boa tarde" });
  assert.deepEqual(validarPedido({ acao: "encerrar", sessao: 9 }).pedido, { acao: "encerrar", sessao: 9, token: null, texto: null });
  assert.equal(validarPedido({ acao: "apagar", sessao: 9 }).erro, "ação inválida: turno, encerrar ou sair");
  assert.equal(validarPedido({ acao: "turno", sessao: "9" }).erro, "sessão inválida");
  assert.equal(validarPedido({ acao: "turno", sessao: 9, token: "XYZ" }).erro, "link inválido ou vencido");
  assert.equal(validarPedido({ acao: "turno", sessao: 9, texto: "x".repeat(601) }).erro, "escreva de 1 a 600 caracteres");
  assert.equal(validarPedido({ acao: "turno", sessao: 9, texto: "   " }).erro, "escreva de 1 a 600 caracteres");
  assert.equal(validarPedido({ acao: "sair", sessao: 9, texto: "oi" }).erro, "pedido inválido");
  assert.equal(validarPedido({ acao: "turno", sessao: 9, cenario: {} }).erro, "pedido inválido", "o site nunca manda o cenário");
  assert.equal(validarPedido(null).erro, "pedido inválido");
});

test("conversa: o turno soma a fala do operador (mascarada pela VM) e a do cliente, com o segundo da sessão", () => {
  const t = somarTurno(ctx().turnos, "O valor é R$ 2.300", "Mas eu já paguei!", 30.6);
  assert.deepEqual(t.slice(2), [{ quem: "operador", texto: "O valor é R$ 2.300", t: 31 }, { quem: "persona", texto: "Mas eu já paguei!", t: 31 }]);
  assert.deepEqual(somarTurno([], null, "Alô?", 0), [{ quem: "persona", texto: "Alô?", t: 0 }]);
  assert.deepEqual(limparTurnos([{ quem: "agente", texto: "x" }, { quem: "operador", texto: "ok", t: 3, extra: 1 }, null]), [{ quem: "operador", texto: "ok", t: 3 }]);
  assert.ok(temFalaDoOperador(ctx().turnos));
  assert.ok(!temFalaDoOperador([{ quem: "persona", texto: "Alô?" }]));
  assert.ok(tempoEsgotado(510, 480) && !tempoEsgotado(509, 480));
  assert.equal(MAX_FALAS_OPERADOR, 60);
});

test("pacotes da VM: o cenário inteiro só vai do servidor para a VM; turnos só com quem/texto/t", () => {
  assert.deepEqual(Object.keys(pacoteTurno(ctx(), "Oi")), ["treino", "sessao", "cenario", "turnos", "texto"]);
  assert.equal(pacoteTurno(ctx(), null).treino, "turno");
  const a = pacoteAvaliar(ctx());
  assert.equal(a.treino, "avaliar");
  assert.deepEqual(a.checklist, { versao_id: 3, itens: [{ id: "ck_cpc" }] });
});

test("registro: avaliada com transcrição e duração; sem avaliação válida = falhou (não conta, não cobra); abandono", () => {
  const av = { situacao: "avaliada", nota: 66.67, itens: { ck_cpc: "nao" }, evidencia: { ck_cpc: [5, 10] }, reprovada: true, item_reprovado: "ck_cpc",
               objetivo_ok: null, feedback: [{ item: "ck_cpc", trecho: "Boa tarde", dica: "Confirme a identidade." }, { item: "x" }], tokens: 300, codigos: { motivo: "x" } };
  const d = dadosRegistro(av, ctx());
  assert.equal(d.situacao, "avaliada");
  assert.equal(d.duracao_s, 125);
  assert.equal(d.tokens, 340);
  assert.deepEqual(d.transcricao, ctx().turnos);
  assert.deepEqual(d.feedback, [{ item: "ck_cpc", trecho: "Boa tarde", dica: "Confirme a identidade." }]);
  assert.ok(!("codigos" in d), "nada além do que registrar_sessao_treino aceita");
  const aceitos = ["situacao", "motivo_falha", "duracao_s", "nota", "itens", "evidencia", "reprovada", "item_reprovado", "objetivo_ok", "tokens", "minutos_stt", "caracteres_tts", "transcricao", "feedback", "custo_real"];
  for (const k of Object.keys(d)) assert.ok(aceitos.includes(k), k);
  assert.deepEqual(dadosRegistro({ situacao: "falhou", tokens: 12 }, ctx()), { situacao: "falhou", motivo_falha: "servico", duracao_s: 125, tokens: 52 });
  assert.deepEqual(dadosRegistro(null, ctx({ tokens: 0 })), { situacao: "falhou", motivo_falha: "servico", duracao_s: 125, tokens: 0 });
  assert.deepEqual(dadosAbandono(ctx()), { situacao: "abandonada", duracao_s: 125, tokens: 40 });
  // a lista de campos aceitos é a do registrar_sessao_treino no SQL 90
  const sql = readFileSync(new URL("../../migrations/20270126000001_treino_operadores.sql", import.meta.url), "utf8");
  for (const k of aceitos) assert.ok(sql.includes(`'${k}'`), k);
});

test("erros do banco viram mensagens para a tela, sem detalhe interno", () => {
  assert.deepEqual(erroDoBanco("link inválido ou vencido"), { status: 401, erro: "Este link de treino não abre mais. Peça o link atual à Qualidade." });
  assert.equal(erroDoBanco("a sessão já terminou").status, 409);
  assert.equal(erroDoBanco("treinos indisponíveis").status, 403);
  assert.equal(erroDoBanco("sem permissão para o treino de operadores (treinar_operadores)").status, 403);
  assert.equal(erroDoBanco(undefined).erro, "Sessão não encontrada.");
});

test("assinatura HMAC igual à do simulador (hex(hmac(chave, carimbo.corpo)))", async () => {
  const a = await assinarVM("chave", "1", "x");
  assert.equal(a, "8f438b42db32e9682af7cb96f409f7615837971c7a4e838c1cc52aa4458ca58d", "o mesmo do voz/simulador_http.py (assinatura)");
  assert.notEqual(a, await assinarVM("outra", "1", "x"));
});
