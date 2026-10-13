// Edge Function assistente: o Assistente MotorCX do Workspace (campo "O que você quer fazer?" e o avatar).
// * O site chama com o login do usuário (Authorization: Bearer <token>) e { pergunta, origem, tela, historico }.
// * CPF, telefone, e-mail e números longos são apagados ANTES de ir ao modelo e ao banco (regras.ts).
// * Responde com a base de conhecimento da plataforma (conhecimento.ts); não vê carteira nem envios da empresa.
// * Cada pergunta fica em assistente_perguntas (90 dias), com "respondida" para a equipe ver o que falta na base.
// * Limite: 30 perguntas por hora por usuário. Sem a chave ANTHROPIC_API_KEY nos Secrets, responde
//   "ainda não sei" com o botão Abrir chamado. As chaves vêm só dos Secrets do Supabase e nunca saem daqui.
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CONHECIMENTO } from "./conhecimento.ts";
import { anonimizar, ESQUEMA, INSTRUCOES, LIMITE_POR_HORA, montarMensagens, montarResposta, type Resposta,
  SEM_RESPOSTA, validarPedido } from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHAVE_IA = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const MODELO = "claude-opus-5-5";

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ia = CHAVE_IA ? new Anthropic({ apiKey: CHAVE_IA, timeout: 60_000, maxRetries: 1 }) : null;

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

function responder(corpo: unknown, status: number, origem: string | null) {
  return new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });
}

async function perguntarIA(mensagens: ReturnType<typeof montarMensagens>): Promise<Resposta> {
  if (!ia) return SEM_RESPOSTA;
  const r = await ia.beta.messages.create({
    model: MODELO,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: [{ type: "text", text: `${INSTRUCOES}\n\n# BASE DE CONHECIMENTO\n\n${CONHECIMENTO}`,
               cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: mensagens,
  });
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return SEM_RESPOSTA;
  const texto = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return montarResposta(JSON.parse(texto));
  } catch {
    return SEM_RESPOSTA;
  }
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

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "pedido inválido" }, 400, origem);
  }
  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);

  const { data: perfil } = await admin.from("perfis").select("empresa_id, equipe, ativo")
    .eq("id", sessao.user.id).maybeSingle();
  if (!perfil?.ativo) return responder({ erro: "acesso desativado" }, 403, origem);

  const umaHora = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("assistente_perguntas").select("id", { count: "exact", head: true })
    .eq("usuario_id", sessao.user.id).gte("criado_em", umaHora);
  if ((count ?? 0) >= LIMITE_POR_HORA) {
    return responder({ erro: "muitas perguntas seguidas; tente de novo em alguns minutos" }, 429, origem);
  }

  const pergunta = anonimizar(pedido.pergunta).texto;
  let resposta: Resposta;
  try {
    resposta = await perguntarIA(montarMensagens(pedido.historico, pergunta, pedido.tela));
  } catch (e) {
    console.error("assistente", e instanceof Anthropic.APIError ? e.status : "erro"); // sem texto do usuário no log
    resposta = SEM_RESPOSTA;
  }

  const { data: linha } = await admin.from("assistente_perguntas").insert({
    usuario_id: sessao.user.id,
    empresa_id: perfil.equipe ? pedido.empresa_id : perfil.empresa_id,
    origem: pedido.origem,
    tela: pedido.tela,
    pergunta,
    resposta: [resposta.texto, ...resposta.passos.map((p, i) => `${i + 1}. ${p}`)].join("\n").slice(0, 4000),
    respondida: resposta.respondida,
    acao: resposta.acao?.id ?? null,
  }).select("id").maybeSingle();

  return responder({ id: linha?.id ?? null, ...resposta }, 200, origem);
});
