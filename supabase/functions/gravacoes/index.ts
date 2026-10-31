// Edge Function gravacoes: ouvir uma gravação ou ler a transcrição redigida (agente de voz, SQL 56).
// O site chama com o login da pessoa: functions.invoke('gravacoes', { gravacao, tipo: 'audio' | 'transcricao' }).
// * audio       → { url, expira_em }: URL assinada V4 do Cloud Storage, só GET, válida por 5 minutos.
// * transcricao → { segmentos: [{ quem, em_s, texto }] }: lida aqui, no servidor; o site nunca recebe o caminho.
// Quem pode: pessoa ativa do cliente, da empresa da gravação, com pode('ouvir_gravacoes') (áudio) ou
// pode('ver_transcricoes') (transcrição). A RLS de voz_gravacoes também exige ouvir_gravacoes para enxergar a linha.
// Todo acesso é gravado em `acessos` (acao ouvir_gravacao | ler_transcricao, alvo = id da gravação) ANTES da resposta:
// sem registro, não há link nem texto.
// Secrets (Supabase › Edge Functions › Secrets): GCS_GRAVACOES_CHAVE = JSON da conta de serviço com só leitura de
// objeto nos buckets de gravação (roles/storage.objectViewer). O valor nunca entra no código nem em log.
// Publicar com "Verify JWT" LIGADO (só quem está logado chama).
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ACAO_ACESSO, autorizar, assinadorDe, lerChave, lerTranscricao, PERMISSAO, type Gravacao, type Perfil,
  urlAssinada, validarPedido, VALIDADE_LEITURA_S, VALIDADE_S,
} from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const CHAVE = lerChave(Deno.env.get("GCS_GRAVACOES_CHAVE"));

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
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400, origem); }
  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);

  // Com o login de quem pede: a RLS de voz_gravacoes e o pode() decidem, como no site.
  const comoUsuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: quem }, { data: pode }, { data: g }] = await Promise.all([
    admin.from("perfis").select("id, ativo, equipe, empresa_id").eq("id", sessao.user.id).maybeSingle(),
    comoUsuario.rpc("pode", { perm: PERMISSAO[pedido.tipo] }),
    comoUsuario.from("voz_gravacoes").select("id, empresa_id, caminho, transcricao_caminho").eq("id", pedido.gravacao).maybeSingle(),
  ]);
  const negado = autorizar(quem as Perfil | null, pode === true, g as Gravacao | null);
  if (negado) return responder({ erro: negado }, negado === "gravação não encontrada" ? 404 : 403, origem);
  const grav = g as Gravacao;

  if (pedido.tipo === "transcricao" && !grav.transcricao_caminho) {
    return responder({ erro: "a transcrição ainda não está pronta" }, 409, origem);
  }
  if (!CHAVE) {
    console.error("gravacoes", "GCS_GRAVACOES_CHAVE ausente ou inválida");
    return responder({ erro: "o serviço de gravações ainda não está configurado" }, 503, origem);
  }
  const { data: cfg } = await admin.from("voz_config").select("bucket_gravacoes").eq("empresa_id", grav.empresa_id).maybeSingle();
  const bucket = (cfg as { bucket_gravacoes: string | null } | null)?.bucket_gravacoes;
  if (!bucket) return responder({ erro: "a empresa ainda não tem bucket de gravações" }, 503, origem);

  // Registro do acesso antes de entregar qualquer coisa.
  const { error: eAcesso } = await comoUsuario.from("acessos").insert({
    usuario: sessao.user.id, acao: ACAO_ACESSO[pedido.tipo], alvo: String(grav.id), empresa_id: grav.empresa_id,
  });
  if (eAcesso) {
    console.error("gravacoes", "acessos", eAcesso.code);
    return responder({ erro: "não foi possível registrar o acesso" }, 500, origem);
  }

  try {
    assinar ??= await assinadorDe(CHAVE);
    if (pedido.tipo === "audio") {
      const link = await urlAssinada({ email: CHAVE.client_email, bucket, objeto: grav.caminho, agora: new Date(), validade: VALIDADE_S }, assinar);
      return responder(link, 200, origem);
    }
    const interno = await urlAssinada({ email: CHAVE.client_email, bucket, objeto: grav.transcricao_caminho!, agora: new Date(), validade: VALIDADE_LEITURA_S }, assinar);
    const r = await fetch(interno.url);
    if (!r.ok) {
      await r.body?.cancel();
      console.error("gravacoes", "transcricao", r.status);
      return responder({ erro: r.status === 404 ? "a transcrição já foi apagada" : "não foi possível ler a transcrição" }, r.status === 404 ? 410 : 502, origem);
    }
    const segmentos = lerTranscricao(await r.json());
    if (!segmentos) return responder({ erro: "transcrição em formato inesperado" }, 502, origem);
    return responder({ segmentos }, 200, origem);
  } catch (e) {
    console.error("gravacoes", pedido.tipo, (e as Error).name);   // sem caminho, sem dado pessoal no log
    return responder({ erro: "não foi possível abrir a gravação agora" }, 500, origem);
  }
});
