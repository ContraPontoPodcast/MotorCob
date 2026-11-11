// Edge Function treino: sessão de treino de operadores por TEXTO (Roleplay do Speech Analytics, SQL 100).
// O site chama (functions.invoke('treino', { body })):
//   { acao: 'turno', sessao, token?, texto? }   → { fala, operador, desligou, saldo, segundos, duracao_max_s }
//       sem texto e sem conversa: o cliente simulado atende; sem texto com conversa: devolve a conversa (retomar).
//   { acao: 'encerrar', sessao, token? }        → { situacao: 'avaliada' | 'falhou' | 'abandonada', sessao }
//   { acao: 'sair', sessao, token? }            → { situacao: 'abandonada' }   ("Sair sem contar": não conta tentativa)
// A sessão já foi aberta pelo site com as RPCs do SQL 90 (treino_iniciar pelo link; iniciar_treino_lado_a_lado ou
// testar_cenario_treino logado), que conferem módulo, prazo, tentativas e franquia.
// Quem pode: pelo link, o token (64 hex) do operador da sessão, conferido no banco (treino_contexto_sessao com a chave
// do servidor: hash, validade, revogação, operador ativo, módulo); logado, quem abriu o treino lado a lado ou o teste
// (treino_contexto_sessao com o login da pessoa). O roteiro do cliente simulado nunca vai para o navegador.
// A conversa e a avaliação rodam no simulador da VM (voz/treino.py), pela mesma rota /simular e a mesma assinatura do
// simular_fluxo_voz. A conversa em andamento fica em treino_turnos (sem policy, só o servidor); no fim,
// registrar_sessao_treino grava nota, itens, trechos, dicas, transcrição (90 dias; teste 1 dia), tentativas, uso e
// cobrança (ia_treino_texto, com franquia). Nada vai para voz_avaliacoes.
// Secrets (os mesmos do simular_fluxo_voz; valores nunca no código nem em log): VOZ_SIMULADOR_URL e
// VOZ_SIMULADOR_CHAVE. Publicar com "Verify JWT" DESLIGADO (o operador não tem login: quem autoriza é o banco).
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  assinarVM, dadosAbandono, dadosRegistro, erroDoBanco, falasDoOperador, limparTurnos, MAX_FALAS_OPERADOR, pacoteAvaliar, pacoteTurno,
  somarTurno, temFalaDoOperador, tempoEsgotado, validarPedido,
  type Contexto,
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

async function chamarVM(pacote: unknown, ms: number): Promise<{ ok: boolean; status: number; corpo: Record<string, unknown> }> {
  const corpo = JSON.stringify(pacote);
  const carimbo = String(Math.floor(Date.now() / 1000));
  const r = await fetch(VM_URL, {
    method: "POST", body: corpo, signal: AbortSignal.timeout(ms),
    headers: { "Content-Type": "application/json", "X-MotorCX-Carimbo": carimbo, "X-MotorCX-Assinatura": await assinarVM(VM_CHAVE, carimbo, corpo) },
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

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400, origem); }
  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);

  // Contexto da sessão: pelo link (chave do servidor + token) ou com o login de quem abriu a sessão.
  let resp: { data: unknown; error: { message: string } | null };
  if (pedido.token) {
    resp = await admin.rpc("treino_contexto_sessao", { sessao: pedido.sessao, token: pedido.token });
  } else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === ANON) return responder({ erro: "faça login ou abra pelo link de treino" }, 401, origem);
    const comoUsuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${jwt}` } } });
    resp = await comoUsuario.rpc("treino_contexto_sessao", { sessao: pedido.sessao, token: null });
  }
  if (resp.error || !resp.data) {
    const e = erroDoBanco(resp.error?.message);
    return responder({ erro: e.erro }, e.status, origem);
  }
  const ctx = resp.data as Contexto;
  ctx.turnos = limparTurnos(ctx.turnos);
  if (ctx.situacao !== "em_andamento") return responder({ erro: "Esta sessão já terminou.", situacao: ctx.situacao }, 409, origem);
  if (ctx.modo !== "texto") return responder({ erro: "Esta sessão é por voz." }, 400, origem);

  // ---------------------------------------------------------------- sair sem contar
  if (pedido.acao === "sair") {
    if (temFalaDoOperador(ctx.turnos)) {
      const { error } = await admin.rpc("registrar_sessao_treino", { sessao: ctx.sessao, dados: dadosAbandono(ctx) });
      if (error) console.error("treino", "sair", error.code);
    }
    await admin.rpc("treino_descartar_turnos", { sessao: ctx.sessao, abandonar: true });
    return responder({ situacao: "abandonada" }, 200, origem);
  }

  if (!VM_URL || !VM_CHAVE) {
    console.error("treino", "VOZ_SIMULADOR_URL/CHAVE ausentes");
    return responder({ erro: "O treino por texto ainda não está configurado. Avise o Admin." }, 503, origem);
  }

  // ---------------------------------------------------------------- encerrar e avaliar
  if (pedido.acao === "encerrar") {
    if (!temFalaDoOperador(ctx.turnos)) {
      await admin.rpc("treino_descartar_turnos", { sessao: ctx.sessao, abandonar: true });
      return responder({ situacao: "abandonada", sessao: ctx.sessao, motivo: "sem_fala" }, 200, origem);
    }
    let av: Record<string, unknown> | null = null;
    try {
      const r = await chamarVM(pacoteAvaliar(ctx), 110_000);
      if (r.ok) av = r.corpo;
      else console.error("treino", "avaliar", r.status);
    } catch (e) {
      console.error("treino", "avaliar", (e as Error).name);      // sem a conversa no log
    }
    const dados = dadosRegistro(av, ctx);
    const { error } = await admin.rpc("registrar_sessao_treino", { sessao: ctx.sessao, dados });
    if (error) {
      console.error("treino", "registrar", error.code);
      return responder({ erro: "Não deu para guardar o resultado agora. A tentativa não contou." }, 500, origem);
    }
    await admin.rpc("treino_descartar_turnos", { sessao: ctx.sessao, abandonar: false });
    return responder({ situacao: dados.situacao, sessao: ctx.sessao }, 200, origem);
  }

  // ---------------------------------------------------------------- turno
  if (pedido.texto == null && ctx.turnos.length) {
    return responder({ turnos: ctx.turnos, saldo: ctx.saldo, segundos: ctx.segundos, duracao_max_s: ctx.duracao_max_s }, 200, origem);
  }
  if (tempoEsgotado(ctx.segundos, ctx.duracao_max_s)) {
    return responder({ fim: "tempo", segundos: ctx.segundos, duracao_max_s: ctx.duracao_max_s }, 200, origem);
  }
  if (falasDoOperador(ctx.turnos) >= MAX_FALAS_OPERADOR) {
    return responder({ fim: "limite", segundos: ctx.segundos, duracao_max_s: ctx.duracao_max_s }, 200, origem);
  }
  let r: Awaited<ReturnType<typeof chamarVM>>;
  try {
    r = await chamarVM(pacoteTurno(ctx, pedido.texto), 40_000);
  } catch (e) {
    console.error("treino", "turno", (e as Error).name);
    return responder({ erro: "O cliente simulado não respondeu agora. Tente de novo." }, 502, origem);
  }
  if (!r.ok) return responder({ erro: r.status === 400 ? (String(r.corpo.erro ?? "Fala inválida.")) : "O cliente simulado não respondeu agora. Tente de novo." }, r.status === 400 ? 400 : 502, origem);
  const operador = typeof r.corpo.operador === "string" ? r.corpo.operador : null;
  const fala = typeof r.corpo.fala === "string" ? r.corpo.fala : "Alô?";
  const saldo = typeof (r.corpo.ficha as { saldo?: unknown } | undefined)?.saldo === "string" ? (r.corpo.ficha as { saldo: string }).saldo : null;
  const turnos = somarTurno(ctx.turnos, operador, fala, ctx.segundos);
  const { error } = await admin.rpc("treino_guardar_turnos", {
    sessao: ctx.sessao, turnos, tokens: Math.max(0, Math.round(Number(ctx.tokens) || 0) + Math.round(Number(r.corpo.tokens) || 0)), saldo,
  });
  if (error) {
    const e = erroDoBanco(error.message);
    return responder({ erro: e.erro }, e.status, origem);
  }
  return responder({ fala, operador, desligou: r.corpo.desligou === true, saldo, segundos: ctx.segundos, duracao_max_s: ctx.duracao_max_s }, 200, origem);
});
