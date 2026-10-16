import { test } from "node:test";
import assert from "node:assert/strict";
import { emailResumo, linhas, numero, periodoTexto, validarPedido, variacao } from "./regras.ts";

const taxa = { funcao: "taxa", nome: "taxa_entrega", rotulo: "Taxa de entrega", sentido: "maior_melhor" as const };
const nao = { funcao: "somar", nome: "nao_entregues", rotulo: "Não entregues", sentido: "menor_melhor" as const };

test("pedido: só enviar_resumo com o envio", () => {
  assert.equal(validarPedido({ acao: "enviar_resumo", envio: 4 }).envio, 4);
  assert.equal(validarPedido({ acao: "enviar_resumo" }).erro, "envio inválido");
  assert.equal(validarPedido({ acao: "apagar", envio: 4 }).erro, "ação desconhecida");
});

test("números no formato brasileiro", () => {
  assert.equal(numero({ funcao: "somar", nome: "x" }, 148320), "148.320");
  assert.equal(numero(taxa, 93.9), "93,9%");
  assert.equal(numero({ funcao: "razao", nome: "c", rotulo: "Custo por CPC (R$)" }, 4.87), "R$ 4,87");
  assert.equal(numero({ funcao: "razao", nome: "a", rotulo: "Ações até o 1º CPC" }, 7.4), "7,40");
  assert.equal(numero(taxa, null), "—");
});

test("variação: pontos na taxa, % no resto, cor pelo sentido", () => {
  assert.deepEqual(variacao(taxa, 93.9, 92.3), { texto: "+1,6 pontos", bom: true });
  assert.deepEqual(variacao(taxa, 4.1, 5.1), { texto: "−1,0 ponto", bom: false });
  assert.deepEqual(variacao(nao, 9113, 10355), { texto: "−12%", bom: true });
  assert.deepEqual(variacao({ funcao: "somar", nome: "e" }, 112, 100), { texto: "+12%", bom: null });
  assert.deepEqual(variacao(nao, 10, 0), { texto: null, bom: null });
  assert.deepEqual(variacao(nao, 10, null), { texto: null, bom: null });
});

test("e-mail: período, até 6 números, link e tudo escapado", () => {
  const ms = Array.from({ length: 8 }, (_, i) => ({ funcao: "somar", nome: `m${i}`, rotulo: `M${i}` }));
  assert.equal(linhas(ms, {}, null).length, 6);
  assert.equal(periodoTexto("2026-10-05", "2026-10-11"), "05/10 a 11/10/2026");
  assert.equal(periodoTexto("2026-10-14", "2026-10-14"), "14/10/2026");
  const e = emailResumo({ nome: "Fechamento <semanal>", empresa: "Alfa & Cia", periodo: "05/10 a 11/10/2026",
    comparado: "a semana anterior", linhas: linhas([taxa, nao], { taxa_entrega: 93.9, nao_entregues: 9113 },
      { taxa_entrega: 92.3, nao_entregues: 10355 }), link: "https://motorcob.online/relatorios?modelo=3" });
  assert.equal(e.assunto, "Fechamento <semanal> · 05/10 a 11/10/2026");
  assert.match(e.html, /Fechamento &lt;semanal&gt;/);
  assert.match(e.html, /Alfa &amp; Cia/);
  assert.match(e.html, /93,9%/);
  assert.match(e.html, /9\.113/);
  assert.match(e.html, /relatorios\?modelo=3/);
  assert.doesNotMatch(e.html, /anexo/);
});
