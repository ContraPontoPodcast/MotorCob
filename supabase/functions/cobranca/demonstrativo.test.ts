import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, detalheFaixas, emailAcordo, emailFatura, emailLembrete, emailLembreteParcela, linhaDoItem, montar } from "./demonstrativo.ts";
import { EXEMPLO } from "./demonstrativo_exemplo.ts";

test("valores em reais e negativos com sinal", () => {
  assert.equal(brl(4812.4), "R$ 4.812,40");
  assert.equal(brl(-250), "- R$ 250,00");
});

test("faixas: progressivo mostra a conta; por faixa mostra onde o volume caiu", () => {
  const f = [{ ate: 10000, preco: 0.26 }, { ate: null, preco: 0.2018 }];
  assert.equal(detalheFaixas("progressivo", f, 12500),
    "até 10.000: 10.000 × R$ 0,2600 = R$ 2.600,00 · acima de 10.000: 2.500 × R$ 0,2018 = R$ 504,50");
  assert.equal(detalheFaixas("progressivo", f, 800), "até 10.000: 800 × R$ 0,2600 = R$ 208,00");
  const g = [{ ate: 10000, preco: 0.075 }, { ate: 50000, preco: 0.068 }, { ate: null, preco: 0.06 }];
  assert.equal(detalheFaixas("faixa", g, 14902), "Volume na faixa de 10.001 a 50.000 (R$ 0,0680)");
  assert.equal(detalheFaixas("faixa", g, 60000), "Volume na faixa acima de 50.000 (R$ 0,0600)");
  assert.equal(detalheFaixas("flat", g, 10), undefined);
});

test("cada item diz como é cobrado", () => {
  const l = linhaDoItem(EXEMPLO.itens[0]);
  assert.deepEqual([l.item, l.como, l.quantidade, l.preco, l.valor],
    ["Orquestração (MotorCob)", "Por contrato · escalonado progressivo", "12.500 contratos", "—", "R$ 3.104,50"]);
  const sms = linhaDoItem(EXEMPLO.itens[2]);
  assert.match(sms.detalhe!, /inclui 311 respostas de clientes/);
  assert.equal(linhaDoItem(EXEMPLO.itens[5]).como, "Por e-mail · flat · mínimo R$ 50,00");
  assert.equal(linhaDoItem(EXEMPLO.itens[6]).item, "Complemento do mínimo · E-mail");
});

test("resumo por grupo bate com o total", () => {
  const s = montar(EXEMPLO);
  assert.deepEqual(s.resumo, [["Motor de decisão · Orquestração e Jornada", "R$ 3.722,50"],
    ["Mensageria · SMS, RCS e e-mail", "R$ 1.321,54"], ["Ajustes · descontos, créditos e cobranças extras", "- R$ 231,64"]]);
  assert.equal(s.total, "R$ 4.812,40");
  assert.equal(s.ciclo, "21/09 a 20/10/2026");
  assert.equal(s.frentes, "MotorCob + MotorCli");
  assert.deepEqual(s.ajustes[2], ["Cobrança extra · carga emergencial fora do horário", "R$ 36,72"]);
  assert.deepEqual(s.origens.cabecalho, ["Origem", "E-mail", "RCS", "SMS"]);
  assert.deepEqual(s.origens.linhas[1], ["Renegocia Outubro", "700", "648", "3.383"]);
  assert.equal(s.cliente[1], "CNPJ 11.222.333/0001-81");
});

test("e-mail com os dois PDFs separados e tudo escapado", () => {
  const s = montar({ ...EXEMPLO, cliente: { ...EXEMPLO.cliente, razao_social: "Alfa <b>&</b>" } });
  const { assunto, html } = emailFatura(s, "Alfa <b>&</b>", { demonstrativo: "https://x/d.pdf?t=1&u=2", boleto: "https://y/b.pdf", pagar: "https://motorcob.online/empresa/faturamento" });
  assert.equal(assunto, "Fatura MotorCX nº 1042 · ciclo 21/09 a 20/10/2026 · vence 25/10");
  assert.match(html, /Alfa &lt;b&gt;&amp;&lt;\/b&gt;/);
  assert.match(html, /Demonstrativo \(PDF\)/);
  assert.match(html, /Boleto \(PDF\)/);
  assert.match(html, /d\.pdf\?t=1&amp;u=2/);
  assert.doesNotMatch(emailFatura(s, "A", { demonstrativo: "https://x", boleto: null, pagar: "https://p" }).html, /Boleto \(PDF\)/);
});

test("lembretes de fatura vencida: assunto e o aviso do bloqueio", () => {
  const f = { numero: 812, ciclo: "09/2026", total: "R$ 4.812,90", vencimento: "20/10/2026", bloqueio: "29/10/2026" };
  const d1 = emailLembrete("d1", f, "Financeira <Horizonte>", "https://motorcob.online/empresa/faturamento");
  assert.equal(d1.assunto, "Fatura MotorCX nº 812 venceu em 20/10");
  assert.match(d1.html, /Financeira &lt;Horizonte&gt;/);
  assert.match(d1.html, /desconsidere/);
  assert.match(emailLembrete("d5", f, "X", "u").html, /Com 10 dias de atraso/);
  const d7 = emailLembrete("d7", f, "X", "u");
  assert.equal(d7.assunto, "Fatura MotorCX nº 812: o acesso será bloqueado em 3 dias");
  assert.match(d7.html, /até 29\/10\/2026/);
});

test("e-mail do acordo: parcelas, desconto, formas e a regra da quebra (tudo escapado)", () => {
  const a = { numero: 12, faturas: "agosto e setembro", valor_faturas: "R$ 4.190,40", ajuste: -190.4, ajuste_texto: "R$ 190,40",
    total: "R$ 4.000,00", formas: ["pix", "boleto"],
    parcelas: [{ rotulo: "1ª de 3", vencimento: "20/10/2026", valor: "R$ 1.333,34" }, { rotulo: "2ª de 3", vencimento: "20/11/2026", valor: "R$ 1.333,33" },
               { rotulo: "3ª de 3", vencimento: "20/12/2026", valor: "R$ 1.333,33" }] };
  const e = emailAcordo(a, "Alfa <Recuperação>", "https://motorcob.online/empresa/faturamento");
  assert.equal(e.assunto, "Acordo de pagamento registrado · 3 parcelas de R$ 1.333,33");
  assert.match(e.html, /com desconto de R\$ 190,40/);
  assert.match(e.html, /Pix ou boleto/);
  assert.match(e.html, /10 dias em atraso, o acordo é desfeito/);
  assert.match(e.html, /Alfa &lt;Recuperação&gt;/);
  assert.equal(emailAcordo({ ...a, ajuste: 0, parcelas: a.parcelas.slice(0, 1) }, "X", "u").assunto, "Acordo de pagamento registrado · 1 parcela de R$ 1.333,34");
  assert.match(emailAcordo({ ...a, ajuste: 50, ajuste_texto: "R$ 50,00" }, "X", "u").html, /com acréscimo de R\$ 50,00/);
});

test("lembrete da parcela: d1 e d5 com a data da quebra", () => {
  const p = { rotulo: "2ª de 3", acordo: 12, valor: "R$ 1.333,33", vencimento: "20/11/2026", quebra: "29/11/2026" };
  assert.equal(emailLembreteParcela("d1", p, "X", "u").assunto, "Parcela 2ª de 3 do acordo nº 12 venceu em 20/11");
  const d5 = emailLembreteParcela("d5", p, "X", "u");
  assert.equal(d5.assunto, "Parcela 2ª de 3 do acordo nº 12 vencida há 5 dias");
  assert.match(d5.html, /até 29\/11\/2026, o acordo é desfeito/);
});
