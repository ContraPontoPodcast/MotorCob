// Leitura dos avisos de cada fornecedor (sem rede, testável com node --test). Cada aviso vira uma linha de
// mensageria_eventos SEM o número nem o e-mail do cliente: na resposta, só o hash do número (igual ao do motor).

export interface Evento {
  fornecedor: string;
  evento_id: string | null;
  id_externo: string | null;
  tipo: "enviado" | "entregue" | "falhou" | "resposta" | "bounce" | "abertura" | "clique" | "spam";
  canal: "sms" | "rcs" | "email" | "whatsapp" | null;
  motivo?: string | null;
  bounce?: "permanente" | "temporario" | null;
  de_hash?: string | null;
  texto?: string | null;
  ocorrido_em?: string | null;
}

/** Igual a nuvem/mensageria.normalizar: só dígitos, sem o 55 do Brasil. */
export function normalizar(numero: string): string {
  const d = String(numero ?? "").replace(/\D/g, "");
  return /^55\d{10,11}$/.test(d) ? d.slice(2) : d;
}

export async function hashNumero(numero: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizar(numero)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const curto = (s: unknown, n = 200) => (s == null || s === "" ? null : String(s).slice(0, n));
const data = (s: unknown) => {
  const t = Date.parse(String(s ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const canalDe = (c: unknown): Evento["canal"] => {
  const v = String(c ?? "").toLowerCase();
  return v === "sms" || v === "rcs" || v === "whatsapp" || v === "email" ? v : null;
};

// ---------------------------------------------------------------- Zenvia (assinatura da conta, API v2)
export async function zenvia(b: Record<string, any>): Promise<Evento[]> {
  const m = b.message ?? {};
  const canal = canalDe(b.channel ?? m.channel);
  if (b.type === "MESSAGE_STATUS") {
    const st = b.messageStatus ?? {};
    const tipo = ({ SENT: "enviado", DELIVERED: "entregue", READ: "entregue", NOT_DELIVERED: "falhou", REJECTED: "falhou" } as Record<string, Evento["tipo"]>)[st.code];
    if (!tipo) return [];
    const causa = st.causes?.[0];
    return [{ fornecedor: "zenvia", evento_id: curto(b.id), id_externo: curto(m.id ?? b.messageId, 120), tipo, canal,
      motivo: tipo === "falhou" ? curto([causa?.reason, causa?.details ?? st.description].filter(Boolean).join(": ") || st.code) : null,
      ocorrido_em: data(st.timestamp ?? b.timestamp) }];
  }
  if (b.type === "MESSAGE" && (m.direction ?? "IN") === "IN" && m.from) {
    const texto = (m.contents ?? []).map((c: any) => c?.text ?? c?.payload ?? "").filter(Boolean).join(" ");
    return [{ fornecedor: "zenvia", evento_id: curto(b.id), id_externo: null, tipo: "resposta", canal: canal ?? "sms",
      de_hash: await hashNumero(m.from), texto: curto(texto, 2000), ocorrido_em: data(b.timestamp) }];
  }
  return [];
}

// ---------------------------------------------------------------- Infobip (webhook do envio ou assinatura)
export async function infobip(b: Record<string, any>, canalRota: Evento["canal"] = null): Promise<Evento[]> {
  const saida: Evento[] = [];
  for (const r of Array.isArray(b.results) ? b.results : []) {
    if (r.status) {
      const g = String(r.status.groupName ?? "").toUpperCase();
      const tipo = ({ PENDING: "enviado", DELIVERED: "entregue", UNDELIVERABLE: "falhou", EXPIRED: "falhou", REJECTED: "falhou" } as Record<string, Evento["tipo"]>)[g];
      if (!tipo || !r.messageId) continue;
      saida.push({ fornecedor: "infobip", evento_id: curto(`${r.messageId}:${r.status.name ?? g}`), id_externo: curto(r.messageId, 120),
        tipo, canal: canalRota, ocorrido_em: data(r.doneAt ?? r.sentAt),
        motivo: tipo === "falhou" ? curto(r.error?.description ?? r.status.description ?? r.status.name) : null });
    } else if (r.from && (r.text ?? r.cleanText ?? r.message?.text)) {
      saida.push({ fornecedor: "infobip", evento_id: curto(r.messageId), id_externo: null, tipo: "resposta", canal: canalRota ?? "sms",
        de_hash: await hashNumero(r.from), texto: curto(r.cleanText ?? r.text ?? r.message?.text, 2000), ocorrido_em: data(r.receivedAt) });
    }
  }
  return saida;
}

// ---------------------------------------------------------------- Sinch (callback_url do envio)
export async function sinch(b: Record<string, any>): Promise<Evento[]> {
  if (b.type === "recipient_delivery_report_sms") {
    const s = String(b.status ?? "");
    const tipo: Evento["tipo"] | undefined = s === "Dispatched" ? "enviado" : s === "Delivered" ? "entregue"
      : ["Failed", "Expired", "Rejected", "Aborted", "Cancelled", "Deleted"].includes(s) ? "falhou" : undefined;
    if (!tipo || !b.batch_id) return [];
    return [{ fornecedor: "sinch", evento_id: curto(`${b.batch_id}:${s}:${b.code ?? ""}`), id_externo: curto(b.batch_id, 120), tipo,
      canal: "sms", motivo: tipo === "falhou" ? curto(`${s} (código ${b.code ?? "?"})`) : null, ocorrido_em: data(b.operator_status_at ?? b.at) }];
  }
  if (b.type === "mo_text" && b.from) {
    return [{ fornecedor: "sinch", evento_id: curto(b.id), id_externo: null, tipo: "resposta", canal: "sms",
      de_hash: await hashNumero(b.from), texto: curto(b.body, 2000), ocorrido_em: data(b.received_at) }];
  }
  return [];
}

// ---------------------------------------------------------------- Locaweb (webhook da conta: bounce e abertura)
export function locaweb(b: Record<string, any>): Evento[] {
  const id = curto(b["x-smtplw"] ?? b.x_smtplw ?? b.message_id, 120);
  if (!id) return [];
  if (b.bounce_code != null || b.bounce_description) {
    const temporario = /^4/.test(String(b.bounce_code ?? "")) || /tempor|mailbox full|caixa cheia|try again/i.test(String(b.bounce_description ?? ""));
    return [{ fornecedor: "locaweb", evento_id: curto(`${id}:bounce:${b.bounce_code ?? ""}`), id_externo: id, tipo: "bounce", canal: "email",
      bounce: temporario ? "temporario" : "permanente", motivo: curto(b.bounce_description ?? `bounce ${b.bounce_code}`) }];
  }
  if (b.opened_at) {
    return [{ fornecedor: "locaweb", evento_id: curto(`${id}:abertura`), id_externo: id, tipo: "abertura", canal: "email",
      ocorrido_em: data(b.opened_at) }];
  }
  return [];
}

/** Corpo em JSON ou formulário (a Locaweb manda formulário). */
export function lerCorpo(texto: string, tipo: string | null): Record<string, any> {
  if ((tipo ?? "").includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(texto));
  try { return JSON.parse(texto); } catch { return Object.fromEntries(new URLSearchParams(texto)); }
}

export function iguais(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const FORNECEDORES = ["zenvia", "infobip", "sinch", "locaweb"] as const;
