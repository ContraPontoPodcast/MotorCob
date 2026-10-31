// Regras da Edge Function gravacoes (sem rede; testáveis com node --test): validação do pedido, quem pode ouvir ou
// ler, URL assinada V4 do Cloud Storage (5 minutos, só GET) e leitura da transcrição redigida.
// LGPD: nada aqui guarda, registra em log ou devolve nome, CPF ou telefone. A transcrição já chega redigida do
// pipeline; a função ainda mascara, por garantia, sequências longas de dígitos e e-mails que tenham escapado.

export type Tipo = "audio" | "transcricao";
export interface Pedido { gravacao: number; tipo: Tipo }
export interface Perfil { id: string; ativo: boolean; equipe: boolean; empresa_id: number | null }
export interface Gravacao { id: number; empresa_id: number; caminho: string; transcricao_caminho: string | null }
export interface Segmento { quem: "agente" | "pessoa" | "operador"; em_s: number | null; texto: string }

/** Validade do link de escuta (o site mostra a contagem regressiva). */
export const VALIDADE_S = 300;
/** Validade do link interno que a própria função usa para ler a transcrição. */
export const VALIDADE_LEITURA_S = 60;

export const PERMISSAO: Record<Tipo, string> = { audio: "ouvir_gravacoes", transcricao: "ver_transcricoes" };
export const ACAO_ACESSO: Record<Tipo, string> = { audio: "ouvir_gravacao", transcricao: "ler_transcricao" };

export function validarPedido(corpo: unknown): { pedido?: Pedido; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  const extras = Object.keys(c).filter((k) => k !== "gravacao" && k !== "tipo");
  if (extras.length) return { erro: "pedido inválido" };
  if (!Number.isSafeInteger(c.gravacao) || (c.gravacao as number) <= 0) return { erro: "gravação inválida" };
  if (c.tipo !== "audio" && c.tipo !== "transcricao") return { erro: "tipo inválido: audio ou transcricao" };
  return { pedido: { gravacao: c.gravacao as number, tipo: c.tipo } };
}

/**
 * Quem pode: pessoa ativa do cliente (a equipe MotorCX não ouve gravação de devedor por aqui), da mesma empresa da
 * gravação, com a permissão do tipo (pode() no banco, que já soma o padrão do perfil e o ajuste do Admin).
 * Devolve o motivo da recusa, ou null. "não encontrada" vira 404 para não revelar se a gravação existe.
 */
export function autorizar(quem: Perfil | null, pode: boolean, g: Gravacao | null): string | null {
  if (!quem || !quem.ativo) return "acesso desativado";
  if (quem.equipe) return "a equipe MotorCX não ouve nem lê gravações pelo site";
  if (!g || quem.empresa_id == null || Number(g.empresa_id) !== Number(quem.empresa_id)) return "gravação não encontrada";
  if (!pode) return "sem permissão";
  return null;
}

// ---------------------------------------------------------------- credencial (secret GCS_GRAVACOES_CHAVE)
export interface Chave { client_email: string; private_key: string }

/** Lê o JSON da conta de serviço (só leitura de objeto). Nunca devolve nem registra a chave em erro. */
export function lerChave(json: string | undefined): Chave | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Record<string, unknown>;
    const email = typeof c.client_email === "string" ? c.client_email : "";
    const pk = typeof c.private_key === "string" ? c.private_key : "";
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
    if (!pk.includes("BEGIN PRIVATE KEY")) return null;
    return { client_email: email, private_key: pk };
  } catch {
    return null;
  }
}

/** PEM PKCS#8 → bytes DER (para crypto.subtle.importKey). */
export function pemParaDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- URL assinada V4 (GOOG4-RSA-SHA256)
const HOST = "storage.googleapis.com";

/** Codificação RFC 3986 (a que o GCS exige no caminho e na query). */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export const RE_BUCKET = /^[a-z0-9][a-z0-9_.-]{1,61}[a-z0-9]$/;
export const RE_CAMINHO = /^[A-Za-z0-9_\-/.]+$/;

/** Caminho do objeto no formato path-style, cada segmento codificado. Recusa ".." e caminho com 10+ dígitos. */
export function caminhoObjeto(bucket: string, objeto: string): string {
  if (!RE_BUCKET.test(bucket)) throw new Error("bucket inválido");
  if (!RE_CAMINHO.test(objeto) || objeto.split("/").some((p) => p === ".." || p === "." || p === "") || /[0-9]{10,}/.test(objeto)) {
    throw new Error("caminho inválido");
  }
  return `/${bucket}/${objeto.split("/").map(rfc3986).join("/")}`;
}

/** "2026-10-31T17:13:32.123Z" → { data: "20261031", hora: "20261031T171332Z" }. */
export function carimbo(agora: Date): { data: string; hora: string } {
  const hora = agora.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { data: hora.slice(0, 8), hora };
}

/** Pedido canônico e texto a assinar da V4 (só GET, só o cabeçalho host, sem corpo). */
export function textoParaAssinar(p: { email: string; bucket: string; objeto: string; agora: Date; validade: number }) {
  if (!Number.isInteger(p.validade) || p.validade < 1 || p.validade > 604800) throw new Error("validade inválida");
  const { data, hora } = carimbo(p.agora);
  const escopo = `${data}/auto/storage/goog4_request`;
  const caminho = caminhoObjeto(p.bucket, p.objeto);
  const q: [string, string][] = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", `${p.email}/${escopo}`],
    ["X-Goog-Date", hora],
    ["X-Goog-Expires", String(p.validade)],
    ["X-Goog-SignedHeaders", "host"],
  ];
  const query = q.map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const canonico = ["GET", caminho, query, `host:${HOST}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  return { caminho, query, canonico, escopo, hora };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");

/** URL assinada V4. `assinar` recebe os bytes do texto e devolve a assinatura RSA-SHA256 (crypto.subtle). */
export async function urlAssinada(p: { email: string; bucket: string; objeto: string; agora: Date; validade: number },
                                  assinar: (dados: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>): Promise<{ url: string; expira_em: string }> {
  const t = textoParaAssinar(p);
  const resumo = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t.canonico)));
  const texto = ["GOOG4-RSA-SHA256", t.hora, t.escopo, resumo].join("\n");
  const assinatura = hex(await assinar(new TextEncoder().encode(texto)));
  return {
    url: `https://${HOST}${t.caminho}?${t.query}&X-Goog-Signature=${assinatura}`,
    expira_em: new Date(p.agora.getTime() + p.validade * 1000).toISOString(),
  };
}

/** Assinador com a chave da conta de serviço (WebCrypto: existe no Deno e no Node 22). */
export async function assinadorDe(chave: Chave): Promise<(dados: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("pkcs8", pemParaDer(chave.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return (dados) => crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, dados);
}

// ---------------------------------------------------------------- transcrição
/** Máscara de garantia: CPF, cartão, telefone (8+ dígitos, com ou sem separador) e e-mail viram marcadores. */
export function mascarar(texto: string): string {
  return texto
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[E-MAIL]")
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[CPF]")
    .replace(/(?:\d[\s.\-()]?){8,}\d/g, "[NÚMERO]");
}

const QUEM: Record<string, Segmento["quem"]> = {
  agente: "agente", agent: "agente", ia: "agente", ai: "agente",
  pessoa: "pessoa", cliente: "pessoa", user: "pessoa",
  operador: "operador",
};

/** Aceita { segmentos: [...] } ou a lista direta; até 2.000 trechos de até 2.000 caracteres cada. */
export function lerTranscricao(json: unknown): Segmento[] | null {
  const lista = Array.isArray(json) ? json : json && typeof json === "object" ? (json as Record<string, unknown>).segmentos : null;
  if (!Array.isArray(lista)) return null;
  const out: Segmento[] = [];
  for (const s of lista.slice(0, 2000)) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const quem = QUEM[String(r.quem ?? r.role ?? "").toLowerCase()];
    const texto = typeof r.texto === "string" ? r.texto : typeof r.message === "string" ? r.message : "";
    if (!quem || !texto.trim()) continue;
    const t = Number(r.em_s ?? r.time_in_call_secs);
    out.push({ quem, em_s: Number.isFinite(t) && t >= 0 ? Math.round(t) : null, texto: mascarar(texto.trim().slice(0, 2000)) });
  }
  return out;
}
