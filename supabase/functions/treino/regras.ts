// Regras da Edge Function `treino` (sessão de treino de operadores por TEXTO, SQL 100), sem rede nem banco: o que o site
// pode pedir, como a conversa cresce, o pacote que vai à VM e o `dados` de registrar_sessao_treino. Testadas em
// regras.test.ts (node --experimental-strip-types --test).

export type Acao = "turno" | "encerrar" | "sair";
export type Pedido = { acao: Acao; sessao: number; token: string | null; texto: string | null };
export type Turno = { quem: "persona" | "operador"; texto: string; t?: number };

export const MAX_TEXTO = 600;
export const MAX_FALAS_OPERADOR = 60;
/** Folga depois da duração máxima do cenário (a última fala que estava sendo escrita ainda entra). */
export const FOLGA_S = 30;

const TOKEN = /^[0-9a-f]{64}$/;

/** O que o site manda: {acao, sessao, token?, texto?}. Token = link pessoal do operador (sem login). */
export function validarPedido(c: unknown): { pedido?: Pedido; erro?: string } {
  if (!c || typeof c !== "object" || Array.isArray(c)) return { erro: "pedido inválido" };
  const x = c as Record<string, unknown>;
  const fora = Object.keys(x).filter((k) => !["acao", "sessao", "token", "texto"].includes(k));
  if (fora.length) return { erro: "pedido inválido" };
  if (x.acao !== "turno" && x.acao !== "encerrar" && x.acao !== "sair") return { erro: "ação inválida: turno, encerrar ou sair" };
  if (typeof x.sessao !== "number" || !Number.isSafeInteger(x.sessao) || x.sessao <= 0) return { erro: "sessão inválida" };
  if (x.token != null && (typeof x.token !== "string" || !TOKEN.test(x.token))) return { erro: "link inválido ou vencido" };
  let texto: string | null = null;
  if (x.texto != null) {
    if (x.acao !== "turno") return { erro: "pedido inválido" };
    if (typeof x.texto !== "string" || !x.texto.trim() || x.texto.length > MAX_TEXTO) return { erro: `escreva de 1 a ${MAX_TEXTO} caracteres` };
    texto = x.texto;
  }
  return { pedido: { acao: x.acao, sessao: x.sessao, token: (x.token as string | undefined) ?? null, texto } };
}

export const falasDoOperador = (turnos: Turno[]) => turnos.filter((t) => t.quem === "operador").length;
export const temFalaDoOperador = (turnos: Turno[]) => falasDoOperador(turnos) > 0;
export const tempoEsgotado = (segundos: number, duracaoMax: number) => segundos >= duracaoMax + FOLGA_S;

/** A conversa depois de um turno: a fala do operador (já mascarada pela VM) e a resposta do cliente simulado. */
export function somarTurno(turnos: Turno[], operador: string | null, fala: string, segundos: number): Turno[] {
  const t = Math.max(0, Math.round(segundos));
  return [...turnos, ...(operador ? [{ quem: "operador" as const, texto: operador, t }] : []), { quem: "persona" as const, texto: fala, t }];
}

/** Só quem/texto/t vão para a VM e para o banco (o mesmo formato de transcricao_treino_ok). */
export const limparTurnos = (turnos: unknown): Turno[] =>
  (Array.isArray(turnos) ? turnos : []).filter((t): t is Turno => !!t && typeof t === "object" && (t.quem === "persona" || t.quem === "operador") && typeof t.texto === "string")
    .map((t) => ({ quem: t.quem, texto: t.texto.slice(0, MAX_TEXTO), ...(typeof t.t === "number" ? { t: t.t } : {}) }));

export type Contexto = {
  sessao: number; origem: "link" | "lado_a_lado" | "teste"; modo: string; situacao: string; segundos: number; duracao_max_s: number;
  cenario: Record<string, unknown>; checklist: { versao_id: number | null; itens: unknown[] }; turnos: Turno[]; tokens: number; saldo: string | null;
};

export const pacoteTurno = (ctx: Contexto, texto: string | null) =>
  ({ treino: "turno", sessao: ctx.sessao, cenario: ctx.cenario, turnos: limparTurnos(ctx.turnos), texto });
export const pacoteAvaliar = (ctx: Contexto) =>
  ({ treino: "avaliar", sessao: ctx.sessao, cenario: ctx.cenario, checklist: ctx.checklist, turnos: limparTurnos(ctx.turnos) });

const CAMPOS_AVALIADA = ["nota", "itens", "evidencia", "reprovada", "item_reprovado", "objetivo_ok", "feedback"] as const;

/** `dados` de registrar_sessao_treino a partir da avaliação da VM (ou de uma falha: não conta e não cobra). */
export function dadosRegistro(av: Record<string, unknown> | null, ctx: Contexto): Record<string, unknown> {
  const duracao_s = Math.min(3600, Math.max(0, Math.round(ctx.segundos)));
  const tokens = Math.max(0, Math.round(Number(ctx.tokens) || 0) + Math.round(Number(av?.tokens) || 0));
  if (!av || av.situacao !== "avaliada") return { situacao: "falhou", motivo_falha: "servico", duracao_s, tokens };
  const d: Record<string, unknown> = { situacao: "avaliada", duracao_s, tokens, transcricao: limparTurnos(ctx.turnos) };
  for (const k of CAMPOS_AVALIADA) if (k in av) d[k] = av[k];
  d.feedback = (Array.isArray(av.feedback) ? av.feedback : []).filter((f) => f && typeof f === "object" && typeof (f as { dica?: unknown }).dica === "string");
  return d;
}

/** Saiu sem contar: com fala do operador, a sessão vira abandonada e o uso é registrado (a IA rodou); sem fala, só fecha. */
export const dadosAbandono = (ctx: Contexto) =>
  ({ situacao: "abandonada", duracao_s: Math.min(3600, Math.max(0, Math.round(ctx.segundos))), tokens: Math.max(0, Math.round(Number(ctx.tokens) || 0)) });

/** Erro do banco → status e mensagem para a tela (sem detalhe interno). */
export function erroDoBanco(msg: string | undefined): { status: number; erro: string } {
  const m = (msg ?? "").toLowerCase();
  if (m.includes("link inválido")) return { status: 401, erro: "Este link de treino não abre mais. Peça o link atual à Qualidade." };
  if (m.includes("indisponíveis") || m.includes("não está contratado")) return { status: 403, erro: "Os treinos estão indisponíveis para a empresa." };
  if (m.includes("já terminou")) return { status: 409, erro: "Esta sessão já terminou." };
  if (m.includes("sem permissão")) return { status: 403, erro: "Seu perfil não pode conduzir esta sessão." };
  return { status: 404, erro: "Sessão não encontrada." };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
/** HMAC-SHA256 do simulador da VM (mesma chave e formato do simular_fluxo_voz). */
export async function assinarVM(chave: string, carimbo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${carimbo}.${corpo}`)));
}
