// Edge Function cobranca: gera o boleto, o Pix ou a página do cartão de uma fatura ou recarga (Stripe), dispara a
// cobrança da fatura emitida, emite a nota fiscal (Focus NFe) e faz a recarga automática no cartão guardado.
// * O site chama com o login do usuário; quem pode é decidido pelo banco (RLS de faturas e recargas, equipe_pode).
// * O motor chama com a chave do servidor: { acao: "recargas_automaticas" } de hora em hora e
//   { acao: "enviar_fatura", fatura } para cada fatura emitida (demonstrativo em PDF, boleto e e-mail).
// * { acao: "demonstrativo", fatura }: link do PDF para quem vê o faturamento da empresa (gera se ainda não existe).
// * Publicar com "Verify JWT" DESLIGADO (o login é conferido aqui dentro). Chaves só nos Secrets do Supabase:
//   STRIPE_SECRET_KEY e FOCUSNFE_TOKEN. Sem elas, a função responde que a integração está sem credencial.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type Alvo, cobrancaAutomatica, iguais, type Pedido, validarPedido } from "./regras.ts";
import { ErroCobranca, emitirNota, enviarFatura, gerarCobranca, lembrarFatura, linkDemonstrativo, salvarDemonstrativo, stripe } from "./servico.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const sem = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE, sem);
// deno-lint-ignore no-explicit-any
type Db = any;

function cabecalhos(origem: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem && ORIGENS.includes(origem) ? origem : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
const hojeSP = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

/** A chave do servidor (motor): só ela lê cobranca_clientes. */
async function ehServidor(token: string) {
  if (iguais(token, SERVICE)) return true;
  if (token.split(".").length === 3) return false;                       // login de usuário (JWT)
  const { error } = await createClient(SUPABASE_URL, token, sem).from("cobranca_clientes").select("empresa_id").limit(1);
  return !error;
}

async function alvoDe(db: Db, p: Pedido): Promise<Alvo & { situacao: string }> {
  if (p.fatura) {
    const { data: f } = await db.from("faturas_painel")
      .select("id, empresa_id, valor_total, ajustes_total, situacao_atual, vencimento, competencia").eq("id", p.fatura).maybeSingle();
    if (!f) throw new ErroCobranca("fatura não encontrada");
    const comp = String(f.competencia).slice(0, 7).split("-").reverse().join("/");
    return { tipo: "fatura", id: f.id, empresa_id: f.empresa_id, valor: Number(f.valor_total), situacao: f.situacao_atual,
             vencimento: f.vencimento, descricao: `Fatura MotorCX ${comp} (nº ${f.id})` };
  }
  const { data: r } = await db.from("recargas").select("id, empresa_id, valor, situacao").eq("id", p.recarga!).maybeSingle();
  if (!r) throw new ErroCobranca("recarga não encontrada");
  return { tipo: "recarga", id: r.id, empresa_id: r.empresa_id, valor: Number(r.valor), situacao: r.situacao,
           descricao: `Recarga de créditos MotorCX (nº ${r.id})` };
}

async function ciclo(empresa: number) {
  const { data } = await admin.from("ciclo_empresa").select("formas, recarga_automatica, modelo_pagamento")
    .eq("empresa_id", empresa).maybeSingle();
  return { formas: (data?.formas ?? ["boleto", "pix"]) as string[], recargaAutomatica: !!data?.recarga_automatica };
}

async function pagar(db: Db, p: Pedido) {
  const alvo = await alvoDe(db, p);                                       // RLS: só quem vê o faturamento da empresa
  if (alvo.tipo === "fatura" && !["aberta", "vencida"].includes(alvo.situacao)) throw new ErroCobranca("esta fatura não está em aberto");
  if (alvo.tipo === "recarga" && alvo.situacao !== "pendente") throw new ErroCobranca("esta recarga não está pendente");
  const c = await ciclo(alvo.empresa_id);
  if (!c.formas.includes(p.forma!)) throw new ErroCobranca("esta forma de pagamento não está liberada para a empresa");
  return await gerarCobranca(admin, alvo, p.forma!, {
    voltar: `${SITE}/empresa/faturamento`, guardarCartao: alvo.tipo === "recarga" && c.recargaAutomatica, hoje: hojeSP(),
  });
}

async function recargasAutomaticas() {
  const { data, error } = await admin.rpc("recargas_automaticas_pendentes");
  if (error) throw error;
  const feitas: unknown[] = [];
  for (const x of (data ?? []) as { empresa_id: number; valor: number; cartao: string | null }[]) {
    if (!x.cartao) { feitas.push({ empresa: x.empresa_id, erro: "sem cartão guardado" }); continue; }
    const db: Db = admin;
    const { data: cli } = await db.from("cobranca_clientes").select("id_externo").eq("empresa_id", x.empresa_id).maybeSingle();
    if (!cli) { feitas.push({ empresa: x.empresa_id, erro: "empresa ainda sem cliente no Stripe" }); continue; }
    const { data: r, error: e1 } = await db.from("recargas")
      .insert({ empresa_id: x.empresa_id, valor: x.valor, forma: "cartao", automatica: true, pedida_por: null }).select("id").single();
    if (e1 || !r) { feitas.push({ empresa: x.empresa_id, erro: e1?.message ?? "recarga não criada" }); continue; }
    const { data: cob, error: e2 } = await db.from("cobrancas")
      .insert({ empresa_id: x.empresa_id, recarga_id: r.id, forma: "cartao", valor: x.valor, automatica: true }).select("id").single();
    if (e2 || !cob) { feitas.push({ empresa: x.empresa_id, erro: e2?.message ?? "cobrança não criada" }); continue; }
    const alvo: Alvo = { tipo: "recarga", id: r.id, empresa_id: x.empresa_id, valor: Number(x.valor),
                         descricao: `Recarga automática MotorCX (nº ${r.id})` };
    try {
      const pi = await stripe("/payment_intents", cobrancaAutomatica(alvo, cli.id_externo, x.cartao, cob.id), `cobranca-${cob.id}`);
      await admin.from("cobrancas").update({ id_externo: pi.id }).eq("id", cob.id);
      if (pi.status === "succeeded") await admin.rpc("baixar_cobranca", { p_id_externo: pi.id });
      feitas.push({ empresa: x.empresa_id, recarga: r.id, situacao: pi.status });
    } catch (e) {
      const motivo = String((e as Error).message).slice(0, 300);
      await admin.from("cobrancas").update({ situacao: "falhou", motivo }).eq("id", cob.id);
      await admin.from("recargas").update({ situacao: "cancelada" }).eq("id", r.id);
      feitas.push({ empresa: x.empresa_id, recarga: r.id, erro: motivo });
    }
  }
  return feitas;
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");
  const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos(origem) });
  if (req.method !== "POST") return responder({ erro: "use POST" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({ erro: "entre no sistema para continuar" }, 401);
  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400); }
  const v = validarPedido(corpo);
  if (v.erro) return responder({ erro: v.erro }, 400);
  const p = v.pedido!;
  try {
    if (p.acao === "recargas_automaticas" || p.acao === "enviar_fatura" || p.acao === "lembrar_fatura") {
      if (!(await ehServidor(token))) return responder({ erro: "só o servidor faz esta ação" }, 403);
      if (p.acao === "recargas_automaticas") return responder({ recargas: await recargasAutomaticas() });
      if (p.acao === "lembrar_fatura") return responder(await lembrarFatura(admin, p.fatura!, p.tipo!, SITE));
      try {
        return responder(await enviarFatura(admin, p.fatura!, SITE));
      } catch (e) {
        const motivo = (e as Error).message.slice(0, 300);
        await admin.from("faturas").update({ envio: "erro", envio_motivo: motivo }).eq("id", p.fatura!);
        throw e;
      }
    }
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return responder({ erro: "sessão expirada: entre de novo" }, 401);
    const db = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${token}` } } });
    if (p.acao === "pagar") {
      // cliente: pagar e recarregar pedem "Pagar faturas" (Admin por padrão); a equipe com emitir_faturas também pode
      const { data: equipe } = await db.rpc("sou_equipe");
      const { data: podePagar } = await db.rpc("pode", { perm: "pagar_faturas" });
      if (!equipe && !podePagar) return responder({ erro: "só quem pode pagar faturas paga ou recarrega (Admin, por padrão)" }, 403);
      return responder({ cobranca: await pagar(db, p) });
    }

    if (p.acao === "demonstrativo") {
      const { data: f } = await db.from("faturas").select("id, situacao, demonstrativo").eq("id", p.fatura!).maybeSingle();
      if (!f || f.situacao === "rascunho") return responder({ erro: "fatura não encontrada" }, 404);   // RLS: só quem vê
      const caminho = f.demonstrativo ?? (await salvarDemonstrativo(admin, f.id)).caminho;
      return responder({ url: await linkDemonstrativo(admin, caminho, 1) });
    }
    const alvo = await alvoDe(db, p);
    const { data: pode } = await db.rpc("equipe_pode", { perm: "emitir_faturas", eid: alvo.empresa_id });
    if (!pode) return responder({ erro: "sem permissão para emitir a nota desta empresa" }, 403);
    if (alvo.situacao !== "paga" && alvo.tipo === "recarga") throw new ErroCobranca("a nota da recarga sai depois do pagamento");
    return responder({ nota: await emitirNota(admin, alvo.tipo, alvo.id) });
  } catch (e) {
    if (e instanceof ErroCobranca) return responder({ erro: e.message }, 422);
    console.error("cobranca", (e as Error).message);
    return responder({ erro: "não foi possível concluir agora; tente de novo em instantes" }, 500);
  }
});
