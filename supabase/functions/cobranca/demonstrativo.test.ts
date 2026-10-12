import { test } from "node:test";
import assert from "node:assert/strict";
import { brl, detalheFaixas, emailFatura, linhaDoItem, montar } from "./demonstrativo.ts";
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
