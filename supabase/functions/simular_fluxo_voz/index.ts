// Edge Function simular_fluxo_voz: simulador de texto do fluxo do agente de voz (SQL 58, tela "Testar conversa").
// O site chama com o login da pessoa:
//   functions.invoke('simular_fluxo_voz', { versao, falas: [...], falhar?: [conector_id] })
//     → { turnos: [{ pessoa, falas: [{texto, bloco, modo}], bloco, caminho, intencao, conectores, travas, devolucoes, fim }],
//         caminho, resultado, encerrada, conectores }
//   functions.invoke('simular_fluxo_voz', { acao: 'rodar_casos', versao })
//     → { casos: [{ id, nome, passou, caminho_obtido }] } e grava cada resultado (registrar_resultado_caso_voz).
// Quem pode: pessoa ativa do cliente, da empresa da versão, com pode('editar_canais'). Tudo é lido com o login de
// quem pede (a RLS decide); a função só monta o pacote e chama o simulador da VM, que roda o MESMO executor da
// ligação (voz/fluxo.py) em modo texto, com os conectores trocados pelo exemplo_resposta e um cliente fictício.
// Por que na VM e não aqui: o executor é Python; portar para TypeScript duplicaria as travas (ver voz/simulador_http.py).
// Secrets: VOZ_SIMULADOR_URL (https://<vm>:8443/simular) e VOZ_SIMULADOR_CHAVE (a mesma chave do segredo
// motorcx-voz-simulador da VM). Os valores nunca entram no código nem em log. Publicar com "Verify JWT" LIGADO.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  assinar, autorizar, conferirCaso, pacoteVM, PERMISSAO, respostaTela, validarPedido, variaveisTeste,
  type Caso, type Perfil, type ResultadoVM, type Versao,
} from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const VM_URL = Deno.env.get("VOZ_SIMULADOR_URL") ?? "";
const VM_CHAVE = Deno.env.get("VOZ_SIMULADOR_CHAVE") ?? "";

const sem = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE, sem);

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

async function chamarVM(pacote: unknown): Promise<{ ok: boolean; status: number; corpo: Record<string, unknown> }> {
  const corpo = JSON.stringify(pacote);
  const carimbo = String(Math.floor(Date.now() / 1000));
  const r = await fetch(VM_URL, {
    method: "POST", body: corpo, signal: AbortSignal.timeout(60_000),
    headers: { "Content-Type": "application/json", "X-MotorCX-Carimbo": carimbo, "X-MotorCX-Assinatura": await assinar(VM_CHAVE, carimbo, corpo) },
  });
  let j: Record<string, unknown> = {};
  try { j = await r.json(); } catch { /* corpo fora de JSON */ }
  return { ok: r.ok, status: r.status, corpo: j };
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
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400, origem); }
  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);

  const comoUsuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${token}` } } });
  const [{ data: quem }, { data: pode }, { data: v }] = await Promise.all([
    admin.from("perfis").select("id, ativo, equipe, empresa_id").eq("id", sessao.user.id).maybeSingle(),
    comoUsuario.rpc("pode", { perm: PERMISSAO }),
    comoUsuario.from("voz_fluxo_versoes").select("id, fluxo_id, empresa_id, credor_id, definicao").eq("id", pedido.versao).maybeSingle(),
  ]);
  const negado = autorizar(quem as Perfil | null, pode === true, v as Versao | null);
  if (negado) return responder({ erro: negado }, negado === "versão não encontrada" ? 404 : 403, origem);
  const versao = v as Versao;
  if (!VM_URL || !VM_CHAVE) {
    console.error("simular_fluxo_voz", "VOZ_SIMULADOR_URL/CHAVE ausentes");
    return responder({ erro: "o simulador ainda não está configurado" }, 503, origem);
  }

  // Contexto da simulação, com o login de quem pede (RLS)
  const [{ data: cons }, { data: alc }, { data: base }, { data: emp }, { data: cred }] = await Promise.all([
    comoUsuario.from("crm_conectores").select("*").eq("empresa_id", versao.empresa_id),
    comoUsuario.rpc("alcada_voz_vigente", { empresa: versao.empresa_id, credor: versao.credor_id }),
    comoUsuario.from("voz_base_respostas").select("bloco_id, pergunta, resposta").eq("fluxo_versao_id", versao.id).not("revisado_em", "is", null),
    comoUsuario.from("empresas").select("nome").eq("id", versao.empresa_id).maybeSingle(),
    versao.credor_id ? comoUsuario.from("credores").select("nome").eq("id", versao.credor_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const montar = (falas: string[], falhar: number[]) => pacoteVM({
    versao, conectores: (cons ?? []) as Record<string, unknown>[], alcada: (Array.isArray(alc) ? alc[0] : alc) as Record<string, unknown> | null,
    base: (base ?? []) as { bloco_id: string; pergunta: string; resposta: string }[], falas, falhar,
    variaveis: variaveisTeste((emp as { nome?: string } | null)?.nome ?? "Assessoria de teste", (cred as { nome?: string } | null)?.nome ?? null),
  });

  try {
    if (pedido.acao === "simular") {
      const r = await chamarVM(montar(pedido.falas, pedido.falhar));
      if (!r.ok) return responder({ erro: (r.corpo.erro as string) ?? "o simulador não respondeu", erros: r.corpo.erros ?? [] }, r.status === 400 ? 400 : 502, origem);
      return responder(respostaTela(r.corpo), 200, origem);
    }
    // rodar_casos: cada caso ativo do fluxo nesta versão; o resultado fica gravado (segura a aprovação se falhar)
    const { data: casos } = await comoUsuario.from("voz_fluxo_casos_teste")
      .select("id, nome, falas, caminho_esperado, resultado_esperado, conectores_falham, ativo").eq("fluxo_id", versao.fluxo_id).eq("ativo", true);
    const saida = [];
    for (const c of (casos ?? []) as Caso[]) {
      const r = await chamarVM(montar(c.falas, c.conectores_falham ?? []));
      const res = r.corpo as unknown as ResultadoVM;
      const passou = r.ok && conferirCaso(c, res);
      const caminho = r.ok ? res.caminho : [];
      const { error: eGrava } = await admin.rpc("registrar_resultado_caso_voz", {
        caso: c.id, versao: versao.id, passou, caminho_obtido: caminho,
        resultado_obtido: r.ok && res.resultado && /^[a-z][a-z0-9_]{1,40}$/.test(res.resultado) ? res.resultado : null,
      });
      if (eGrava) console.error("simular_fluxo_voz", "registrar_resultado_caso_voz", eGrava.code);
      saida.push({ id: c.id, nome: c.nome, passou, caminho_obtido: caminho });
    }
    return responder({ casos: saida }, 200, origem);
  } catch (e) {
    console.error("simular_fluxo_voz", pedido.acao, (e as Error).name);   // sem falas nem respostas no log
    return responder({ erro: "não foi possível simular agora" }, 502, origem);
  }
});
