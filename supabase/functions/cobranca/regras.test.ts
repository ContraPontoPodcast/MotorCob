import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  acaoDoEvento, assinaturaStripeValida, checkoutCartao, clienteStripe, dadosCobranca, descricaoNota, diasBoleto,
  faltaNaConfig, formStripe, lerGerada, lerNota, type NfConfig, notaFocus, paymentIntent, referenciaNota, validarPedido,
} from "./regras.ts";

const empresa = { id: 7, nome: "Alfa Cobrança", razao_social: "Alfa Serviços de Cobrança Ltda", cnpj: "11.222.333/0001-81",
  cep: "01310-100", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista", municipio: "São Paulo", uf: "SP",
  codigo_ibge: 3550308 };

test("pedido: ações, alvo e forma", () => {
  assert.equal(validarPedido({ acao: "pagar", fatura: 3, forma: "pix" }).pedido?.forma, "pix");
  assert.match(validarPedido({ acao: "pagar", fatura: 3 }).erro!, /forma/);
  assert.match(validarPedido({ acao: "pagar", fatura: 3, recarga: 2, forma: "pix" }).erro!, /fatura ou a recarga/);
  assert.match(validarPedido({ acao: "pagar", forma: "pix" }).erro!, /fatura ou a recarga/);
  assert.match(validarPedido({ acao: "enviar_fatura" }).erro!, /fatura/);
  assert.match(validarPedido({ acao: "demonstrativo", recarga: 2 }).erro!, /fatura/);
  assert.equal(validarPedido({ acao: "enviar_fatura", fatura: 9 }).pedido?.fatura, 9);
  assert.match(validarPedido({ acao: "pagar", fatura: -1, forma: "pix" }).erro!, /inválida/);
  assert.ok(validarPedido({ acao: "recargas_automaticas" }).pedido);
  assert.match(validarPedido({ acao: "apagar" }).erro!, /desconhecida/);
});

test("form do Stripe com objetos e listas", () => {
  assert.equal(formStripe({ a: 1, b: { c: "x y", d: [5, 6] }, e: undefined }), "a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D=5&b%5Bd%5D%5B1%5D=6");
});

test("cadastro incompleto diz o que falta; completo vira dados sem acento", () => {
  assert.match(dadosCobranca({ id: 1, nome: "X" }, null).erro!, /CNPJ, endereço com CEP, e-mail do contato financeiro/);
  const d = dadosCobranca(empresa, "Financeiro@Alfa.com.br").dados!;
  assert.equal(d.cnpj, "11222333000181");
  assert.equal(d.email, "financeiro@alfa.com.br");
  assert.deepEqual(d.endereco, { line1: "Av. Paulista, 1000", city: "Sao Paulo", state: "SP", postal_code: "01310-100", country: "BR" });
  assert.equal(d.nome, "Alfa Servicos de Cobranca Ltda");
  assert.equal(clienteStripe(7, d).tax_id_data[0].value, "11.222.333/0001-81");
});

test("boleto vence junto com a fatura (1 a 60 dias)", () => {
  assert.equal(diasBoleto("2026-10-22", "2026-10-12"), 10);
  assert.equal(diasBoleto("2026-10-01", "2026-10-12"), 1);              // vencida: boleto para amanhã
  assert.equal(diasBoleto("2027-03-01", "2026-10-12"), 60);
  assert.equal(diasBoleto(null, "2026-10-12"), 3);
});

test("PaymentIntent de boleto e de Pix", () => {
  const d = dadosCobranca(empresa, "fin@alfa.com.br").dados!;
  const alvo = { tipo: "fatura" as const, id: 9, empresa_id: 7, valor: 1234.565, descricao: "Fatura", vencimento: "2026-10-22" };
  const b = paymentIntent("boleto", alvo, "cus_1", 55, d, "2026-10-12");
  assert.equal(b.amount, 123457);
  assert.deepEqual(b.payment_method_types, ["boleto"]);
  assert.equal(b.payment_method_data.boleto.tax_id, "11222333000181");
  assert.equal(b.payment_method_options.boleto.expires_after_days, 10);
  assert.deepEqual(b.metadata, { cobranca_id: "55", fatura_id: "9", empresa_id: "7" });
  const p = paymentIntent("pix", alvo, "cus_1", 56, d, "2026-10-12");
  assert.equal(p.payment_method_data.billing_details.tax_id, "11222333000181");
  assert.equal(p.payment_method_options.pix.expires_after_seconds, 86400);
  assert.match(formStripe(p), /payment_method_data%5Btype%5D=pix/);
});

test("cartão: Checkout, e guarda o cartão só se a recarga automática estiver ligada", () => {
  const alvo = { tipo: "recarga" as const, id: 4, empresa_id: 7, valor: 500, descricao: "Recarga" };
  const c = checkoutCartao(alvo, "cus_1", 60, "https://motorcob.online/empresa/faturamento", true);
  assert.equal(c.line_items[0].price_data.unit_amount, 50000);
  assert.equal(c.payment_intent_data.setup_future_usage, "off_session");
  assert.equal(c.success_url, "https://motorcob.online/empresa/faturamento?pagamento=ok");
  assert.equal("setup_future_usage" in checkoutCartao(alvo, "cus_1", 60, "https://x", false).payment_intent_data, false);
});

test("lê boleto, Pix e Checkout do que o Stripe devolve", () => {
  const b = lerGerada({ id: "pi_1", object: "payment_intent", next_action: { boleto_display_details:
    { hosted_voucher_url: "https://payments.stripe.com/boleto/x", number: "2379000", expires_at: 1792540800 } } });
  assert.deepEqual(b, { id_externo: "pi_1", link: "https://payments.stripe.com/boleto/x", pix_copia_cola: null,
    boleto_codigo: "2379000", expira_em: "2026-10-21T00:00:00.000Z" });
  const p = lerGerada({ id: "pi_2", next_action: { pix_display_qr_code: { data: "00020126", hosted_instructions_url: "https://p/x", expires_at: 1 } } });
  assert.equal(p.pix_copia_cola, "00020126");
  assert.equal(lerGerada({ id: "cs_1", object: "checkout.session", url: "javascript:x" }).link, null);
});

test("assinatura do Stripe: certa, errada, velha e sem cabeçalho", async () => {
  const corpo = '{"id":"evt_1"}', segredo = "whsec_teste", t = 1792000000;
  const v1 = createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex");
  assert.equal(await assinaturaStripeValida(corpo, `t=${t},v1=${v1}`, segredo, t + 10), true);
  assert.equal(await assinaturaStripeValida(corpo, `t=${t},v1=${"0".repeat(64)},v1=${v1}`, segredo, t), true);
  assert.equal(await assinaturaStripeValida(corpo + " ", `t=${t},v1=${v1}`, segredo, t), false);
  assert.equal(await assinaturaStripeValida(corpo, `t=${t},v1=${v1}`, segredo, t + 301), false);
  assert.equal(await assinaturaStripeValida(corpo, null, segredo, t), false);
  assert.equal(await assinaturaStripeValida(corpo, `t=${t},v1=${v1}`, "", t), false);
});

test("eventos do Stripe viram baixa, vencimento ou recusa", () => {
  assert.deepEqual(acaoDoEvento({ type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } }), { baixar: "pi_1" });
  assert.deepEqual(acaoDoEvento({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_9" } } }),
    { baixar: "cs_1", guardarCartao: "pi_9" });
  assert.deepEqual(acaoDoEvento({ type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "unpaid" } } }), {});
  assert.equal(acaoDoEvento({ type: "payment_intent.payment_failed", data: { object: { id: "pi_3", payment_method_types: ["boleto"] } } }).falhou?.situacao, "expirada");
  const r = acaoDoEvento({ type: "payment_intent.payment_failed", data: { object: { id: "pi_4", last_payment_error: { message: "saldo insuficiente", payment_method: { type: "card" } } } } });
  assert.equal(r.falhou?.motivo, "cartão recusado: saldo insuficiente");
  assert.deepEqual(acaoDoEvento({ type: "customer.created", data: { object: {} } }), {});
});

const cfg: NfConfig = { ativo: true, ambiente: "homologacao", emitir_quando: "pagamento", cnpj_prestador: "11.444.777/0001-61",
  inscricao_municipal_prestador: "1234567", codigo_municipio_emissora: 3550308, codigo_municipio_prestacao: 3550308,
  codigo_tributacao_nacional_iss: "010101", codigo_tributacao_municipal_iss: null, codigo_nbs: null,
  codigo_opcao_simples_nacional: 3, regime_tributario_simples_nacional: 1, regime_especial_tributacao: 0, tributacao_iss: 1,
  tipo_retencao_iss: 1, percentual_aliquota_iss: 2, descricao_fatura: "Uso da plataforma. Ciclo {ciclo}.", descricao_recarga: "Créditos." };

test("nota fiscal: o que falta na configuração e o corpo do Focus NFe", () => {
  assert.deepEqual(faltaNaConfig({ ...cfg, cnpj_prestador: null, regime_tributario_simples_nacional: null }),
    ["CNPJ do prestador", "regime de apuração do Simples"]);
  const n = notaFocus(cfg, empresa, "fin@alfa.com.br", 1500, "Uso", new Date("2026-10-12T15:00:00Z"));
  assert.equal(n.data_emissao, "2026-10-12T12:00:00-03:00");
  assert.equal(n.cnpj_prestador, "11444777000161");
  assert.equal(n.cnpj_tomador, "11222333000181");
  assert.equal(n.codigo_municipio_tomador, 3550308);
  assert.equal(n.percentual_aliquota_relativa_municipio, 2);
  assert.equal(n.valor_servico, 1500);
  assert.equal("codigo_tributacao_municipal_iss" in n, false);
  assert.equal(descricaoNota(cfg.descricao_fatura, { inicio: "2026-09-21", fim: "2026-10-20" }), "Uso da plataforma. Ciclo 21/09/2026 a 20/10/2026.");
  assert.equal(referenciaNota("fatura", 9, 1), "fatura-9");
  assert.equal(referenciaNota("recarga", 4, 2), "recarga-4-2");
});

test("lê a nota do Focus: autorizada com links e erro com a correção", () => {
  const a = lerNota({ status: "autorizado", numero: 123, url_danfse: "https://nfse.gov.br/danfse/x",
    caminho_xml_nota_fiscal: "/arquivos/x.xml" }, "https://homologacao.focusnfe.com.br/v2");
  assert.deepEqual(a, { situacao: "autorizada", numero: "123", link_pdf: "https://nfse.gov.br/danfse/x",
    link_xml: "https://homologacao.focusnfe.com.br/arquivos/x.xml", mensagem: null });
  const e = lerNota({ status: "erro_autorizacao", erros: [{ codigo: "E1", mensagem: "CNPJ inválido", correcao: "confira o tomador" }] }, "https://x.y/v2");
  assert.equal(e.situacao, "erro");
  assert.equal(e.mensagem, "CNPJ inválido — confira o tomador");
  assert.equal(lerNota({ status: "processando_autorizacao" }, "https://x.y/v2").situacao, "processando");
});
