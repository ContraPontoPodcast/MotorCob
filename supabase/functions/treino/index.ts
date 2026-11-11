// Edge Function treino: sessão de treino de operadores por TEXTO (SQL 100) e por VOZ (SQL 119) — Roleplay do Speech.
// O site chama (functions.invoke('treino', { body })):
//   { acao: 'turno', sessao, token?, texto? }   → { fala, operador, desligou, saldo, segundos, duracao_max_s }
//       sem texto e sem conversa: o cliente simulado atende; sem texto com conversa: devolve a conversa (retomar).
//   { acao: 'encerrar', sessao, token? }        → { situacao: 'avaliada' | 'falhou' | 'abandonada', sessao }
//   { acao: 'sair', sessao, token? }            → { situacao: 'abandonada' }   ("Sair sem contar": não conta tentativa)
//   { acao: 'voz', sessao, token? }             → { url, bilhete, limite_s, por_franquia }   (SQL 119)
//       o bilhete de uso único (2 min) que o navegador manda como primeira mensagem do WebSocket da VM
//       (voz/treino_voz.py, wss://<vm>:8443/treino/voz). Leva o cenário inteiro para a VM, assinado com a chave do
//       simulador; o navegador só repassa. Corte: o menor entre a duração do cenário e o saldo de voz da franquia.
//   { acao: 'ouvir', token, atribuicao } | { acao: 'ouvir', cenario, empresa }   → { audio (base64), mime }
//       "Ouvir a voz" da cliente simulada antes de começar (treino_previa_voz: uma frase do roteiro fictício; pelo link,
//       6 por hora). Nada é guardado; o uso entra em registrar_uso_ia_voz (previa_voz, nada cobrado do cliente).
// E a VM chama, assinada com a chave do simulador (X-MotorCX-Carimbo/X-MotorCX-Assinatura, sem Origin):
//   { acao: 'voz_registrar', sessao, dados, sem_fala } → registrar_sessao_treino (ia_treino_voz por minuto, franquia,
//       aviso a 80%/100%) ou, sem fala do operador, treino_descartar_turnos (não conta, não cobra). Nunca áudio.
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
// VOZ_SIMULADOR_CHAVE; e VOZ_TREINO_WS_URL (wss://<vm>:8443/treino/voz, SQL 119). Publicar com "Verify JWT" DESLIGADO
// (o operador não tem login e a VM não tem JWT: quem autoriza é o banco e a assinatura).
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  assinarVM, conferirAssinaturaVM, criarBilhete, dadosAbandono, dadosBilhete, dadosRegistro, erroDoBanco, falasDoOperador, limparTurnos,
  MAX_FALAS_OPERADOR, MIN_VOZ_S, minutosPrevia, pacoteAvaliar, pacoteTurno, somarTurno, temFalaDoOperador, tempoEsgotado, urlOuvir,
  validarPedido, validarRegistroVoz,
  type Contexto,
} from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);
const VM_URL = Deno.env.get("VOZ_SIMULADOR_URL") ?? "";
const VM_CHAVE = Deno.env.get("VOZ_SIMULADOR_CHAVE") ?? "";
const VOZ_WS_URL = Deno.env.get("VOZ_TREINO_WS_URL") ?? "";

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

async function chamarVM(pacote: unknown, ms: number, url = VM_URL): Promise<{ ok: boolean; status: number; corpo: Record<string, unknown> }> {
  const corpo = JSON.stringify(pacote);
  const carimbo = String(Math.floor(Date.now() / 1000));
  const r = await fetch(url, {
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

  // ---------------------------------------------------------------- resultado da sessão por voz (a VM, assinado)
  if (req.headers.get("X-MotorCX-Assinatura")) {
    const bruto = await req.text();
    if (bruto.length > 512 * 1024 || !(await conferirAssinaturaVM(VM_CHAVE, req.headers.get("X-MotorCX-Carimbo"), req.headers.get("X-MotorCX-Assinatura"), bruto, Date.now() / 1000))) {
      console.error("treino", "voz_registrar", "assinatura recusada");
      return responder({ erro: "assinatura inválida" }, 401, origem);
    }
    let reg: ReturnType<typeof validarRegistroVoz> = null;
    try { reg = validarRegistroVoz(JSON.parse(bruto)); } catch { /* corpo fora de JSON */ }
    if (!reg) return responder({ erro: "resultado inválido" }, 400, origem);
    const { data: ses } = await admin.from("treino_sessoes").select("id, modo, situacao").eq("id", reg.sessao).maybeSingle();
    if (!ses || (ses as { modo: string }).modo !== "voz") return responder({ erro: "sessão não encontrada" }, 404, origem);
    if (reg.sem_fala) {
      await admin.rpc("treino_descartar_turnos", { sessao: reg.sessao, abandonar: true });
      return responder({ situacao: "abandonada" }, 200, origem);
    }
    const { data, error } = await admin.rpc("registrar_sessao_treino", { sessao: reg.sessao, dados: reg.dados });
    if (error) {
      console.error("treino", "voz_registrar", error.code);
      return responder({ erro: "não deu para registrar" }, 500, origem);
    }
    return responder({ situacao: (data as { situacao?: string } | null)?.situacao ?? reg.dados.situacao }, 200, origem);
  }

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return responder({ erro: "pedido inválido" }, 400, origem); }
  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);
  const jwtDe = () => (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

  // ---------------------------------------------------------------- "Ouvir a voz" (antes de abrir a sessão)
  if (pedido.acao === "ouvir") {
    let pv: { data: unknown; error: { message: string } | null };
    if (pedido.token) {
      pv = await admin.rpc("treino_previa_voz", { token: pedido.token, atribuicao: pedido.atribuicao, cenario: null, empresa: null });
    } else {
      const jwt = jwtDe();
      if (!jwt || jwt === ANON) return responder({ erro: "faça login ou abra pelo link de treino" }, 401, origem);
      const comoUsuario = createClient(SUPABASE_URL, ANON, { ...sem, global: { headers: { Authorization: `Bearer ${jwt}` } } });
      pv = await comoUsuario.rpc("treino_previa_voz", { token: null, atribuicao: null, cenario: pedido.cenario, empresa: pedido.empresa });
    }
    if (pv.error || !pv.data) {
      const e = erroDoBanco(pv.error?.message);
      return responder({ erro: e.erro }, e.status, origem);
    }
    if (!VM_URL || !VM_CHAVE) return responder({ erro: "A prévia da voz ainda não está configurada. Avise o Admin." }, 503, origem);
    const p = pv.data as { empresa: number; voz_tts: string | null; frase: string };
    try {
      const r = await chamarVM({ texto: p.frase, ...(p.voz_tts ? { voz_id: p.voz_tts } : {}) }, 25_000, urlOuvir(VM_URL));
      if (!r.ok) return responder({ erro: r.status === 503 ? "A prévia da voz está indisponível agora." : "Não deu para gerar a prévia agora." }, r.status === 503 ? 503 : 502, origem);
      const caracteres = Number(r.corpo.caracteres) || p.frase.length;
      const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const { error: eUso } = await admin.rpc("registrar_uso_ia_voz", {
        empresa: p.empresa, dia, componente: "previa_voz", chamadas: 1, minutos: minutosPrevia(caracteres),
        minutos_cobraveis: 0, tokens_entrada: caracteres, tokens_saida: 0,
      });
      if (eUso) console.error("treino", "registrar_uso_ia_voz", eUso.code);
      return responder({ audio: r.corpo.audio, mime: r.corpo.mime ?? "audio/mpeg" }, 200, origem);
    } catch (e) {
      console.error("treino", "ouvir", (e as Error).name);
      return responder({ erro: "Não deu para gerar a prévia agora." }, 502, origem);
    }
  }

  // Contexto da sessão: pelo link (chave do servidor + token) ou com o login de quem abriu a sessão.
  let resp: { data: unknown; error: { message: string } | null };
  if (pedido.token) {
    resp = await admin.rpc("treino_contexto_sessao", { sessao: pedido.sessao, token: pedido.token });
  } else {
    const jwt = jwtDe();
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

  // ---------------------------------------------------------------- sessão por voz: o bilhete do WebSocket
  if (pedido.acao === "voz") {
    if (ctx.modo !== "voz") return responder({ erro: "Esta sessão é por texto." }, 400, origem);
    if (!VOZ_WS_URL || !VM_CHAVE) {
      console.error("treino", "VOZ_TREINO_WS_URL/VOZ_SIMULADOR_CHAVE ausentes");
      return responder({ erro: "O treino por voz ainda não está configurado. Use o texto e avise o Admin." }, 503, origem);
    }
    const dados = dadosBilhete(ctx, Date.now() / 1000);
    if ((dados.limite_s as number) < MIN_VOZ_S) {
      await admin.rpc("registrar_sessao_treino", { sessao: ctx.sessao, dados: { situacao: "falhou", motivo_falha: "voz_esgotada", duracao_s: 0 } });
      return responder({ erro: "Os minutos de voz do treino deste mês acabaram. O treino por texto continua." }, 403, origem);
    }
    return responder({ url: VOZ_WS_URL, bilhete: await criarBilhete(VM_CHAVE, dados), limite_s: dados.limite_s, por_franquia: dados.por_franquia }, 200, origem);
  }

  // ---------------------------------------------------------------- sair sem contar (texto ou voz antes de conectar)
  if (pedido.acao === "sair") {
    if (temFalaDoOperador(ctx.turnos)) {
      const { error } = await admin.rpc("registrar_sessao_treino", { sessao: ctx.sessao, dados: dadosAbandono(ctx) });
      if (error) console.error("treino", "sair", error.code);
    }
    await admin.rpc("treino_descartar_turnos", { sessao: ctx.sessao, abandonar: true });
    return responder({ situacao: "abandonada" }, 200, origem);
  }

  if (ctx.modo !== "texto") return responder({ erro: "Esta sessão é por voz." }, 400, origem);
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
