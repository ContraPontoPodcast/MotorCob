// Chamadas ao Stripe e ao Focus NFe e gravação no banco, usadas pela função "cobranca" e pela "pagamentos-webhook".
// As chaves vêm só dos Secrets do Supabase (STRIPE_SECRET_KEY, FOCUSNFE_TOKEN, EMAIL_SISTEMA_TOKEN) e nunca saem daqui.
import { enviar, type Rodape } from "../_compartilhado/email.ts";
import {
  type Alvo, checkoutCartao, clienteStripe, type Contato, dadosCobranca, descricaoNota, type Empresa,
  FOCUS, faltaNaConfig, formStripe,
  type Gerada, lerGerada, lerNota, type NfConfig, notaFocus, paymentIntent, pdfDoBoleto, referenciaNota, rotuloParcela, STRIPE,
} from "./regras.ts";
import { brl, type Dados, emailAcordo, emailFatura, emailLembrete, emailLembreteParcela, montar } from "./demonstrativo.ts";
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
  const col = `${alvo.tipo}_id`;
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

/** Emite a NFS-e de uma fatura, recarga ou parcela de acordo (se a nota estiver ligada). Devolve a linha ou null. */
export async function emitirNota(db: Banco, tipo: "fatura" | "recarga" | "parcela", id: number) {
  const { data: cfg } = await db.from("nf_config").select("*").eq("id", 1).single();
  const c = cfg as NfConfig;
  if (!c?.ativo) return null;
  const falta = faltaNaConfig(c);
  if (falta.length) throw new ErroCobranca(`Nota fiscal sem configuração: ${falta.join(", ")} (Console › Faturamento › Nota fiscal).`);
  const col = `${tipo}_id`;
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
  } else if (tipo === "parcela") {
    const { data: p } = await db.from("acordo_parcelas").select("acordo_id, empresa_id, numero, tipo, valor").eq("id", id).single();
    // fatura do acordo que já teve nota (nota na emissão): a parcela não gera outra
    const { data: fs } = await db.from("faturas").select("id").eq("acordo_id", p.acordo_id);
    const ids = ((fs ?? []) as { id: number }[]).map((f) => f.id);
    if (ids.length) {
      const { data: ja } = await db.from("notas_fiscais").select("id").in("fatura_id", ids).in("situacao", ["processando", "autorizada"]).limit(1);
      if ((ja ?? []).length) return null;
    }
    const { data: a } = await db.from("acordos_fatura").select("parcelas").eq("id", p.acordo_id).single();
    valor = Number(p.valor); empresaId = p.empresa_id;
    descricao = descricaoNota(c.descricao_parcela ?? "Parcela {parcela} do acordo de pagamento nº {acordo}.", null,
      { rotulo: rotuloParcela(p.numero, a?.parcelas ?? p.numero, p.tipo), acordo: p.acordo_id });
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
    .eq("referencia", ref).select("fatura_id, parcela_id").maybeSingle();
  if (n.situacao === "autorizada" && linha?.fatura_id && n.link_pdf) {
    await db.from("faturas").update({ link_nota_fiscal: n.link_pdf }).eq("id", linha.fatura_id);
  }
  if (n.situacao === "autorizada" && linha?.parcela_id && n.link_pdf) {
    await db.from("acordo_parcelas").update({ link_nota_fiscal: n.link_pdf }).eq("id", linha.parcela_id);
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

export interface Destino { email: string; contato_id: number | null; usuario_id: string | null }

/** Rodapé dos e-mails (razão social, CNPJ, endereço e domínio dos remetentes, SQL 42). */
export async function rodapeEmail(db: Banco): Promise<Rodape | null> {
  const { data } = await db.rpc("email_rodape");
  return (data ?? null) as Rodape | null;
}

/** Para quem vai a fatura (SQL 42): contatos que recebem faturas e cujo e-mail não voltou; sem nenhum, os Admins
 * da empresa (e a equipe é avisada). */
async function destinatarios(db: Banco, empresaId: number, oQue: string): Promise<Destino[]> {
  const { data, error } = await db.rpc("emails_fatura", { empresa: empresaId });
  if (error) throw new ErroCobranca(`destinatários de ${oQue}: ${error.message}`);
  const lista = (data ?? []) as Destino[];
  if (!lista.length) throw new ErroCobranca(`Sem e-mail para ${oQue}: cadastre em Empresa › Contatos e marque "Recebe faturas"`);
  return lista;
}

/** Um e-mail por destinatário pela conta de envio do sistema (remetente financeiro@), cada um registrado em
 * emails_sistema (as devoluções voltam por lá). Erro só quando nenhum saiu. */
export async function enviarEmail(db: Banco, destinos: Destino[], tipo: string, empresa: number, assunto: string, html: string,
                                  rodape: Rodape | null) {
  const saiu: string[] = [];
  let ultimo = "";
  for (const d of destinos) {
    let provedor: string | null = null, erro: string | null = null;
    try {
      provedor = (await enviar({ de: "financeiro", para: d.email, assunto, html, dominio: rodape?.dominio })).id;
      saiu.push(d.email);
    } catch (e) {
      erro = ultimo = String((e as Error).message).slice(0, 300);
    }
    await db.rpc("registrar_email_sistema", { empresa, tipo, titulo: assunto, remetente: "financeiro", destino: d.email,
      usuario: d.usuario_id, contato: d.contato_id, aviso: null, provedor, erro });
  }
  if (!saiu.length) throw new ErroCobranca(ultimo || "nenhum e-mail saiu");
  return saiu;
}

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
  const { data: cfg } = await db.from("nf_config").select("ativo, emitir_quando").eq("id", 1).single();
  if (cfg?.ativo && cfg.emitir_quando === "emissao") {
    try { await emitirNota(db, "fatura", f.id); } catch (e) { console.error("nota", (e as Error).message); }
  }
  const { caminho, dados } = await salvarDemonstrativo(db, f.id);
  const destinos = await destinatarios(db, f.empresa_id, "a fatura");
  const s = montar(dados);
  const rodape = await rodapeEmail(db);
  const { assunto, html } = emailFatura(s, dados.cliente.razao_social, {
    demonstrativo: await linkDemonstrativo(db, caminho), boleto: boletoPdf, pagar: `${site}/empresa/faturamento`,
  }, null, rodape);
  const para = await enviarEmail(db, destinos, "fatura", f.empresa_id, assunto, html, rodape);
  await db.from("faturas").update({ envio: "enviado", envio_motivo: null, enviada_em: new Date().toISOString(),
                                    enviada_para: para.join(", ").slice(0, 500) }).eq("id", f.id);
  return { enviada_para: para };
}

/** Lembrete de fatura vencida (motor, uma vez por fatura e tipo). Fatura já paga não recebe nada. */
export async function lembrarFatura(db: Banco, fatura: number, tipo: "d1" | "d5" | "d7", site: string) {
  const { data: f } = await db.from("faturas")
    .select("id, empresa_id, situacao, valor_total, vencimento, competencia, acordo_id").eq("id", fatura).single();
  if (!f || f.situacao !== "aberta") return { pulou: "fatura não está em aberto" };
  if (f.acordo_id) return { pulou: "fatura está em acordo de pagamento" };
  const destinos = await destinatarios(db, f.empresa_id, "o lembrete");
  const { data: emp } = await db.from("empresas").select("nome").eq("id", f.empresa_id).single();
  const rodape = await rodapeEmail(db);
  const br = (d: string) => d.slice(0, 10).split("-").reverse().join("/");
  const bloqueio = new Date(new Date(`${String(f.vencimento).slice(0, 10)}T12:00:00Z`).getTime() + 9 * 86400000)
    .toISOString().slice(0, 10);
  const { assunto, html } = emailLembrete(tipo, {
    numero: f.id, ciclo: String(f.competencia).slice(0, 7).split("-").reverse().join("/"),
    total: brl(Number(f.valor_total)), vencimento: br(String(f.vencimento)), bloqueio: br(bloqueio),
  }, emp?.nome ?? "", `${site}/empresa/faturamento`, rodape);
  const para = await enviarEmail(db, destinos, "lembrete_fatura", f.empresa_id, assunto, html, rodape);
  await db.from("fatura_lembretes").insert({ fatura_id: f.id, tipo, enviado_para: para.join(", ").slice(0, 500) });
  return { enviado_para: para };
}

// ---------------------------------------------------------------- acordo de pagamento (SQL 38)
const br = (d: string) => String(d).slice(0, 10).split("-").reverse().join("/");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "agosto e setembro" (mesmo ano) ou "12/2025 e 01/2026". */
export function nomesCompetencias(comps: string[]): string {
  const anos = new Set(comps.map((c) => c.slice(0, 4)));
  const nomes = comps.map((c) => anos.size === 1 ? MESES[Number(c.slice(5, 7)) - 1] : `${c.slice(5, 7)}/${c.slice(0, 4)}`);
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : (nomes[0] ?? "");
}

/** "Informar o cliente": e-mail do acordo para quem recebe faturas (uma vez; o motor reenvia o que faltou). */
export async function informarAcordo(db: Banco, acordo: number, site: string) {
  const { data: a } = await db.from("acordos_fatura")
    .select("id, empresa_id, situacao, valor_faturas, ajuste, valor_total, formas, informado_em").eq("id", acordo).maybeSingle();
  if (!a || a.situacao !== "ativo") return { pulou: "acordo não está em andamento" };
  if (a.informado_em) return { pulou: "cliente já informado" };
  const destinos = await destinatarios(db, a.empresa_id, "o acordo");
  const { data: ps } = await db.from("acordo_parcelas").select("numero, tipo, vencimento, valor")
    .eq("acordo_id", a.id).neq("situacao", "cancelada").order("numero");
  const { data: fs } = await db.from("faturas").select("competencia").eq("acordo_id", a.id).order("competencia");
  const { data: emp } = await db.from("empresas").select("nome").eq("id", a.empresa_id).single();
  const rodape = await rodapeEmail(db);
  const lista = (ps ?? []) as { numero: number; tipo: string; vencimento: string; valor: number }[];
  const { assunto, html } = emailAcordo({
    numero: a.id, faturas: nomesCompetencias(((fs ?? []) as { competencia: string }[]).map((f) => String(f.competencia))),
    valor_faturas: brl(Number(a.valor_faturas)), ajuste: Number(a.ajuste), ajuste_texto: brl(Math.abs(Number(a.ajuste))),
    total: brl(Number(a.valor_total)), formas: a.formas ?? [],
    parcelas: lista.map((p) => ({ rotulo: rotuloParcela(p.numero, lista.length, p.tipo), vencimento: br(p.vencimento), valor: brl(Number(p.valor)) })),
  }, emp?.nome ?? "", `${site}/empresa/faturamento`, rodape);
  const para = await enviarEmail(db, destinos, "acordo", a.empresa_id, assunto, html, rodape);
  await db.from("acordos_fatura").update({ informado_em: new Date().toISOString(), informado_para: para.join(", ").slice(0, 500) })
    .eq("id", a.id);
  return { enviado_para: para };
}

/** Lembrete da parcela vencida (motor, uma vez por parcela e tipo). Parcela paga ou acordo encerrado não recebe nada. */
export async function lembrarParcela(db: Banco, parcela: number, tipo: "d1" | "d5", site: string) {
  const { data: p } = await db.from("acordo_parcelas")
    .select("id, acordo_id, empresa_id, numero, tipo, situacao, valor, vencimento").eq("id", parcela).maybeSingle();
  if (!p || p.situacao !== "aberta") return { pulou: "parcela não está em aberto" };
  const { data: a } = await db.from("acordos_fatura").select("situacao, parcelas").eq("id", p.acordo_id).single();
  if (a?.situacao !== "ativo") return { pulou: "acordo não está em andamento" };
  const destinos = await destinatarios(db, p.empresa_id, "o lembrete");
  const { data: emp } = await db.from("empresas").select("nome").eq("id", p.empresa_id).single();
  const rodape = await rodapeEmail(db);
  const quebra = new Date(new Date(`${String(p.vencimento).slice(0, 10)}T12:00:00Z`).getTime() + 9 * 86400000).toISOString().slice(0, 10);
  const { assunto, html } = emailLembreteParcela(tipo, {
    rotulo: rotuloParcela(p.numero, a.parcelas, p.tipo), acordo: p.acordo_id, valor: brl(Number(p.valor)),
    vencimento: br(p.vencimento), quebra: br(quebra),
  }, emp?.nome ?? "", `${site}/empresa/faturamento`, rodape);
  const para = await enviarEmail(db, destinos, "lembrete_parcela", p.empresa_id, assunto, html, rodape);
  await db.from("parcela_lembretes").insert({ parcela_id: p.id, tipo, enviado_para: para.join(", ").slice(0, 500) });
  return { enviado_para: para };
}
