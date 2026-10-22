// Quem chama é o servidor (o motor)? Vale a chave service_role antiga (JWT) e as chaves secretas novas (sb_secret_…).
// 1) Compara com as chaves que o Supabase entrega à função (SUPABASE_SERVICE_ROLE_KEY e SUPABASE_SECRET_KEYS).
// 2) Se não bater (chave nova criada depois, ou outra chave do mesmo projeto), pergunta ao próprio Supabase: só chave
//    de servidor lista usuários no Auth admin. Login de usuário (JWT de sessão) recebe 401/403 e não passa.

function envDaFuncao(k: string) {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
}

/** Comparação em tempo constante (não vaza, pelo tempo, quantos caracteres bateram). */
export function mesmoTexto(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** As chaves de servidor que o Supabase põe no ambiente da função. */
export function chavesDoServidor(env: (k: string) => string | undefined = envDaFuncao): string[] {
  const chaves: string[] = [];
  const antiga = env("SUPABASE_SERVICE_ROLE_KEY");
  if (antiga) chaves.push(antiga);
  try {
    const novas = JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
    for (const v of Object.values(novas)) if (typeof v === "string" && v) chaves.push(v);
  } catch { /* variável ausente ou fora do formato: fica só a antiga */ }
  return chaves;
}

export async function ehServidor(token: string, url: string, f: typeof fetch = fetch,
                                 env: (k: string) => string | undefined = envDaFuncao): Promise<boolean> {
  token = (token ?? "").trim();
  if (!token) return false;
  if (chavesDoServidor(env).some((k) => mesmoTexto(token, k))) return true;
  const jwt = token.split(".").length === 3;
  const cab: Record<string, string> = { apikey: token };
  if (jwt) cab.Authorization = `Bearer ${token}`;            // a chave nova (sb_secret_…) vai só no apikey
  try {
    const r = await f(`${url.replace(/\/$/, "")}/auth/v1/admin/users?page=1&per_page=1`, { headers: cab });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}
