// Edge Function assistente: o Assistente MotorCX do Workspace (campo "O que você quer fazer?" e o avatar).
// * O site chama com o login do usuário (Authorization: Bearer <token>) e { pergunta, origem, tela, tela_nome,
//   frente, historico, stream }. Com stream: true a resposta chega em eventos (text/event-stream): "texto" com o que
//   já foi escrito e "fim" com a resposta completa. Sem stream, um JSON só.
// * { acao: "chamado", historico, tela, tela_nome, avaliacao } devolve o motivo, o assunto e a conversa (sem dado
//   pessoal) para o chamado aberto pelo Assistente — não chama o modelo.
// * CPF, telefone, e-mail e números longos são apagados ANTES de ir ao modelo e ao banco (regras.ts).
// * Responde com a base de conhecimento (conhecimento.ts) e as Respostas da equipe (Console), sabendo perfil, frente,
//   módulos e as telas que a pessoa abre; nunca vê carteira, clientes, envios ou valores.
// * Cada pergunta fica em assistente_perguntas (90 dias) com a situação, o tema, os tokens e o custo estimado.
//   Limite: 30 respondidas por hora por pessoa (fora do ar e teto não contam). Teto do mês em reais (SQL 43): com
//   ele atingido, só Respostas da equipe e Suporte. As chaves vêm só dos Secrets do Supabase e nunca saem daqui.
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CONHECIMENTO } from "./conhecimento.ts";
import {
  acoesPermitidas, anonimizar, blocoRespostasEquipe, type Contexto, conversaParaChamado, custoUsd, ESQUEMA, FORA_DO_AR,
  INSTRUCOES, LIMITE_POR_HORA, MAX_HISTORICO, type Mensagem, MODELO, montarMensagens, montarResposta, motivoDoChamado,
  NO_TETO, type Pedido, type Resposta, respostaDaEquipe, type RespostaEquipe, SEM_RESPOSTA, textoContexto, textoParcial,
  validarPedido,
} from "./regras.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHAVE_IA = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SITE = Deno.env.get("SITE_URL") ?? "https://motorcob.online";
const ORIGENS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? SITE).split(",").map((s) => s.trim()).filter(Boolean);

const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ia = CHAVE_IA ? new Anthropic({ apiKey: CHAVE_IA, timeout: 60_000, maxRetries: 1 }) : null;

function cabecalhos(origem: string | null, tipo = "application/json; charset=utf-8"): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem && ORIGENS.includes(origem) ? origem : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": tipo,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function responder(corpo: unknown, status: number, origem: string | null) {
  return new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });
}

// Respostas da equipe: lidas do banco no máximo a cada minuto (a equipe publica e vale quase na hora)
let respostasCache: { em: number; lista: RespostaEquipe[] } = { em: 0, lista: [] };
async function respostasEquipe(): Promise<RespostaEquipe[]> {
  if (Date.now() - respostasCache.em < 60_000) return respostasCache.lista;
  const { data } = await admin.rpc("respostas_equipe_assistente");
  respostasCache = { em: Date.now(), lista: (data ?? []) as RespostaEquipe[] };
  return respostasCache.lista;
}

interface Resultado {
  resposta: Resposta; situacao: "respondida" | "sem_resposta" | "fora_do_ar" | "teto";
  modelo: string | null; tokens: Record<string, number> | null; custo: number | null;
}

/** Pergunta ao modelo em streaming; aoEscrever recebe o texto já escrito (para a tela mostrar enquanto chega). */
async function perguntarIA(pedido: Pedido, pergunta: string, ctx: Contexto | null, lista: RespostaEquipe[],
                           aoEscrever: (texto: string) => void): Promise<Resultado> {
  if (!ia) return { resposta: FORA_DO_AR, situacao: "fora_do_ar", modelo: null, tokens: null, custo: null };
  const permitidas = acoesPermitidas(ctx);
  const contexto = textoContexto(ctx, pedido.frente, pedido.tela_nome, permitidas);
  const sistema: { type: "text"; text: string; cache_control: { type: "ephemeral"; ttl: "1h" } }[] = [
    { type: "text", text: `${INSTRUCOES}\n\n# BASE DE CONHECIMENTO\n\n${CONHECIMENTO}`,
      cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  const bloco = blocoRespostasEquipe(lista);
  if (bloco) sistema.push({ type: "text", text: bloco, cache_control: { type: "ephemeral", ttl: "1h" } });

  const stream = ia.beta.messages.stream({
    model: MODELO,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                     // recusa do classificador vai para outro modelo, sem lógica aqui
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    system: sistema,
    messages: montarMensagens(pedido.historico, pergunta, pedido.tela, contexto),
  });
  let json = "", ultimo = "";
  for await (const ev of stream) {
    if (ev.type === "content_block_start" && ev.content_block.type === "text") json = "";   // troca de modelo: recomeça
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      json += ev.delta.text;
      const t = textoParcial(json);
      if (t && t !== ultimo) {
        ultimo = t;
        aoEscrever(t);
      }
    }
  }
  const r = await stream.finalMessage();
  const u = r.usage;
  const tokens = { entrada: u.input_tokens ?? 0, saida: u.output_tokens ?? 0,
                   cache_gravado: u.cache_creation_input_tokens ?? 0, cache_lido: u.cache_read_input_tokens ?? 0 };
  const base = { modelo: r.model ?? MODELO, tokens, custo: custoUsd(r.model ?? MODELO, u) };
  if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return { ...base, resposta: SEM_RESPOSTA, situacao: "sem_resposta" };
  const textos = r.content.filter((b) => b.type === "text");
  const final = textos.length ? (textos[textos.length - 1] as { text: string }).text : "";
  let resposta: Resposta;
  try {
    resposta = montarResposta(JSON.parse(final), permitidas, new Set(lista.map((x) => x.id)));
  } catch {
    resposta = SEM_RESPOSTA;
  }
  return { ...base, resposta, situacao: resposta.respondida ? "respondida" : "sem_resposta" };
}

/** Teto do mês atingido: só a Resposta da equipe parecida, ou o Suporte. */
function semModelo(pergunta: string, frente: string | null, lista: RespostaEquipe[], permitidas: Set<string>): Resultado {
  const r = respostaDaEquipe(pergunta, lista, frente);
  if (!r) return { resposta: NO_TETO, situacao: "teto", modelo: null, tokens: null, custo: null };
  const acao = r.acao && permitidas.has(r.acao) ? r.acao : null;
  return {
    resposta: { ...montarResposta({ respondida: true, texto: r.resposta, passos: r.passos, acao: acao ?? "nenhuma" }),
                tema: null, resposta_equipe: r.id },
    situacao: "respondida", modelo: null, tokens: null, custo: null,
  };
}

async function registrar(usuario: string, empresa: number | null, pedido: Pedido, pergunta: string, removeu: boolean,
                         res: Resultado, ms: number) {
  const { resposta } = res;
  const { data } = await admin.from("assistente_perguntas").insert({
    usuario_id: usuario, empresa_id: empresa, origem: pedido.origem, tela: pedido.tela, tela_nome: pedido.tela_nome,
    pergunta, respondida: resposta.respondida, situacao: res.situacao, tema: resposta.tema ?? null,
    resposta: [resposta.texto, ...resposta.passos.map((p, i) => `${i + 1}. ${p}`)].join("\n").slice(0, 4000),
    acao: resposta.acao?.id ?? null, modelo: res.modelo, tokens: res.tokens, custo_usd: res.custo, ms,
    removeu_dado: removeu, resposta_equipe_id: resposta.resposta_equipe ?? null,
  }).select("id").maybeSingle();
  return (data?.id ?? null) as number | null;
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
  const { data: perfil } = await admin.from("perfis").select("empresa_id, equipe, ativo")
    .eq("id", sessao.user.id).maybeSingle();
  if (!perfil?.ativo) return responder({ erro: "acesso desativado" }, 403, origem);

  // chamado aberto pelo Assistente: motivo, assunto e conversa já sem dado pessoal (sem chamar o modelo)
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.acao === "chamado") {
    const { pedido, erro } = validarPedido({ ...c, pergunta: typeof c.pergunta === "string" && c.pergunta.trim() ? c.pergunta : "—" });
    if (!pedido) return responder({ erro }, 400, origem);
    const aval = typeof c.avaliacao === "string" ? c.avaliacao.slice(0, 60) : null;
    const hist: Mensagem[] = pedido.historico.slice(-MAX_HISTORICO);
    const assunto = anonimizar(pedido.pergunta !== "—" ? pedido.pergunta : (hist.find((m) => m.papel === "usuario")?.texto ?? "Dúvida")).texto;
    return responder({ motivo: motivoDoChamado(pedido.tela), assunto: assunto.slice(0, 120),
                       conversa: conversaParaChamado(hist, pedido.tela_nome, aval) }, 200, origem);
  }

  const { pedido, erro } = validarPedido(corpo);
  if (!pedido) return responder({ erro }, 400, origem);
  const { data: naHora } = await admin.rpc("perguntas_na_hora", { usuario: sessao.user.id });
  if ((naHora ?? 0) >= LIMITE_POR_HORA) {
    return responder({ erro: "muitas perguntas seguidas; tente de novo em alguns minutos" }, 429, origem);
  }
  // equipe: a empresa só vale se existir (o registro não fica com empresa errada)
  let empresa: number | null = perfil.empresa_id ?? null;
  if (perfil.equipe) {
    empresa = null;
    if (pedido.empresa_id) {
      const { data: e } = await admin.from("empresas").select("id").eq("id", pedido.empresa_id).maybeSingle();
      empresa = e?.id ?? null;
    }
  }
  const { texto: pergunta, removeu } = anonimizar(pedido.pergunta);
  const { data: ctxBruto } = await admin.rpc("contexto_assistente", { usuario: sessao.user.id });
  const ctx = (ctxBruto ?? null) as Contexto | null;
  const { data: custo } = await admin.rpc("assistente_custo_mes");
  const noTeto = Number((Array.isArray(custo) ? custo[0] : custo)?.pct ?? 0) >= 100;
  const lista = await respostasEquipe();
  const inicio = Date.now();

  const responderCom = async (aoEscrever: (t: string) => void) => {
    let res: Resultado;
    if (noTeto) {
      res = semModelo(pergunta, pedido.frente, lista, acoesPermitidas(ctx));
    } else {
      try {
        res = await perguntarIA(pedido, pergunta, ctx, lista, aoEscrever);
      } catch (e) {
        console.error("assistente", e instanceof Anthropic.APIError ? e.status : "erro");  // sem texto do usuário no log
        res = { resposta: FORA_DO_AR, situacao: "fora_do_ar", modelo: MODELO, tokens: null, custo: null };
      }
    }
    const id = await registrar(sessao.user.id, empresa, pedido, pergunta, removeu, res, Date.now() - inicio);
    return { id, ...res.resposta, situacao: res.situacao, removeu };
  };

  if (!pedido.stream) return responder(await responderCom(() => {}), 200, origem);

  const enc = new TextEncoder();
  const corpoSse = new ReadableStream({
    async start(ctrl) {
      const enviar = (evento: string, dados: unknown) =>
        ctrl.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`));
      try {
        enviar("fim", await responderCom((t) => enviar("texto", { texto: t })));
      } catch {
        enviar("fim", { id: null, ...FORA_DO_AR, situacao: "fora_do_ar", removeu });
      }
      ctrl.close();
    },
  });
  return new Response(corpoSse, { status: 200, headers: cabecalhos(origem, "text/event-stream; charset=utf-8") });
});
