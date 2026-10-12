// Chamadas ao Stripe e ao Focus NFe e gravação no banco, usadas pela função "cobranca" e pela "pagamentos-webhook".
// As chaves vêm só dos Secrets do Supabase (STRIPE_SECRET_KEY, FOCUSNFE_TOKEN) e nunca saem daqui.
import {
  type Alvo, checkoutCartao, clienteStripe, dadosCobranca, descricaoNota, type Empresa, FOCUS, faltaNaConfig, formStripe,
  type Gerada, lerGerada, lerNota, type NfConfig, notaFocus, paymentIntent, referenciaNota, STRIPE,
} from "./regras.ts";

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
  const { data: contatos } = await db.from("empresa_contatos").select("email, papel_contrato")
    .eq("empresa_id", empresaId).not("email", "is", null);
  const lista = (contatos ?? []) as { email: string; papel_contrato: string }[];
  const email = (lista.find((c) => c.papel_contrato === "financeiro") ?? lista[0])?.email ?? null;
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
      await db.from("faturas").update({ link_boleto: g.link, id_externo: g.id_externo }).eq("id", alvo.id);
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
