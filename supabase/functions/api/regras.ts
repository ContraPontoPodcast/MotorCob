// Regras da API das cargas (sem rede): rotas, token, escopo, credor e validação dos parâmetros.
// O banco guarda só o hash do token; quem confere o resto é index.ts, com a chave do servidor.

export const ESCOPOS = ["cargas:enviar", "cargas:status", "lista:ler"] as const;
export type Escopo = (typeof ESCOPOS)[number];
// tipos de carga aceitos (os mesmos de "Enviar arquivos" no site); "geral" é apelido de "base"
export const TIPOS_CARGA = ["base", "incremental", "retirada", "acordo", "baixa", "ocorrencia"] as const;
export const CANAIS_LISTA = ["whatsapp", "rcs", "sms", "email", "agente_voz", "discador"] as const;
export const LIMITE_MINUTO = 60;
export const TAMANHO_MAX = 20 * 1024 * 1024; // 20 MB
const EXTENSOES = ["csv", "txt", "xlsx"];

export interface Token {
  id: number;
  empresa_id: number;
  prefixo: string;
  escopos: string[];
  credor_ids: number[] | null;
  criado_por: string;
  expira_em: string;
  revogado_em: string | null;
}

export type Rota =
  | { nome: "enviar_carga" }
  | { nome: "status_carga"; id: number }
  | { nome: "lista" };

/** Acha a rota pelo pedaço "/v1/..." do caminho (no Supabase o caminho começa com /api). */
export function rota(metodo: string, caminho: string): Rota | null {
  const m = caminho.match(/.*\/v1(\/[^?]*)$/);   // o último "/v1" (o primeiro pode ser o do Supabase)
  if (!m) return null;
  const p = m[1].replace(/\/+$/, "");
  if (metodo === "POST" && p === "/cargas") return { nome: "enviar_carga" };
  const s = p.match(/^\/cargas\/(\d{1,15})$/);
  if (metodo === "GET" && s) return { nome: "status_carga", id: Number(s[1]) };
  if (metodo === "GET" && p === "/lista-do-dia") return { nome: "lista" };
  return null;
}

export function tokenDoCabecalho(h: string | null): string | null {
  const m = (h ?? "").match(/^Bearer\s+(mc_[0-9a-f]{64})$/);
  return m ? m[1] : null;
}

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Motivo para recusar o token (401), ou null. */
export function tokenInvalido(t: Token | null, agora: Date): string | null {
  if (!t) return "token inválido";
  if (t.revogado_em) return "token revogado";
  if (new Date(t.expira_em) <= agora) return "token vencido: crie outro em Minha conta › Tokens de API";
  return null;
}

/** Motivo para recusar a ação (403), ou null. */
export function semAcesso(t: Token, escopo: Escopo, credorId?: number): string | null {
  if (!t.escopos.includes(escopo)) return `o token não tem o escopo ${escopo}`;
  if (credorId !== undefined && t.credor_ids && !t.credor_ids.includes(credorId)) return "o token não vale para este credor";
  return null;
}

export function nomeSeguro(nome: string): string {
  const base = (nome.split(/[\\/]/).pop() ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 100);
}

const CODIGO = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function validarCarga(q: URLSearchParams, tamanho: number):
  { erro?: string; credor?: string; tipo?: string; nome?: string } {
  const credor = q.get("credor") ?? "";
  if (!CODIGO.test(credor)) return { erro: "informe o credor pelo código (ex.: ?credor=banco-x)" };
  let tipo = (q.get("tipo") ?? "").toLowerCase();
  if (tipo === "geral") tipo = "base";
  if (!(TIPOS_CARGA as readonly string[]).includes(tipo)) {
    return { erro: "tipo inválido: use geral, incremental, retirada, acordo, baixa ou ocorrencia" };
  }
  const nome = nomeSeguro(q.get("nome") ?? "");
  const ext = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  if (!nome || !EXTENSOES.includes(ext)) return { erro: "informe o nome do arquivo com .csv, .txt ou .xlsx (?nome=carga.csv)" };
  if (tamanho <= 0) return { erro: "arquivo vazio" };
  if (tamanho > TAMANHO_MAX) return { erro: "arquivo acima de 20 MB: divida em partes" };
  return { credor, tipo, nome };
}

export function validarLista(q: URLSearchParams, hoje: string):
  { erro?: string; credor?: string; data?: string; canal?: string } {
  const credor = q.get("credor") ?? "";
  if (!CODIGO.test(credor)) return { erro: "informe o credor pelo código (ex.: ?credor=banco-x)" };
  const data = q.get("data") ?? hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(Date.parse(data))) return { erro: "data no formato AAAA-MM-DD" };
  const canal = q.get("canal") ?? "";
  if (!(CANAIS_LISTA as readonly string[]).includes(canal)) {
    return { erro: "canal inválido: use whatsapp, rcs, sms, email, agente_voz ou discador" };
  }
  return { credor, data, canal };
}

export function hojeSP(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}
