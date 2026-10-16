// Edge Function pagamentos-webhook: recebe os avisos do Stripe (pagamento feito, boleto/Pix vencido, cartão recusado)
// e do Focus NFe (nota autorizada ou com erro) e dá baixa sozinha.
// * Publicar com "Verify JWT" DESLIGADO: quem chama é o Stripe/Focus. Cada aviso é conferido:
//   - /stripe: assinatura Stripe-Signature com STRIPE_WEBHOOK_SECRET (whsec_...);
//   - /focusnfe: cabeçalho Authorization igual a FOCUSNFE_WEBHOOK_TOKEN (o mesmo valor cadastrado no gatilho).
// * O mesmo aviso repetido não faz nada (cobranca_eventos). Pago: fatura "paga", recarga no saldo ou parcela de acordo
//   paga (o banco quita o acordo quando é a última), e a nota fiscal sai se estiver ligada para "no pagamento".
import { createClient } from "jsr:@supabase/supabase-js@2";
import { acaoDoEvento, assinaturaStripeValida, iguais } from "../cobranca/regras.ts";
import { atualizarNota, emitirNota, guardarCartao } from "../cobranca/servico.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } });
const ok = (corpo: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Primeira vez que este aviso chega? (grava o id; repetido devolve false) */
async function novo(id: string, provedor: "stripe" | "focusnfe", tipo: string) {
  const { error } = await admin.from("cobranca_eventos").insert({ id, provedor, tipo: tipo.slice(0, 100) });
  return !error;
}

async function receberStripe(req: Request) {
  const corpo = await req.text();
  if (!(await assinaturaStripeValida(corpo, req.headers.get("Stripe-Signature"), Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? ""))) {
    return ok({ erro: "assinatura inválida" }, 400);
  }
  const ev = JSON.parse(corpo);
  if (!(await novo(`stripe:${ev.id}`, "stripe", ev.type))) return ok({ repetido: true });
  const a = acaoDoEvento(ev);
  try {
    if (a.falhou) {
      await admin.from("cobrancas").update({ situacao: a.falhou.situacao, motivo: a.falhou.motivo })
        .eq("id_externo", a.falhou.id).eq("situacao", "pendente");
      const { data: c } = await admin.from("cobrancas").select("recarga_id, automatica").eq("id_externo", a.falhou.id).maybeSingle();
      if (c?.automatica && c.recarga_id) {                    // recarga automática recusada: libera a próxima tentativa
        await admin.from("recargas").update({ situacao: "cancelada" }).eq("id", c.recarga_id).eq("situacao", "pendente");
      }
    }
    if (a.baixar) {
      const quando = ev.created ? new Date(ev.created * 1000).toISOString() : new Date().toISOString();
      const { data } = await admin.rpc("baixar_cobranca", { p_id_externo: a.baixar, p_pago_em: quando });
      const b = (data ?? [])[0];
      if (b && a.guardarCartao) await guardarCartao(admin, a.guardarCartao, b.empresa_id);
      if (b?.baixou) {
        const { data: cfg } = await admin.from("nf_config").select("ativo, emitir_quando").eq("id", 1).single();
        let tipo: "fatura" | "recarga" | "parcela" = b.fatura_id ? "fatura" : "recarga";
        let id = b.fatura_id ?? b.recarga_id;
        if (!id) {                                              // parcela de acordo (SQL 38)
          const { data: c } = await admin.from("cobrancas").select("parcela_id").eq("id_externo", a.baixar).maybeSingle();
          tipo = "parcela"; id = c?.parcela_id;
        }
        if (id && cfg?.ativo && (cfg.emitir_quando === "pagamento" || tipo === "recarga")) {
          try { await emitirNota(admin, tipo, id); }
          catch (e) { console.error("nota", (e as Error).message); }    // a equipe reemite em Faturamento
        }
      }
    }
  } catch (e) {
    await admin.from("cobranca_eventos").delete().eq("id", `stripe:${ev.id}`);   // o Stripe tenta de novo
    console.error("stripe-webhook", (e as Error).message);
    return ok({ erro: "falha ao processar" }, 500);
  }
  return ok();
}

async function receberFocus(req: Request) {
  const esperado = Deno.env.get("FOCUSNFE_WEBHOOK_TOKEN") ?? "";
  if (!esperado || !iguais(req.headers.get("Authorization") ?? "", esperado)) return ok({ erro: "não autorizado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const ref = typeof corpo?.ref === "string" && /^[a-z0-9_-]{3,60}$/.test(corpo.ref) ? corpo.ref : null;
  if (!ref) return ok({ ignorado: true });
  await atualizarNota(admin, ref);                            // consulta no Focus: a resposta oficial vale, não o aviso
  return ok();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ erro: "use POST" }, 405);
  const caminho = new URL(req.url).pathname;
  if (caminho.endsWith("/stripe")) return await receberStripe(req);
  if (caminho.endsWith("/focusnfe")) return await receberFocus(req);
  return ok({ erro: "rota não encontrada: /stripe ou /focusnfe" }, 404);
});
