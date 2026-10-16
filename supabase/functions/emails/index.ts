// Edge Function emails (SQL 42): os e-mails do sistema que não são fatura nem relatório.
// * POST { acao: "avisos" } — só o servidor (motor, a cada 10 minutos): pega a fila dos avisos do sino que viram
//   e-mail (obrigatórios e os ligados pela pessoa) e manda um e-mail por destinatário, no modelo único.
// * POST /emails/retorno?t=<EMAIL_RETORNO_TOKEN> — webhook da conta de envio do sistema na Locaweb (devolução e
//   abertura). Contato de fatura que volta fica marcado e os Admins são avisados.
// * POST { acao: "sair", u, a, t } ou POST /emails/sair?u&a&t (um clique do programa de e-mail) — desliga o e-mail
//   opcional ou tira a pessoa da lista do relatório, sem login, com o link assinado. GET só confere o link.
// * POST { acao: "teste", tipo } — Master logado: manda um exemplo (dados fictícios) para o próprio e-mail.
// Publicar com "Verify JWT" DESLIGADO (webhook e link de sair não têm login). Secrets: EMAIL_SISTEMA_TOKEN,
// EMAIL_LINK_SEGREDO, EMAIL_RETORNO_TOKEN, SITE_URL, ORIGENS_PERMITIDAS. Nenhum endereço de e-mail vai para o log.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { conferirAssinatura, enviar, linksSair, type Rodape } from "../_compartilhado/email.ts";
import { iguais, lerCorpo, locaweb } from "../retorno-mensageria/regras.ts";
import { emailAviso, exemplo, type LinhaFila, opcional, validarPedido, validarSair } from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const FUNCOES = `${SUPABASE_URL}/functions/v1`;
const SEGREDO = Deno.env.get("EMAIL_LINK_SEGREDO") ?? "";
const RETORNO = Deno.env.get("EMAIL_RETORNO_TOKEN") ?? "";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const sem = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE, sem);

function responder(corpo: unknown, status = 200, origem: string | null = null) {
  return new Response(JSON.stringify(corpo), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origem && ORIGENS.includes(origem) ? origem : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" } });
}

async function rodape(): Promise<Rodape | null> {
  const { data } = await admin.rpc("email_rodape");
  return (data ?? null) as Rodape | null;
}

async function ehServidor(token: string) {
  if (iguais(token, SERVICE)) return true;
  if (token.split(".").length === 3) return false;               // JWT de usuário não é servidor
  const { error } = await createClient(SUPABASE_URL, token, sem).from("emails_sistema").select("id").limit(1);
  return !error;
}

async function filaDeAvisos() {
  const { data, error } = await admin.rpc("avisos_para_email", { limite: 200 });
  if (error) throw new Error(error.message);
  const fila = (data ?? []) as LinhaFila[];
  if (!fila.length) return { enviados: 0, erros: 0 };
  const r = await rodape();
  let enviados = 0, erros = 0;
  for (const l of fila) {
    let sair: { pagina: string; umClique: string } | null = null;
    if (opcional(l) && SEGREDO) sair = await linksSair(SEGREDO, SITE, FUNCOES, l.usuario_id!, l.assunto);
    const { assunto, html } = emailAviso(l, SITE, r, sair?.pagina ?? null);
    let provedor: string | null = null, erro: string | null = null;
    try {
      provedor = (await enviar({ de: l.remetente, para: l.destino, assunto, html, dominio: r?.dominio,
        responderPara: l.remetente === "financeiro" ? null : r?.email_suporte ?? null, umClique: sair?.umClique ?? null })).id;
      enviados++;
    } catch (e) {
      erro = String((e as Error).message).slice(0, 300);
      erros++;
    }
    await admin.rpc("registrar_email_sistema", { empresa: l.empresa_id, tipo: l.assunto, titulo: assunto, remetente: l.remetente,
      destino: l.destino, usuario: l.usuario_id, contato: l.contato_id, aviso: l.aviso_id, provedor, erro });
  }
  if (erros) console.error("emails", `${erros} aviso(s) não saíram`);
  return { enviados, erros };
}

async function retorno(req: Request, url: URL) {
  const token = url.searchParams.get("t") ?? req.headers.get("x-retorno-token") ?? "";
  if (!RETORNO || !iguais(token, RETORNO)) return responder({ erro: "não autorizado" }, 401);
  if (req.method === "GET") return responder({ ok: true });                 // teste do endereço no painel
  const texto = await req.text();
  if (texto.length > 1_000_000) return responder({ erro: "aviso grande demais" }, 413);
  const eventos = locaweb(lerCorpo(texto, req.headers.get("Content-Type")));
  let aplicados = 0;
  for (const e of eventos) {
    const { error } = await admin.rpc("aplicar_retorno_email", { provedor: e.id_externo, evento: e.tipo,
      bounce: e.bounce ?? null, motivo: e.motivo ?? null });
    if (error) {
      console.error("emails retorno", error.message);
      return responder({ erro: "falha ao gravar" }, 500);                  // a Locaweb tenta de novo
    }
    aplicados++;
  }
  return responder({ recebidos: aplicados });
}

async function sair(u: string, a: string, t: string, aplicar: boolean, origem: string | null) {
  if (!(await conferirAssinatura(SEGREDO, u, a, t))) return responder({ erro: "link inválido ou de outro e-mail" }, 400, origem);
  if (!aplicar) return responder({ valido: true }, 200, origem);
  const { data, error } = await admin.rpc("sair_email", { usuario: u, assunto: a });
  if (error) return responder({ erro: "não foi possível agora; tente de novo" }, 500, origem);
  return responder({ mensagem: data }, 200, origem);
}

async function teste(req: Request, tipo: Parameters<typeof exemplo>[0], origem: string | null) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return responder({ erro: "faça login" }, 401, origem);
  const usuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: u } = await usuario.auth.getUser(jwt);
  const { data: master } = await usuario.rpc("admin_equipe");
  if (!u?.user?.email || master !== true) return responder({ erro: "só o Master envia teste" }, 403, origem);
  const r = await rodape();
  const ex = exemplo(tipo, SITE, r);
  let provedor: string | null = null, erro: string | null = null;
  try {
    provedor = (await enviar({ de: ex.de, para: u.user.email, assunto: ex.assunto, html: ex.html, dominio: r?.dominio })).id;
  } catch (e) {
    erro = String((e as Error).message).slice(0, 300);
  }
  await admin.rpc("registrar_email_sistema", { empresa: null, tipo: "teste", titulo: ex.assunto, remetente: ex.de,
    destino: u.user.email, usuario: u.user.id, contato: null, aviso: null, provedor, erro });
  return erro ? responder({ erro }, 502, origem) : responder({ enviado: true }, 200, origem);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const origem = req.headers.get("Origin");
  const fim = url.pathname.split("/").filter(Boolean).pop();
  if (fim === "retorno") return await retorno(req, url);
  if (req.method === "OPTIONS") return responder({}, 204, origem);
  if (fim === "sair") {                                                   // link do e-mail (GET confere, POST aplica)
    const v = validarSair(url.searchParams.get("u"), url.searchParams.get("a"), url.searchParams.get("t"));
    if (v.erro) return responder({ erro: v.erro }, 400, origem);
    return await sair(v.u!, v.a!, v.t!, req.method === "POST", origem);
  }
  if (req.method !== "POST") return responder({ erro: "use POST" }, 405, origem);
  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400, origem); }
  const p = validarPedido(corpo);
  if (p.erro) return responder({ erro: p.erro }, 400, origem);
  try {
    if (p.acao === "sair") {
      if (origem && !ORIGENS.includes(origem)) return responder({ erro: "origem não permitida" }, 403, origem);
      return await sair(p.u!, p.a!, p.t!, true, origem);
    }
    if (p.acao === "teste") {
      if (origem && !ORIGENS.includes(origem)) return responder({ erro: "origem não permitida" }, 403, origem);
      return await teste(req, p.tipo!, origem);
    }
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token || !(await ehServidor(token))) return responder({ erro: "só o servidor faz esta ação" }, 403);
    return responder(await filaDeAvisos());
  } catch (e) {
    console.error("emails", (e as { code?: string })?.code ?? "erro");
    return responder({ erro: "não foi possível concluir agora" }, 500, origem);
  }
});
