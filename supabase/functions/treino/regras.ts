// Regras da Edge Function `treino` (sessão de treino de operadores por TEXTO, SQL 100, e por VOZ, SQL 119), sem rede nem
// banco: o que o site pode pedir, como a conversa cresce, o pacote que vai à VM, o bilhete do WebSocket da voz, o
// resultado assinado que a VM devolve e o `dados` de registrar_sessao_treino. Testadas em regras.test.ts
// (node --experimental-strip-types --test).

export type Acao = "turno" | "encerrar" | "sair" | "voz" | "ouvir";
export type Pedido = {
  acao: Acao; sessao: number; token: string | null; texto: string | null;
  /** só no "ouvir" (antes de abrir a sessão): pelo link, a atribuição; logado, o cenário e a empresa */
  atribuicao?: number | null; cenario?: number | null; empresa?: number | null;
};
export type Turno = { quem: "persona" | "operador"; texto: string; t?: number };

export const MAX_TEXTO = 600;
export const MAX_FALAS_OPERADOR = 60;
/** Folga depois da duração máxima do cenário (a última fala que estava sendo escrita ainda entra). */
export const FOLGA_S = 30;

const TOKEN = /^[0-9a-f]{64}$/;

const idOk = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** O que o site manda: {acao, sessao, token?, texto?}; no "ouvir", {acao, token, atribuicao} ou {acao, cenario, empresa}.
 *  Token = link pessoal do operador (sem login). */
export function validarPedido(c: unknown): { pedido?: Pedido; erro?: string } {
  if (!c || typeof c !== "object" || Array.isArray(c)) return { erro: "pedido inválido" };
  const x = c as Record<string, unknown>;
  if (x.acao === "ouvir") {
    const fora = Object.keys(x).filter((k) => !["acao", "token", "atribuicao", "cenario", "empresa"].includes(k));
    if (fora.length) return { erro: "pedido inválido" };
    if (x.token != null && (typeof x.token !== "string" || !TOKEN.test(x.token))) return { erro: "link inválido ou vencido" };
    if (x.token != null ? !idOk(x.atribuicao) : !(idOk(x.cenario) && idOk(x.empresa))) return { erro: "pedido inválido" };
    return { pedido: { acao: "ouvir", sessao: 0, token: (x.token as string | undefined) ?? null, texto: null,
      atribuicao: idOk(x.atribuicao) ? x.atribuicao : null, cenario: idOk(x.cenario) ? x.cenario : null, empresa: idOk(x.empresa) ? x.empresa : null } };
  }
  const fora = Object.keys(x).filter((k) => !["acao", "sessao", "token", "texto"].includes(k));
  if (fora.length) return { erro: "pedido inválido" };
  if (x.acao !== "turno" && x.acao !== "encerrar" && x.acao !== "sair" && x.acao !== "voz") return { erro: "ação inválida: turno, encerrar, sair, voz ou ouvir" };
  if (!idOk(x.sessao)) return { erro: "sessão inválida" };
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
  /** sessão por voz (SQL 119): segundos que ainda cabem na franquia do mês */
  voz_restante_s?: number | null;
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
  if (m.includes("limite de prévias")) return { status: 429, erro: "Você já ouviu a voz várias vezes nesta hora. Tente de novo em alguns minutos." };
  if (m.includes("não encontrado")) return { status: 404, erro: "Treino não encontrado." };
  return { status: 404, erro: "Sessão não encontrada." };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
/** HMAC-SHA256 do simulador da VM (mesma chave e formato do simular_fluxo_voz). */
export async function assinarVM(chave: string, carimbo: string, corpo: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${carimbo}.${corpo}`)));
}

// ---------------------------------------------------------------- voz (SQL 119): bilhete, limite e resultado da VM
/** Validade do bilhete do WebSocket: o navegador conecta logo depois de pedir. */
export const VALIDADE_BILHETE_S = 120;
/** Abaixo disso não vale abrir a ligação (a franquia de voz do mês acabou). */
export const MIN_VOZ_S = 30;
const LIMITE_MAX_S = 900;

/** O corte da sessão por voz: o menor entre a duração do cenário e o saldo de voz da franquia (e no máximo 15 min). */
export function limiteVoz(duracaoMax: number, restante: number | null | undefined): { limite_s: number; por_franquia: boolean } {
  const dur = Math.max(60, Math.min(LIMITE_MAX_S, Math.round(Number(duracaoMax) || 480)));
  const r = restante == null ? Infinity : Math.max(0, Math.floor(Number(restante) || 0));
  return r < dur ? { limite_s: r, por_franquia: true } : { limite_s: dur, por_franquia: false };
}

const b64url = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function hmacHex(chave: string, texto: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(texto)));
}

/** Bilhete de uso único do WebSocket da voz: base64url(JSON) + "." + HMAC("treino-voz." + base64url). O mesmo formato de
 *  voz/treino_voz.py (ler_bilhete). Leva o roteiro do cliente simulado para a VM; o navegador só repassa (não lê). */
export async function criarBilhete(chave: string, dados: Record<string, unknown>): Promise<string> {
  const corpo = b64url(new TextEncoder().encode(JSON.stringify(dados)));
  return `${corpo}.${await hmacHex(chave, `treino-voz.${corpo}`)}`;
}

/** O conteúdo do bilhete da sessão por voz. */
export function dadosBilhete(ctx: Contexto, agoraS: number): Record<string, unknown> {
  const { limite_s, por_franquia } = limiteVoz(ctx.duracao_max_s, ctx.voz_restante_s);
  const voz = typeof ctx.cenario.voz_tts === "string" && /^[A-Za-z0-9_.:-]{1,60}$/.test(ctx.cenario.voz_tts) ? ctx.cenario.voz_tts : null;
  return { v: 1, sessao: ctx.sessao, exp: Math.floor(agoraS) + VALIDADE_BILHETE_S, limite_s, por_franquia, voz, cenario: ctx.cenario, checklist: ctx.checklist };
}

/** A VM assina o resultado da sessão por voz com a mesma chave e o mesmo formato do simulador (carimbo.corpo, ±300 s). */
export async function conferirAssinaturaVM(chave: string, carimbo: string | null, assinatura: string | null, corpo: string, agoraS: number): Promise<boolean> {
  if (!chave || !carimbo || !assinatura || !/^\d{1,12}$/.test(carimbo) || Math.abs(agoraS - Number(carimbo)) > 300) return false;
  if (!/^[0-9a-f]{64}$/.test(assinatura)) return false;
  const esperado = await assinarVM(chave, carimbo, corpo);
  let dif = 0;
  for (let i = 0; i < 64; i++) dif |= esperado.charCodeAt(i) ^ assinatura.charCodeAt(i);
  return dif === 0;
}

const CAMPOS_VOZ = ["situacao", "motivo_falha", "duracao_s", "nota", "itens", "evidencia", "reprovada", "item_reprovado", "objetivo_ok",
  "tokens", "minutos_stt", "caracteres_tts", "transcricao", "feedback"];

/** O resultado que a VM devolve: {acao: "voz_registrar", sessao, dados, sem_fala}. Só os campos de registrar_sessao_treino
 *  (o banco confere de novo: situação, tamanhos, máscara da transcrição). */
export function validarRegistroVoz(c: unknown): { sessao: number; dados: Record<string, unknown>; sem_fala: boolean } | null {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const x = c as Record<string, unknown>;
  if (x.acao !== "voz_registrar" || !idOk(x.sessao) || !x.dados || typeof x.dados !== "object" || Array.isArray(x.dados)) return null;
  const d = x.dados as Record<string, unknown>;
  if (Object.keys(d).some((k) => !CAMPOS_VOZ.includes(k))) return null;
  if (d.situacao !== "avaliada" && d.situacao !== "abandonada" && d.situacao !== "falhou") return null;
  if (d.transcricao != null) d.transcricao = limparTurnos(d.transcricao);
  return { sessao: x.sessao, dados: d, sem_fala: x.sem_fala === true };
}

export function urlOuvir(urlSimular: string): string {
  return urlSimular.replace(/\/simular\/?$/, "") + "/ouvir";
}
/** Prévia da voz: minutos estimados pela fala (~15 caracteres por segundo), como no simular_fluxo_voz. */
export const minutosPrevia = (caracteres: number) => Math.round((Math.max(0, caracteres) / 900) * 1000) / 1000;
