import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assinarVM, conferirAssinaturaVM, criarBilhete, dadosAbandono, dadosBilhete, dadosRegistro, erroDoBanco, limiteVoz, limparTurnos,
  MAX_FALAS_OPERADOR, minutosPrevia, pacoteAvaliar, pacoteTurno, somarTurno, temFalaDoOperador, tempoEsgotado, urlOuvir, validarPedido,
  validarRegistroVoz, VALIDADE_BILHETE_S, dadosCenarioGerado, insightsDaEscolha, type Contexto, type PadroesInsights,
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
  assert.equal(validarPedido({ acao: "apagar", sessao: 9 }).erro, "ação inválida: turno, encerrar, sair, voz ou ouvir");
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

test("voz: pedido do bilhete e do Ouvir a voz (antes da sessão)", () => {
  assert.deepEqual(validarPedido({ acao: "voz", sessao: 9, token: TOKEN }).pedido, { acao: "voz", sessao: 9, token: TOKEN, texto: null });
  assert.equal(validarPedido({ acao: "voz", sessao: 9, texto: "oi" }).erro, "pedido inválido");
  assert.deepEqual(validarPedido({ acao: "ouvir", token: TOKEN, atribuicao: 4 }).pedido,
    { acao: "ouvir", sessao: 0, token: TOKEN, texto: null, atribuicao: 4, cenario: null, empresa: null });
  assert.deepEqual(validarPedido({ acao: "ouvir", cenario: 3, empresa: 2 }).pedido,
    { acao: "ouvir", sessao: 0, token: null, texto: null, atribuicao: null, cenario: 3, empresa: 2 });
  assert.equal(validarPedido({ acao: "ouvir", token: TOKEN }).erro, "pedido inválido", "pelo link precisa da atribuição");
  assert.equal(validarPedido({ acao: "ouvir", cenario: 3 }).erro, "pedido inválido", "logado precisa da empresa");
  assert.equal(validarPedido({ acao: "ouvir", cenario: 3, empresa: 2, texto: "fale isto" }).erro, "pedido inválido", "o texto da prévia nunca vem do navegador");
});

test("voz: o corte é o menor entre a duração do cenário e o saldo da franquia", () => {
  assert.deepEqual(limiteVoz(480, 60000), { limite_s: 480, por_franquia: false });
  assert.deepEqual(limiteVoz(480, 200), { limite_s: 200, por_franquia: true });
  assert.deepEqual(limiteVoz(480, null), { limite_s: 480, por_franquia: false });
  assert.deepEqual(limiteVoz(5000, null), { limite_s: 900, por_franquia: false });
  assert.deepEqual(limiteVoz(480, -3), { limite_s: 0, por_franquia: true });
});

test("voz: bilhete com o mesmo formato e assinatura de voz/treino_voz.py", async () => {
  // o mesmo vetor está em tests/test_voz_treino_voz.py
  assert.equal(await criarBilhete("k", { v: 1, sessao: 7 }), "eyJ2IjoxLCJzZXNzYW8iOjd9.f86bf7fd81a1e59d676550973f8b9a2c25bc7c332974ffd526f91e9792ea62d1");
  const d = dadosBilhete(ctx({ modo: "voz", voz_restante_s: 120, cenario: { persona_nome: "Rita (fictícia)", objetivo: "x", voz_tts: "voz_1" } }), 1000);
  assert.equal(d.exp, 1000 + VALIDADE_BILHETE_S);
  assert.equal(d.limite_s, 120);
  assert.equal(d.por_franquia, true);
  assert.equal(d.voz, "voz_1");
  assert.equal(d.v, 1);
  assert.deepEqual(Object.keys(d).sort(), ["cenario", "checklist", "exp", "limite_s", "por_franquia", "sessao", "v", "voz"]);
  assert.equal(dadosBilhete(ctx({ cenario: { persona_nome: "R", objetivo: "x", voz_tts: "../etc" } }), 0).voz, null);
});

test("voz: o resultado da VM só entra assinado e com os campos de registrar_sessao_treino", async () => {
  const corpo = JSON.stringify({ acao: "voz_registrar", sessao: 9, dados: { situacao: "avaliada" }, sem_fala: false });
  const a = await assinarVM("k", "1000", corpo);
  assert.ok(await conferirAssinaturaVM("k", "1000", a, corpo, 1100));
  assert.ok(!(await conferirAssinaturaVM("k", "1000", a, corpo, 1400)), "carimbo velho");
  assert.ok(!(await conferirAssinaturaVM("k", "1000", a, corpo + " ", 1000)), "corpo mexido");
  assert.ok(!(await conferirAssinaturaVM("outra", "1000", a, corpo, 1000)));
  assert.ok(!(await conferirAssinaturaVM("", "1000", a, corpo, 1000)), "sem chave configurada");
  assert.ok(!(await conferirAssinaturaVM("k", null, a, corpo, 1000)));
  const r = validarRegistroVoz({ acao: "voz_registrar", sessao: 9, sem_fala: false, dados: { situacao: "avaliada", duracao_s: 64, minutos_stt: 1.07,
    caracteres_tts: 30, transcricao: [{ quem: "operador", texto: "Boa tarde", t: 3, audio: "x" }] } });
  assert.deepEqual(r?.dados.transcricao, [{ quem: "operador", texto: "Boa tarde", t: 3 }], "nada além de quem/texto/t");
  assert.equal(validarRegistroVoz({ acao: "voz_registrar", sessao: 9, dados: { situacao: "avaliada", audio: "AAAA" } }), null, "nunca áudio");
  assert.equal(validarRegistroVoz({ acao: "voz_registrar", sessao: 9, dados: { situacao: "aprovada" } }), null);
  assert.equal(validarRegistroVoz({ acao: "turno", sessao: 9, dados: { situacao: "avaliada" } }), null);
  assert.equal(validarRegistroVoz({ acao: "voz_registrar", sessao: 9, dados: { situacao: "abandonada" }, sem_fala: true })?.sem_fala, true);
});

test("voz: prévia na rota /ouvir do simulador e minutos estimados", () => {
  assert.equal(urlOuvir("https://vm.exemplo:8443/simular"), "https://vm.exemplo:8443/ouvir");
  assert.equal(minutosPrevia(900), 1);
  assert.equal(erroDoBanco("limite de prévias da voz").status, 429);
});

const PAD: PadroesInsights = {
  de: "2026-10-11", ate: "2026-11-09", base: 412, suficiente: true,
  motivos: [{ codigo: "contestacao", conversas: 72, pct: 0.175 }], objecoes: [{ codigo: "valor_alto", conversas: 120, pct: 0.291 }],
  itens: [{ item: "ck_cpc", avaliadas: 40, sim_pct: 0.5 }],
};

test("gerar cenário: pedido só com códigos, logado, com a empresa", () => {
  assert.deepEqual(validarPedido({ acao: "gerar_cenario", empresa: 3, motivo: "contestacao", item: "ck_cpc" }).pedido,
    { acao: "gerar_cenario", sessao: 0, token: null, texto: null, empresa: 3, escolha: { motivo: "contestacao", objecao: null, item: "ck_cpc", dias: 30 } });
  assert.equal(validarPedido({ acao: "gerar_cenario", empresa: 3 }).erro, "escolha um motivo, uma objeção ou um item");
  assert.equal(validarPedido({ acao: "gerar_cenario", empresa: 3, motivo: "Lia disse que pagou" }).erro, "pedido inválido", "nada de texto livre");
  assert.equal(validarPedido({ acao: "gerar_cenario", empresa: 3, motivo: "contestacao", insights: { base: 999 } }).erro, "pedido inválido", "o navegador não manda padrão");
  assert.equal(validarPedido({ acao: "gerar_cenario", empresa: 3, motivo: "contestacao", dias: 400 }).erro, "pedido inválido");
});

test("gerar cenário: os insights vêm só do banco (grupo com 30+), nunca do navegador", () => {
  const e = { motivo: "contestacao", objecao: "valor_alto", item: "ck_cpc", dias: 30 };
  assert.deepEqual(insightsDaEscolha(PAD, e).insights,
    { base: 412, de: "2026-10-11", ate: "2026-11-09", "motivo:contestacao": 0.175, "objecao:valor_alto": 0.291, "item:ck_cpc": 0.5 });
  assert.match(insightsDaEscolha(PAD, { ...e, motivo: "desemprego" }).erro ?? "", /30 ligações/);
  assert.match(insightsDaEscolha({ ...PAD, base: 20, suficiente: false }, e).erro ?? "", /30 ligações/);
});

test("gerar cenário: rascunho, origem insights, ficha fictícia pelo código; texto com cara de dado real recusa", () => {
  const e = { motivo: "contestacao", objecao: null, item: "ck_cpc", dias: 30 };
  const ins = { base: 412, "motivo:contestacao": 0.175 };
  const vm = { nome: "Contesta e desconfia", persona_nome: "Lia (fictícia)", perfil: "contesta_procon", objetivo: "Não reconhece a dívida e pede explicação.",
    comportamentos: ["desconfia", "liga 11987654321"], frases: ["Eu não reconheço isso."], objecoes: [{ codigo: "nao_reconheco", quando: "no começo" }, { codigo: "Inválida" }],
    dificuldade: 4, objetivo_cenario: "Explicar a origem da dívida" };
  const d = dadosCenarioGerado(vm, ins, e)!;
  assert.equal(d.situacao, "rascunho");
  assert.equal(d.origem, "insights");
  assert.deepEqual(d.insights, ins);
  assert.deepEqual(d.itens_foco, ["ck_cpc"]);
  assert.deepEqual(d.comportamentos, ["desconfia"], "texto com telefone sai");
  assert.deepEqual(d.objecoes, [{ codigo: "nao_reconheco", quando: "no começo" }]);
  assert.deepEqual(d.divida, { produto: "Cartão Exemplo", faixa: "1k_5k", dias_atraso: 60, alcada: { parcelas: 6, desconto_max: 20 } });
  assert.equal(dadosCenarioGerado({ ...vm, persona_nome: "Lia Souza" }, ins, e), null, "sem (fictícia), não");
  assert.equal(dadosCenarioGerado({ ...vm, objetivo: "lia@exemplo.com" }, ins, e), null);
  assert.equal(dadosCenarioGerado({ ...vm, perfil: "outro" }, ins, e)!.perfil, "contesta_procon", "o tipo de cliente pelo motivo");
  assert.equal(dadosCenarioGerado(null, ins, e), null);
});
