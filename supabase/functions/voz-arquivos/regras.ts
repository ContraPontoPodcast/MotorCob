// Regras da Edge Function voz-arquivos (sem dependência do Supabase, para testar com node --test).
// A VM de voz (papel motorcx_voz, SQL 57) pede ao banco um bilhete de uso único para UM caminho validado e manda
// aqui no cabeçalho x-voz-bilhete. O banco guarda só o sha-256 do bilhete; quem decide o caminho é o banco.

export const BILHETE = /^[0-9a-f]{64}$/;
export const OPERACOES = ["baixar", "enviar", "apagar"] as const;
export type Operacao = (typeof OPERACOES)[number];
export const TAMANHO_MAX = 20 * 1024 * 1024;          // retorno de um dia; o mesmo teto da API

export function bilheteDoCabecalho(h: Headers): string | null {
  const b = (h.get("x-voz-bilhete") ?? "").trim();
  return BILHETE.test(b) ? b : null;
}

export function operacaoDoCabecalho(h: Headers): Operacao | null {
  const o = (h.get("x-voz-operacao") ?? "").trim();
  return (OPERACOES as readonly string[]).includes(o) ? (o as Operacao) : null;
}

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// o que o banco devolveu ao consumir o bilhete; qualquer coisa fora disso é recusada
export interface Uso { operacao: Operacao; bucket: "saidas" | "entradas" | "chamados"; caminho: string }
const CAMINHO = /^[a-z0-9][a-z0-9_\-./]{1,298}$/;
// anexo de pedido de fluxo (SQL 58, anexos_pedido_voz_ok): '<slug>/...' com o nome que a pessoa deu ao arquivo.
// Só para apagar, e só o que o banco já liberou (anexos_fluxo_vencidos) e emitiu bilhete.
const ANEXO = /^[a-z0-9][a-z0-9_\-]*\/[A-Za-z0-9_\-/. ]{1,290}$/;
export function usoValido(x: unknown, pedida: Operacao): Uso | null {
  const u = (Array.isArray(x) ? x[0] : x) as Record<string, unknown> | undefined;
  if (!u || u.operacao !== pedida) return null;
  const casado = (u.operacao === "baixar" && u.bucket === "saidas") ||
    (u.operacao === "enviar" && u.bucket === "entradas") ||
    (u.operacao === "apagar" && (u.bucket === "entradas" || u.bucket === "chamados"));
  if (!casado) return null;
  const c = String(u.caminho ?? "");
  const formato = u.bucket === "chamados" || (u.operacao === "apagar" && !CAMINHO.test(c)) ? ANEXO : CAMINHO;
  if (!formato.test(c) || c.includes("..") || c.includes("//")) return null;
  return { operacao: pedida, bucket: u.bucket as Uso["bucket"], caminho: c };
}

// caminho do objeto na API do Storage, com cada pedaço codificado
export function urlObjeto(base: string, bucket: string, caminho: string): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${caminho.split("/").map(encodeURIComponent).join("/")}`;
}

export function tamanhoAceito(declarado: string | null, real?: number): boolean {
  const d = Number(declarado ?? "0");
  if (!Number.isFinite(d) || d < 0 || d > TAMANHO_MAX) return false;
  return real === undefined || (real > 0 && real <= TAMANHO_MAX);
}
