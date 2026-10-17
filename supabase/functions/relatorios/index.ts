// Edge Function relatorios: e-mail do relatório agendado (SQL 39). Só o servidor chama (motor, a cada 10 minutos):
// { acao: "enviar_resumo", envio }. Roda o relatório salvo no período (ontem, a semana ou o mês passado) e no
// anterior, manda os números do topo e um link para quem ainda pode ver e marca o próximo envio.
// * Publicar com "Verify JWT" DESLIGADO. Sai pela conta de envio do sistema (EMAIL_SISTEMA_TOKEN), remetente
//   relatorios@ do domínio (SQL 42), um e-mail por pessoa com o link "Sair desta lista" (EMAIL_LINK_SEGREDO).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { iguais } from "../cobranca/regras.ts";
import { enviar, linksSair, type Rodape } from "../_compartilhado/email.ts";
import { emailResumo, linhas, type Metrica, periodoTexto, validarEnvio } from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const SEGREDO = Deno.env.get("EMAIL_LINK_SEGREDO") ?? "";
const sem = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE, sem);
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function ehServidor(token: string) {
  if (iguais(token, SERVICE)) return true;
  if (token.split(".").length === 3) return false;
  const { error } = await createClient(SUPABASE_URL, token, sem).from("relatorio_envios").select("id").limit(1);
  return !error;
}

async function total(base: string, filtros: Record<string, unknown>, metricas: Metrica[] | null) {
  if (!metricas?.length) {
    const { data, error } = await admin.rpc("contar_relatorio", { base, filtros });
    if (error) throw new Error(error.message);
    return { linhas: data };
  }
  const { data, error } = await admin.rpc("rodar_relatorio", { base, filtros, metricas, limite: 1 });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] ?? {}) as Record<string, unknown>;
}

async function enviarResumo(id: number) {
  const { data: e } = await admin.from("relatorio_envios").select("*").eq("id", id).maybeSingle();
  if (!e) return { pulou: "envio não encontrado" };
  const { data: m } = await admin.from("relatorios_modelos").select("*").eq("id", e.modelo_id).single();
  const { data: emp } = await admin.from("empresas").select("nome").eq("id", e.empresa_id).single();
  const { data: per } = await admin.rpc("periodo_envio_relatorio", { frequencia: e.frequencia });
  const p = (Array.isArray(per) ? per[0] : per) as { de: string; ate: string; ant_de: string; ant_ate: string };
  const { data: dest } = await admin.rpc("destinatarios_relatorio", { envio: id });
  const pessoas = ((dest ?? []) as { usuario: string; email: string | null }[]).filter((d) => !!d.email);
  if (!pessoas.length) {
    await admin.rpc("marcar_envio_relatorio", { envio: id, erro: "ninguém da lista pode receber este relatório" });
    return { pulou: "sem destinatário" };
  }
  const metricas = (m.metricas ?? null) as Metrica[] | null;
  const base = { ...(m.filtros ?? {}), empresa: e.empresa_id };
  const atual = await total(m.base, { ...base, de: p.de, ate: p.ate }, metricas);
  const anterior = await total(m.base, { ...base, de: p.ant_de, ate: p.ant_ate }, metricas);
  const ls = linhas(metricas?.length ? metricas : [{ funcao: "contar", nome: "linhas", rotulo: "Linhas" }], atual, anterior);
  const comparado = { dia: "o dia anterior", semana: "a semana anterior", mes: "o mês anterior" }[e.frequencia as string] ?? "o período anterior";
  const { data: rod } = await admin.rpc("email_rodape");
  const rodape = (rod ?? null) as Rodape | null;
  const para: string[] = [];
  let ultimo = "";
  for (const d of pessoas) {
    const sair = SEGREDO ? await linksSair(SEGREDO, SITE, `${SUPABASE_URL}/functions/v1`, d.usuario, `relatorio:${id}`) : null;
    const { assunto, html } = emailResumo({ nome: m.nome, empresa: emp?.nome ?? "", periodo: periodoTexto(p.de, p.ate),
      comparado, linhas: ls, link: `${SITE}/relatorios?modelo=${m.id}`, sair: sair?.pagina ?? null, rodape });
    let provedor: string | null = null, erro: string | null = null;
    try {
      provedor = (await enviar({ de: "relatorios", para: d.email!, assunto, html, dominio: rodape?.dominio,
                                 responderPara: rodape?.email_suporte ?? null, umClique: sair?.umClique ?? null })).id;
      para.push(d.email!);
    } catch (e) {
      erro = ultimo = String((e as Error).message).slice(0, 300);
    }
    await admin.rpc("registrar_email_sistema", { empresa: e.empresa_id, tipo: "relatorio", titulo: assunto, remetente: "relatorios",
      destino: d.email, usuario: d.usuario, contato: null, aviso: null, provedor, erro });
  }
  if (!para.length) throw new Error(ultimo || "nenhum e-mail saiu");
  await admin.rpc("marcar_envio_relatorio", { envio: id, erro: null });
  return { enviado_para: para };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !(await ehServidor(token))) return json({ erro: "só o servidor faz esta ação" }, 403);
  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ erro: "pedido inválido" }, 400); }
  const v = validarEnvio(corpo);
  if (v.erro) return json({ erro: v.erro }, 400);
  try {
    return json(await enviarResumo(v.envio!));
  } catch (e) {
    const motivo = String((e as Error).message).slice(0, 300);
    await admin.rpc("marcar_envio_relatorio", { envio: v.envio, erro: motivo });
    console.error("relatorios", motivo);
    return json({ erro: "não foi possível enviar agora" }, 500);
  }
});
