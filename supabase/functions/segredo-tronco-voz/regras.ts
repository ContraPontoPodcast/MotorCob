// Regras da Edge Function segredo-tronco-voz (sem rede; testáveis com node --test): validação do pedido e da senha,
// nível da sessão (aal2), nome do segredo da empresa, credencial da conta que só ESCREVE no cofre e as chamadas da API
// do Secret Manager (criar o segredo, versão nova, destruir as versões antigas).
// A senha nunca é devolvida, nunca entra em log e nunca sai desta função a não ser no corpo da chamada ao Secret Manager.

export interface Pedido { tronco: number; senha: string }

/** Tamanho aceito (seção E do parecer, campo 7: 8 a 128 caracteres, sem quebra de linha). */
export const SENHA_MIN = 8;
export const SENHA_MAX = 128;
/** Região das réplicas do segredo (a mesma das VMs de voz e do motorcx-voz-ari-senha). */
export const REGIAO = "southamerica-east1";

/** Motivo da recusa da senha (frase para a pessoa), ou null. A mesma regra está em site/src/lib/voz.ts › senhaTroncoMotivo. */
export function motivoSenha(s: unknown): string | null {
  if (typeof s !== "string") return "senha inválida";
  if (s.length < SENHA_MIN || s.length > SENHA_MAX) return `a senha precisa ter de ${SENHA_MIN} a ${SENHA_MAX} caracteres`;
  // a VM tira espaços das pontas e o arquivo do Asterisk é uma linha por item
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return "a senha não pode ter quebra de linha nem caractere de controle";
  if (s.trim() !== s) return "a senha não pode começar nem terminar com espaço";
  return null;
}

export function validarPedido(corpo: unknown): { pedido?: Pedido; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  if (Object.keys(c).some((k) => k !== "tronco" && k !== "senha")) return { erro: "pedido inválido" };
  if (!Number.isSafeInteger(c.tronco) || (c.tronco as number) <= 0) return { erro: "tronco inválido" };
  const m = motivoSenha(c.senha);
  if (m) return { erro: m };
  return { pedido: { tronco: c.tronco as number, senha: c.senha as string } };
}

// ---------------------------------------------------------------- número de teste (SQL 114, PR T5 da Telefonia)
// O número de teste (celular da equipe do cliente) também fica só no cofre: o banco guarda o hash (sha-256 dos dígitos
// sem o 55, igual a voz_config.numeros_teste_hash) e a máscara; o servidor de voz lê o número na hora do teste da rota.
export interface PedidoNumero { empresa: number; numero: string }

/** Dígitos do número (sem o 55 do país), ou null. Celular ou fixo com DDD. */
export function digitosNumeroTeste(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 30) return null;
  let d = v.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
  return /^[1-9][1-9]\d{8,9}$/.test(d) ? d : null;
}

/** "(11) 9••••-••41": o DDD e os 2 últimos dígitos (a mesma regra de site/src/lib/telefonia.ts). */
export function mascaraNumeroTeste(d: string): string {
  return `(${d.slice(0, 2)}) ${d.length === 11 ? "9••••" : "••••"}-••${d.slice(-2)}`;
}

export async function hashNumeroTeste(d: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(d));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** { empresa, numero_teste } (guardar) ou { remover_numero_teste } (apagar do cofre). Nada mais. */
export function validarPedidoNumero(corpo: unknown): { numero?: PedidoNumero; remover?: number; erro?: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { erro: "pedido inválido" };
  const c = corpo as Record<string, unknown>;
  const chaves = Object.keys(c).sort().join(",");
  if (chaves === "remover_numero_teste") {
    return Number.isSafeInteger(c.remover_numero_teste) && (c.remover_numero_teste as number) > 0
      ? { remover: c.remover_numero_teste as number } : { erro: "número de teste inválido" };
  }
  if (chaves !== "empresa,numero_teste") return { erro: "pedido inválido" };
  if (!Number.isSafeInteger(c.empresa) || (c.empresa as number) <= 0) return { erro: "empresa inválida" };
  const d = digitosNumeroTeste(c.numero_teste);
  if (!d) return { erro: "digite o número com DDD (10 ou 11 dígitos)" };
  return { numero: { empresa: c.empresa as number, numero: d } };
}

/** É um pedido de número de teste (e não de senha do tronco)? */
export const ehPedidoNumero = (corpo: unknown) =>
  !!corpo && typeof corpo === "object" && ("numero_teste" in (corpo as object) || "remover_numero_teste" in (corpo as object));

/** O "aal" do JWT da sessão (aal1 sem o segundo fator, aal2 com). Só lê: quem confere a assinatura é o Supabase. */
export function nivelDaSessao(token: string): string {
  try {
    const parte = token.split(".")[1] ?? "";
    const json = atob(parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "="));
    const aal = (JSON.parse(json) as Record<string, unknown>).aal;
    return typeof aal === "string" ? aal : "";
  } catch {
    return "";
  }
}

/** Nome do segredo da empresa (o mesmo do banco: nome_segredo_tronco_voz). Recusa qualquer outro. */
export const RE_NOME = /^motorcx-voz-trunk-e([1-9][0-9]{0,18})-[a-z0-9][a-z0-9_-]{1,39}$/;
export function nomeDaEmpresa(nome: unknown, empresa: unknown): boolean {
  if (typeof nome !== "string") return false;
  const m = RE_NOME.exec(nome);
  return !!m && String(empresa) === m[1];
}

// ---------------------------------------------------------------- credencial (secret GCP_COFRE_TRONCO_CHAVE)
export interface Chave { client_email: string; private_key: string; project_id: string }

/** Lê o JSON da conta motorcx-voz-cofre-escrita (só cria segredo e escreve versão; não lê). Nunca devolve a chave em erro. */
export function lerChave(json: string | undefined, projeto?: string): Chave | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Record<string, unknown>;
    const email = typeof c.client_email === "string" ? c.client_email : "";
    const pk = typeof c.private_key === "string" ? c.private_key : "";
    const proj = projeto || (typeof c.project_id === "string" ? c.project_id : "");
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) return null;
    if (!pk.includes("BEGIN PRIVATE KEY")) return null;
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(proj)) return null;
    return { client_email: email, private_key: pk, project_id: proj };
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

export function base64url(b: Uint8Array | string): string {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64 comum do texto em UTF-8 (o payload.data do Secret Manager). */
export function base64(texto: string): string {
  let s = "";
  for (const x of new TextEncoder().encode(texto)) s += String.fromCharCode(x);
  return btoa(s);
}

export const ESCOPO = "https://www.googleapis.com/auth/cloud-platform";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** JWT da conta de serviço para trocar por um token de acesso (RS256; `assinar` faz a assinatura). */
export async function jwtDaConta(chave: Chave, agora: Date, assinar: (d: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>): Promise<string> {
  const iat = Math.floor(agora.getTime() / 1000);
  const cab = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(JSON.stringify({ iss: chave.client_email, scope: ESCOPO, aud: TOKEN_URL, iat, exp: iat + 600 }));
  const dados = new TextEncoder().encode(`${cab}.${corpo}`) as Uint8Array<ArrayBuffer>;
  return `${cab}.${corpo}.${base64url(new Uint8Array(await assinar(dados)))}`;
}

export async function assinadorDe(chave: Chave): Promise<(d: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("pkcs8", pemParaDer(chave.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return (d) => crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, d);
}

// ---------------------------------------------------------------- Secret Manager (API REST v1)
const SM = "https://secretmanager.googleapis.com/v1";

/** As chamadas, sem rede (o index.ts faz o fetch). */
export function pedidoCriar(projeto: string, nome: string, empresa: number, tipo = "tronco-voz") {
  return {
    url: `${SM}/projects/${projeto}/secrets?secretId=${encodeURIComponent(nome)}`,
    corpo: { replication: { userManaged: { replicas: [{ location: REGIAO }] } },
             labels: { "motorcx-empresa": String(empresa), "motorcx-tipo": tipo } },
  };
}
export function pedidoVersao(projeto: string, nome: string, senha: string) {
  return { url: `${SM}/projects/${projeto}/secrets/${nome}:addVersion`, corpo: { payload: { data: base64(senha) } } };
}
export function urlVersoes(projeto: string, nome: string) {
  return `${SM}/projects/${projeto}/secrets/${nome}/versions?filter=${encodeURIComponent("state:(ENABLED OR DISABLED)")}&pageSize=100`;
}
export const urlDestruir = (nomeVersao: string) => `${SM}/${nomeVersao}:destroy`;

/** Número da versão no nome devolvido pelo Secret Manager (projects/N/secrets/x/versions/7 → 7). */
export function numeroVersao(nome: unknown): number | null {
  const m = typeof nome === "string" ? /\/versions\/([1-9][0-9]*)$/.exec(nome) : null;
  return m ? Number(m[1]) : null;
}

/** Versões antigas para destruir: todas menos a recém-criada (a senha antiga não fica no cofre). */
export function versoesAntigas(lista: unknown, nova: number): string[] {
  const vs = (lista as { versions?: { name?: unknown }[] } | null)?.versions ?? [];
  return vs.map((v) => v?.name).filter((n): n is string => typeof n === "string" && (numeroVersao(n) ?? nova) < nova);
}
