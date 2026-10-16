// E-mails do sistema (SQL 42): o modelo único (nome MotorCX em texto, a frente, um título, o corpo, um rodapé com o
// motivo do envio e os dados da empresa), os remetentes do domínio e o envio pela conta de sistema da Locaweb,
// separada da conta das campanhas da Mensageria. Usado pelas funções cobranca, relatorios e emails.
// Secrets: EMAIL_SISTEMA_TOKEN (sem ele, LOCAWEB_TOKEN), EMAIL_LINK_SEGREDO (links de sair) e, opcionais,
// EMAIL_DE_ACESSO, EMAIL_DE_FINANCEIRO, EMAIL_DE_AVISOS, EMAIL_DE_RELATORIOS (endereço completo de cada remetente).

export type Remetente = "acesso" | "financeiro" | "avisos" | "relatorios";

export interface Rodape {
  dominio?: string | null; razao_social?: string | null; cnpj?: string | null; endereco?: string | null;
  email_suporte?: string | null;
}

export const esc = (t: string) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const NOMES: Record<Remetente, string> = {
  acesso: "MotorCX", financeiro: "MotorCX Financeiro", avisos: "MotorCX", relatorios: "MotorCX Relatórios",
};
const LEGADO: Partial<Record<Remetente, string>> = { financeiro: "FATURA_EMAIL_DE", relatorios: "RELATORIO_EMAIL_DE" };

/** Endereço e nome do remetente. O Secret próprio (EMAIL_DE_*) vence; depois o antigo (FATURA_EMAIL_DE,
 * RELATORIO_EMAIL_DE), cada um só para o seu tipo; sem nenhum, tipo@domínio. */
export function remetente(tipo: Remetente, dominio?: string | null, env: (k: string) => string | undefined = lerEnv) {
  const proprio = env(`EMAIL_DE_${tipo.toUpperCase()}`) || (LEGADO[tipo] ? env(LEGADO[tipo]!) : undefined);
  const email = (proprio || `${tipo}@${(dominio || "motorcob.online").trim().toLowerCase()}`).trim();
  return { email, nome: NOMES[tipo], cabecalho: `${NOMES[tipo]} <${email}>` };
}

function lerEnv(k: string) {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
}

export function botao(href: string, texto: string, cheio = true) {
  return `<a href="${esc(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;${cheio ? "background:#1D1D1F;color:#FFFFFF" : "background:#F2F2F5;color:#1D1D1F"}">${esc(texto)}</a>`;
}

export interface Moldura {
  frente: string;            // "Faturas", "Relatórios", "Integrações"...
  titulo: string;
  corpo: string;             // HTML já escapado
  motivo: string;            // por que a pessoa recebe (texto)
  sair?: string | null;      // link "Não quero mais estes e-mails" (só nos opcionais)
  sairTexto?: string;
  rodape?: Rodape | null;
}

/** O modelo único: sempre claro, largura 560, sem imagem (abre igual em qualquer programa e não cai no filtro de
 * spam por causa de imagem). */
export function pagina(m: Moldura): string {
  const r = m.rodape ?? {};
  const empresa = [r.razao_social, r.cnpj ? `CNPJ ${r.cnpj}` : null, r.endereco].filter(Boolean).map((x) => esc(String(x))).join(" · ");
  const sair = m.sair ? ` <a href="${esc(m.sair)}" style="color:#6E6E73">${esc(m.sairTexto ?? "Não quero mais estes e-mails")}</a>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${esc(m.titulo)}</title></head>
<body style="margin:0;padding:0;background:#F2F2F4">
<div style="padding:18px 12px;background:#F2F2F4">
<div style="max-width:560px;margin:0 auto;background:#FFFFFF;color:#1D1D1F;border:1px solid #E3E4E8;border-radius:12px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.5">
<div style="padding:14px 22px;border-bottom:1px solid #E3E4E8"><span style="font-weight:700;font-size:16px">MotorCX</span><span style="float:right;font-size:11.5px;font-weight:600;color:#6E6E73;text-transform:uppercase;letter-spacing:.05em;line-height:22px">${esc(m.frente)}</span></div>
<div style="padding:22px">
<h1 style="margin:0 0 12px;font-size:19px;line-height:1.3">${esc(m.titulo)}</h1>
${m.corpo}
</div>
<div style="padding:14px 22px;border-top:1px solid #E3E4E8;font-size:12px;color:#6E6E73">
<p style="margin:0 0 4px">${esc(m.motivo)}${sair}</p>
<p style="margin:0">MotorCX · ${esc(r.dominio || "motorcob.online")}${empresa ? " · " + empresa : ""}</p>
</div></div></div></body></html>`;
}

/** Versão só texto do mesmo e-mail (para registro, testes e provedores que aceitam). Tira as tags até não sobrar
 * nenhuma e só depois desfaz as entidades, com &amp; por último (assim "&amp;lt;" vira "&lt;", não "<"). */
export function textoPlano(html: string): string {
  let t = html.replace(/<head>[\s\S]*?<\/head>/i, "").replace(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g, "$2: $1")
    .replace(/<(br|\/p|\/h1|\/tr|\/div)>/gi, "\n");
  let antes: string;
  do {
    antes = t;
    t = t.replace(/<[^<>]*>/g, "");
  } while (t !== antes);
  t = t.replace(/[<>]/g, "");
  return t.replace(/&lt;/g, "‹").replace(/&gt;/g, "›").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

export const assuntoAscii = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s
  : "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + "?=";

export async function hashEmail(e: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e.trim().toLowerCase()));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Assinatura do link de sair (usuário + assunto), para funcionar sem login e não ser forjado. */
export async function assinar(segredo: string, usuario: string, assunto: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${usuario}|${assunto}`))).slice(0, 32);
}

export async function conferirAssinatura(segredo: string, usuario: string, assunto: string, t: string): Promise<boolean> {
  if (!segredo || !t) return false;
  const certo = await assinar(segredo, usuario, assunto);
  if (certo.length !== t.length) return false;
  let r = 0;
  for (let i = 0; i < t.length; i++) r |= certo.charCodeAt(i) ^ t.charCodeAt(i);
  return r === 0;
}

/** Link "Não quero mais estes e-mails": a página do site (/email/sair) e o endereço de um clique da função emails. */
export async function linksSair(segredo: string, site: string, funcoes: string, usuario: string, assunto: string) {
  const q = `u=${encodeURIComponent(usuario)}&a=${encodeURIComponent(assunto)}&t=${await assinar(segredo, usuario, assunto)}`;
  return { pagina: `${site.replace(/\/$/, "")}/email/sair?${q}`, umClique: `${funcoes.replace(/\/$/, "")}/emails/sair?${q}` };
}

export interface Envio {
  de: Remetente; para: string; assunto: string; html: string;
  responderPara?: string | null; umClique?: string | null; dominio?: string | null;
}

/** Um e-mail para um destinatário pela conta de sistema (API da Locaweb). Devolve o id da mensagem, que volta
 * nos avisos de devolução. */
export async function enviar(e: Envio, f: typeof fetch = fetch, env: (k: string) => string | undefined = lerEnv) {
  const token = env("EMAIL_SISTEMA_TOKEN") || env("LOCAWEB_TOKEN");
  if (!token) throw new Error("cadastre EMAIL_SISTEMA_TOKEN (conta de envio do sistema) nos Secrets do Supabase");
  const de = remetente(e.de, e.dominio, env);
  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
  if (e.responderPara) headers["Reply-To"] = e.responderPara;
  if (e.umClique) {
    headers["List-Unsubscribe"] = `<${e.umClique}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const r = await f("https://api.smtplw.com.br/v1/messages", {
    method: "POST",
    headers: { "x-auth-token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ subject: assuntoAscii(e.assunto.slice(0, 150)), body: e.html, to: e.para, from: de.cabecalho, headers }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`e-mail recusado pela conta de envio (${r.status}): ${texto.slice(0, 150)}`);
  let id: string | null = null;
  try {
    const j = JSON.parse(texto);
    id = j?.id ?? j?.api_message_id ?? null;
  } catch { /* sem corpo */ }
  if (!id) id = (r.headers.get("Location") ?? "").replace(/\/$/, "").split("/").pop() || null;
  return { id: id ? String(id).slice(0, 120) : null };
}
