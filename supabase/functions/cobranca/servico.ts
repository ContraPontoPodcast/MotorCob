// Chamadas ao Stripe e ao Focus NFe e gravação no banco, usadas pela função "cobranca" e pela "pagamentos-webhook".
// As chaves vêm só dos Secrets do Supabase (STRIPE_SECRET_KEY, FOCUSNFE_TOKEN, LOCAWEB_TOKEN) e nunca saem daqui.
import {
  type Alvo, checkoutCartao, clienteStripe, type Contato, dadosCobranca, descricaoNota, destinatariosFatura, type Empresa,
  FOCUS, faltaNaConfig, formStripe,
  type Gerada, lerGerada, lerNota, type NfConfig, notaFocus, paymentIntent, pdfDoBoleto, referenciaNota, STRIPE,
} from "./regras.ts";
import { brl, type Dados, emailFatura, emailLembrete, montar } from "./demonstrativo.ts";
import { gerarPdf } from "./demonstrativo_pdf.ts";

// deno-lint-ignore no-explicit-any
type Banco = any;

export class ErroCobranca extends Error {}

const segredo = (nome: string) => {
  const v = Deno.env.get(nome);
  if (!v) throw new ErroCobranca(`integração ainda sem credencial: cadastre ${nome} nos Secrets do Supabase`);
  return v;
};

export async function stripe(caminho: string, corpo?: Record<string, unknown>, chaveIdem?: string) {
  const r = await fetch(`${STRIPE}${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${segredo("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(chaveIdem ? { "Idempotency-Key": chaveIdem } : {}),
    },
    body: corpo ? formStripe(corpo) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new ErroCobranca(`Stripe: ${j?.error?.message ?? r.status}`);
  return j;
}

async function focus(c: NfConfig, caminho: string, corpo?: unknown) {
  const r = await fetch(`${FOCUS[c.ambiente]}${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { Authorization: `Basic ${btoa(segredo("FOCUSNFE_TOKEN") + ":")}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(texto); } catch { j = { mensagem: texto.slice(0, 300) }; }
  return { status: r.status, corpo: j };
}

export async function empresaEContato(db: Banco, empresaId: number) {
  const { data: e } = await db.from("empresas")
    .select("id, nome, razao_social, cnpj, cep, logradouro, numero, complemento, bairro, municipio, uf, codigo_ibge")
    .eq("id", empresaId).single();
  const { data: contatos } = await db.from("empresa_contatos").select("email, papel_contrato, recebe_faturas")
    .eq("empresa_id", empresaId).not("email", "is", null);
  const lista = (contatos ?? []) as Contato[];
  const email = (lista.find((c) => c.recebe_faturas) ?? lista.find((c) => c.papel_contrato === "financeiro")
    ?? lista[0])?.email ?? null;
  return { empresa: e as Empresa, email };
}

/** Cliente da empresa no Stripe (cria na primeira cobrança). */
export async function clienteDa(db: Banco, empresa: Empresa, email: string | null) {
  const d = dadosCobranca(empresa, email);
  if (d.erro) throw new ErroCobranca(d.erro);
  const { data: c } = await db.from("cobranca_clientes").select("id_externo").eq("empresa_id", empresa.id).maybeSingle();
  if (c?.id_externo) return { cliente: c.id_externo as string, dados: d.dados! };
  const novo = await stripe("/customers", clienteStripe(empresa.id, d.dados!), `cliente-${empresa.id}`);
  await db.from("cobranca_clientes").upsert({ empresa_id: empresa.id, id_externo: novo.id });
  return { cliente: novo.id as string, dados: d.dados! };
}

/** Gera (ou reaproveita) o boleto, o Pix ou a página do cartão de uma fatura ou recarga. */
export async function gerarCobranca(db: Banco, alvo: Alvo, forma: "boleto" | "pix" | "cartao", opcoes:
  { voltar: string; guardarCartao?: boolean; hoje: string }) {
  const col = alvo.tipo === "fatura" ? "fatura_id" : "recarga_id";
  const { data: aberta } = await db.from("cobrancas").select("*").eq(col, alvo.id).eq("forma", forma)
    .eq("situacao", "pendente").gt("expira_em", new Date(Date.now() + 10 * 60000).toISOString())
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (aberta) return aberta;
  const { empresa, email } = await empresaEContato(db, alvo.empresa_id);
  const { cliente, dados } = await clienteDa(db, empresa, email);
  const { data: linha, error } = await db.from("cobrancas")
    .insert({ empresa_id: alvo.empresa_id, [col]: alvo.id, forma, valor: alvo.valor }).select("id").single();
  if (error) throw new ErroCobranca(`não foi possível registrar a cobrança: ${error.message}`);
  try {
    const obj = forma === "cartao"
      ? await stripe("/checkout/sessions", checkoutCartao(alvo, cliente, linha.id, opcoes.voltar, !!opcoes.guardarCartao), `cobranca-${linha.id}`)
      : await stripe("/payment_intents", paymentIntent(forma, alvo, cliente, linha.id, dados, opcoes.hoje), `cobranca-${linha.id}`);
    const g: Gerada = lerGerada(obj);
    const { data: final } = await db.from("cobrancas").update(g).eq("id", linha.id).select("*").single();
    if (alvo.tipo === "fatura" && forma === "boleto" && g.link) {
      await db.from("faturas").update({ link_boleto: g.link, id_externo: g.id_externo, boleto_pdf: pdfDoBoleto(obj) }).eq("id", alvo.id);
    }
    if (alvo.tipo === "recarga" && g.link) {
      await db.from("recargas").update({ link_pagamento: g.link, id_externo: g.id_externo, forma }).eq("id", alvo.id);
    }
    return final;
  } catch (e) {
    await db.from("cobrancas").update({ situacao: "falhou", motivo: String((e as Error).message).slice(0, 300) }).eq("id", linha.id);
    throw e;
  }
}

/** Guarda bandeira, final e validade do cartão usado no Checkout (para a recarga automática). */
export async function guardarCartao(db: Banco, paymentIntentId: string, empresaId: number) {
  const pi = await stripe(`/payment_intents/${paymentIntentId}?expand[]=payment_method`);
  const pm = pi.payment_method;
  if (!pm?.id || pm.type !== "card" || !pi.setup_future_usage) return;
  await db.from("cartoes_salvos").update({ padrao: false }).eq("empresa_id", empresaId);
  await db.from("cartoes_salvos").upsert({
    id_externo: pm.id, empresa_id: empresaId, padrao: true, bandeira: pm.card?.brand ?? null,
    final: pm.card?.last4 ?? null,
    validade: pm.card?.exp_month ? `${String(pm.card.exp_month).padStart(2, "0")}/${pm.card.exp_year}` : null,
  });
}

/** Preenche o código IBGE da cidade pelo CEP (ViaCEP), para a nota sair com o endereço do tomador. */
async function completarIbge(db: Banco, e: Empresa) {
  if (e.codigo_ibge || !e.cep) return e;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${String(e.cep).replace(/\D/g, "")}/json/`);
    const j = await r.json();
    const ibge = Number(j?.ibge);
    if (ibge >= 1000000 && ibge <= 9999999) {
      await db.from("empresas").update({ codigo_ibge: ibge }).eq("id", e.id);
      return { ...e, codigo_ibge: ibge };
    }
  } catch { /* sem o código, a nota sai só com CNPJ, razão social e e-mail do tomador */ }
  return e;
}

/** Emite a NFS-e de uma fatura ou recarga (se a nota estiver ligada). Devolve a linha de notas_fiscais ou null. */
export async function emitirNota(db: Banco, tipo: "fatura" | "recarga", id: number) {
  const { data: cfg } = await db.from("nf_config").select("*").eq("id", 1).single();
  const c = cfg as NfConfig;
  if (!c?.ativo) return null;
  const falta = faltaNaConfig(c);
  if (falta.length) throw new ErroCobranca(`Nota fiscal sem configuração: ${falta.join(", ")} (Console › Faturamento › Nota fiscal).`);
  const col = tipo === "fatura" ? "fatura_id" : "recarga_id";
  const { data: notas } = await db.from("notas_fiscais").select("id, situacao").eq(col, id);
  const lista = (notas ?? []) as { situacao: string }[];
  const ativa = lista.find((n) => n.situacao === "processando" || n.situacao === "autorizada");
  if (ativa) return ativa;
  let valor: number, empresaId: number, descricao: string;
  if (tipo === "fatura") {
    const { data: f } = await db.from("faturas").select("empresa_id, valor_total, competencia").eq("id", id).single();
    const { data: ciclo } = await db.rpc("ciclo_de", { empresa: f.empresa_id, competencia: f.competencia });
    valor = Number(f.valor_total); empresaId = f.empresa_id;
    descricao = descricaoNota(c.descricao_fatura, Array.isArray(ciclo) ? ciclo[0] : ciclo);
  } else {
    const { data: r } = await db.from("recargas").select("empresa_id, valor").eq("id", id).single();
    valor = Number(r.valor); empresaId = r.empresa_id; descricao = descricaoNota(c.descricao_recarga);
  }
  if (!(valor > 0)) return null;                                     // fatura zerada não gera nota
  const { empresa, email } = await empresaEContato(db, empresaId);
  if (!email) throw new ErroCobranca("Cadastre o e-mail do contato financeiro da empresa para emitir a nota.");
  const e = await completarIbge(db, empresa);
  const ref = referenciaNota(tipo, id, lista.length + 1);
  const { data: linha, error } = await db.from("notas_fiscais")
    .insert({ empresa_id: empresaId, [col]: id, referencia: ref, valor }).select("*").single();
  if (error) throw new ErroCobranca(`não foi possível registrar a nota: ${error.message}`);
  const r = await focus(c, `/nfsen?ref=${encodeURIComponent(ref)}`, notaFocus(c, e, email, valor, descricao, new Date()));
  if (r.status >= 300) {
    const msg = String(r.corpo.mensagem ?? r.corpo.codigo ?? `HTTP ${r.status}`).slice(0, 1000);
    await db.from("notas_fiscais").update({ situacao: "erro", mensagem: msg, atualizada_em: new Date().toISOString() }).eq("id", linha.id);
    return { ...linha, situacao: "erro", mensagem: msg };
  }
  return linha;
}

/** Consulta a nota no Focus NFe e grava a situação (chamado pelo webhook do Focus). */
export async function atualizarNota(db: Banco, ref: string) {
  const { data: cfg } = await db.from("nf_config").select("*").eq("id", 1).single();
  const r = await focus(cfg as NfConfig, `/nfsen/${encodeURIComponent(ref)}`);
  if (r.status !== 200) return null;
  const n = lerNota(r.corpo, FOCUS[(cfg as NfConfig).ambiente]);
  const { data: linha } = await db.from("notas_fiscais").update({ ...n, atualizada_em: new Date().toISOString() })
    .eq("referencia", ref).select("fatura_id").maybeSingle();
  if (n.situacao === "autorizada" && linha?.fatura_id && n.link_pdf) {
    await db.from("faturas").update({ link_nota_fiscal: n.link_pdf }).eq("id", linha.fatura_id);
  }
  return n;
}

// ---------------------------------------------------------------- demonstrativo e envio da fatura
const DIAS_LINK = 30;

/** Gera (ou regera) o demonstrativo em PDF no bucket privado e devolve o caminho. */
export async function salvarDemonstrativo(db: Banco, fatura: number) {
  const { data: d, error } = await db.rpc("demonstrativo_fatura", { fatura });
  if (error || !d) throw new ErroCobranca(`não foi possível montar o demonstrativo: ${error?.message ?? "sem dados"}`);
  const dados = d as Dados;
  const { data: f } = await db.from("faturas").select("empresa_id").eq("id", fatura).single();
  const caminho = `${f.empresa_id}/${fatura}.pdf`;
  const pdf = await gerarPdf(montar(dados));
  const { error: e2 } = await db.storage.from("faturas").upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (e2) throw new ErroCobranca(`não foi possível guardar o PDF: ${e2.message}`);
  await db.from("faturas").update({ demonstrativo: caminho }).eq("id", fatura);
  return { caminho, dados };
}

export async function linkDemonstrativo(db: Banco, caminho: string, dias = DIAS_LINK) {
  const { data, error } = await db.storage.from("faturas").createSignedUrl(caminho, dias * 86400);
  if (error || !data?.signedUrl) throw new ErroCobranca("não foi possível gerar o link do demonstrativo");
  return data.signedUrl as string;
}

/** E-mail pela API da Locaweb (a mesma conta do e-mail da Mensageria). */
export async function enviarEmail(para: string[], assunto: string, html: string, de?: string | null) {
  const remetente = Deno.env.get("FATURA_EMAIL_DE") || de;
  if (!remetente) throw new ErroCobranca("cadastre o remetente das faturas (FATURA_EMAIL_DE) nos Secrets do Supabase");
  const r = await fetch("https://api.smtplw.com.br/v1/messages", {
    method: "POST",
    headers: { "x-auth-token": segredo("LOCAWEB_TOKEN"), "Content-Type": "application/json" },
    body: JSON.stringify({ subject: assuntoAscii(assunto), body: html, to: para, from: remetente,
                           headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  if (!r.ok) throw new ErroCobranca(`e-mail recusado pela Locaweb (${r.status}): ${(await r.text()).slice(0, 150)}`);
}

const assuntoAscii = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s
  : "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + "?=";

/** Envio da fatura emitida: boleto (se a empresa aceita), nota na emissão (se configurado), demonstrativo e e-mail. */
export async function enviarFatura(db: Banco, fatura: number, site: string) {
  const { data: f } = await db.from("faturas")
    .select("id, empresa_id, situacao, valor_total, vencimento, competencia, boleto_pdf").eq("id", fatura).single();
  if (!f || !["aberta", "vencida"].includes(f.situacao)) throw new ErroCobranca("só fatura em aberto é enviada");
  const { data: c } = await db.from("ciclo_empresa").select("formas").eq("empresa_id", f.empresa_id).maybeSingle();
  const formas: string[] = c?.formas ?? ["boleto", "pix"];
  let boletoPdf: string | null = f.boleto_pdf;
  if (formas.includes("boleto") && Number(f.valor_total) >= 5 && !boletoPdf) {
    const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const alvo: Alvo = { tipo: "fatura", id: f.id, empresa_id: f.empresa_id, valor: Number(f.valor_total), vencimento: f.vencimento,
                         descricao: `Fatura MotorCX nº ${f.id}` };
    await gerarCobranca(db, alvo, "boleto", { voltar: `${site}/empresa/faturamento`, hoje });
    boletoPdf = (await db.from("faturas").select("boleto_pdf").eq("id", fatura).single()).data?.boleto_pdf ?? null;
  }
  const { data: cfg } = await db.from("nf_config").select("ativo, emitir_quando, email_financeiro").eq("id", 1).single();
  if (cfg?.ativo && cfg.emitir_quando === "emissao") {
    try { await emitirNota(db, "fatura", f.id); } catch (e) { console.error("nota", (e as Error).message); }
  }
  const { caminho, dados } = await salvarDemonstrativo(db, f.id);
  const { data: contatos } = await db.from("empresa_contatos").select("email, papel_contrato, recebe_faturas")
    .eq("empresa_id", f.empresa_id).not("email", "is", null);
  const para = destinatariosFatura((contatos ?? []) as Contato[]);
  if (!para.length) throw new ErroCobranca("Sem e-mail para a fatura: em Empresa › Contatos, marque \"Recebe faturas\"");
  const s = montar(dados);
  const { assunto, html } = emailFatura(s, dados.cliente.razao_social, {
    demonstrativo: await linkDemonstrativo(db, caminho), boleto: boletoPdf, pagar: `${site}/empresa/faturamento`,
  });
  await enviarEmail(para, assunto, html, cfg?.email_financeiro);
  await db.from("faturas").update({ envio: "enviado", envio_motivo: null, enviada_em: new Date().toISOString(),
                                    enviada_para: para.join(", ").slice(0, 500) }).eq("id", f.id);
  return { enviada_para: para };
}

/** Lembrete de fatura vencida (motor, uma vez por fatura e tipo). Fatura já paga não recebe nada. */
export async function lembrarFatura(db: Banco, fatura: number, tipo: "d1" | "d5" | "d7", site: string) {
  const { data: f } = await db.from("faturas")
    .select("id, empresa_id, situacao, valor_total, vencimento, competencia").eq("id", fatura).single();
  if (!f || f.situacao !== "aberta") return { pulou: "fatura não está em aberto" };
  const { data: contatos } = await db.from("empresa_contatos").select("email, papel_contrato, recebe_faturas")
    .eq("empresa_id", f.empresa_id).not("email", "is", null);
  const para = destinatariosFatura((contatos ?? []) as Contato[]);
  if (!para.length) throw new ErroCobranca("Sem e-mail para o lembrete: em Empresa › Contatos, marque \"Recebe faturas\"");
  const { data: emp } = await db.from("empresas").select("nome").eq("id", f.empresa_id).single();
  const { data: cfg } = await db.from("nf_config").select("email_financeiro").eq("id", 1).single();
  const br = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
  const bloqueio = new Date(new Date(`${String(f.vencimento).slice(0, 10)}T12:00:00Z`).getTime() + 9 * 86400000)
    .toISOString().slice(0, 10);
  const { assunto, html } = emailLembrete(tipo, {
    numero: f.id, ciclo: String(f.competencia).slice(0, 7).split("-").reverse().join("/"),
    total: brl(Number(f.valor_total)), vencimento: br(String(f.vencimento)), bloqueio: br(bloqueio),
  }, emp?.nome ?? "", `${site}/empresa/faturamento`);
  await enviarEmail(para, assunto, html, cfg?.email_financeiro);
  await db.from("fatura_lembretes").insert({ fatura_id: f.id, tipo, enviado_para: para.join(", ").slice(0, 500) });
  return { enviado_para: para };
}
