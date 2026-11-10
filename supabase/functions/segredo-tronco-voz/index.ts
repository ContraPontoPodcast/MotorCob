// Edge Function segredo-tronco-voz (SQL 103, PR T1 da Telefonia): guarda a senha do tronco SIP direto no cofre.
// O site chama com o login da pessoa: functions.invoke('segredo-tronco-voz', { body: { tronco, senha } }).
// Resposta: { guardada_em, versao }. A senha NUNCA volta, nunca vai para o banco, para log ou para outra resposta.
// Passos:
//  1. login válido (Supabase Auth) e a sessão confirmada pela verificação em duas etapas (aal2);
//  2. preparar_segredo_tronco_voz(tronco) COM O LOGIN DA PESSOA: o banco confere quem pode (pode_configurar_telefonia),
//     o aal2 de novo, a autenticação por senha e o limite de trocas, registra o pedido e devolve o nome do segredo da
//     empresa (motorcx-voz-trunk-e<empresa>-<referência>), conferido aqui de novo;
//  3. Secret Manager, com a conta motorcx-voz-cofre-escrita (cria segredo e escreve versão só em motorcx-voz-trunk-*;
//     não tem permissão de ler): cria o segredo se ainda não existe (réplica em São Paulo), escreve a versão nova e
//     destrói as antigas;
//  4. registrar_segredo_tronco_voz (servidor): referência, data, quem e versão no tronco, teste zerado e Auditoria.
// Quem lê a senha: só a conta motorcx-asterisk das VMs de voz (segredos motorcx-voz-*), na hora de gerar o pjsip.
// Secrets (Supabase › Edge Functions › Secrets): GCP_COFRE_TRONCO_CHAVE = JSON da conta motorcx-voz-cofre-escrita
// (infra/asterisk/criar_gcp.sh chave-cofre). Opcional: MOTORCX_GCP_PROJETO (padrão: o project_id da chave).
// Publicar com "Verify JWT" LIGADO.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  assinadorDe, jwtDaConta, lerChave, nivelDaSessao, nomeDaEmpresa, numeroVersao, pedidoCriar, pedidoVersao,
  TOKEN_URL, urlDestruir, urlVersoes, validarPedido, versoesAntigas,
} from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const CHAVE = lerChave(Deno.env.get("GCP_COFRE_TRONCO_CHAVE"), Deno.env.get("MOTORCX_GCP_PROJETO") ?? undefined);

const sem = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE, sem);
let assinar: ((d: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>) | null = null;

function cabecalhos(origem: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem && ORIGENS.includes(origem) ? origem : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
const responder = (corpo: unknown, status: number, origem: string | null) =>
  new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });

class ErroCofre extends Error {}

async function tokenGoogle(): Promise<string> {
  assinar ??= await assinadorDe(CHAVE!);
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                assertion: await jwtDaConta(CHAVE!, new Date(), assinar) }),
  });
  const d = await r.json().catch(() => ({})) as { access_token?: string };
  if (!r.ok || !d.access_token) throw new ErroCofre(`token ${r.status}`);
  return d.access_token;
}

async function google(metodo: string, url: string, token: string, corpo?: unknown): Promise<{ status: number; json: unknown }> {
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/** Grava a versão nova e destrói as antigas. Devolve o número da versão. Erros sem corpo (o corpo nunca vai ao log). */
async function guardar(nome: string, empresa: number, senha: string): Promise<number> {
  const token = await tokenGoogle();
  const proj = CHAVE!.project_id;
  const c = pedidoCriar(proj, nome, empresa);
  const criado = await google("POST", c.url, token, c.corpo);
  if (criado.status !== 200 && criado.status !== 409) throw new ErroCofre(`criar ${criado.status}`);   // 409: já existe
  const v = pedidoVersao(proj, nome, senha);
  const nova = await google("POST", v.url, token, v.corpo);
  const n = numeroVersao((nova.json as { name?: unknown } | null)?.name);
  if (nova.status !== 200 || !n) throw new ErroCofre(`versao ${nova.status}`);
  // a senha antiga sai do cofre (melhor esforço: se falhar, a VM já lê a última versão, que é a nova)
  try {
    const lista = await google("GET", urlVersoes(proj, nome), token);
    for (const antiga of versoesAntigas(lista.json, n)) {
      const d = await google("POST", urlDestruir(antiga), token, {});
      if (d.status !== 200) console.error("segredo-tronco-voz", "destruir", d.status);
    }
  } catch (e) {
    console.error("segredo-tronco-voz", "versoes", (e as Error).name);
  }
  return n;
}

Deno.serve(async (req) => {
  const origem = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos(origem) });
  if (origem && !ORIGENS.includes(origem)) return responder({ erro: "origem não permitida" }, 403, origem);
  if (req.method !== "POST") return responder({ erro: "método não permitido" }, 405, origem);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({ erro: "faça login" }, 401, origem);
  const { data: sessao, error: eLogin } = await admin.auth.getUser(token);
  if (eLogin || !sessao?.user) return responder({ erro: "login expirado" }, 401, origem);
  if (nivelDaSessao(token) !== "aal2") {
    return responder({ erro: "confirme a verificação em duas etapas para guardar a senha do tronco" }, 403, origem);
  }

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400, origem); }
  const { pedido, erro } = validarPedido(corpo);
  corpo = null;
  if (!pedido) return responder({ erro }, 400, origem);
  if (!CHAVE) {
    console.error("segredo-tronco-voz", "GCP_COFRE_TRONCO_CHAVE ausente ou inválida");
    return responder({ erro: "o cofre de senhas ainda não está configurado" }, 503, origem);
  }

  // Com o login de quem pede: o banco decide (permissão, aal2, tipo do tronco, limite) e registra o pedido.
  const comoUsuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: prep, error: ePrep } = await comoUsuario.rpc("preparar_segredo_tronco_voz", { tronco: pedido.tronco });
  if (ePrep) {
    const msg = ePrep.code === "P0001" && ePrep.message ? ePrep.message : "não foi possível conferir o tronco";
    return responder({ erro: msg }, msg === "tronco não encontrado" ? 404 : 403, origem);
  }
  const linha = (Array.isArray(prep) ? prep[0] : prep) as { empresa_id?: number; nome_segredo?: string } | null;
  if (!linha || !nomeDaEmpresa(linha.nome_segredo, linha.empresa_id)) {
    console.error("segredo-tronco-voz", "nome fora do padrão");
    return responder({ erro: "não foi possível conferir o tronco" }, 500, origem);
  }

  let versao: number;
  try {
    versao = await guardar(linha.nome_segredo!, Number(linha.empresa_id), pedido.senha);
  } catch (e) {
    console.error("segredo-tronco-voz", "cofre", e instanceof ErroCofre ? e.message : (e as Error).name);
    return responder({ erro: "o cofre não aceitou a senha agora. Tente de novo em alguns minutos." }, 502, origem);
  }

  const { data: em, error: eReg } = await admin.rpc("registrar_segredo_tronco_voz", {
    tronco: pedido.tronco, usuario: sessao.user.id, versao,
  });
  if (eReg) {
    console.error("segredo-tronco-voz", "registrar", eReg.code);
    return responder({ erro: "a senha foi guardada, mas o registro falhou. Guarde de novo." }, 500, origem);
  }
  return responder({ guardada_em: em, versao }, 200, origem);
});
