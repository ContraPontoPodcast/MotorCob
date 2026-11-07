// Erro de Edge Function (supabase.functions.invoke) → a frase para a tela.
// No status != 2xx o supabase-js devolve FunctionsHttpError e o corpo da resposta ({ erro: "..." }) fica em
// `error.context` (um Response ainda não lido); `error.message` é só "Edge Function returned a non-2xx status code".
// Por isso NUNCA passe o erro do invoke direto para friendlyError(): use erroDaFuncao(error, data).
// As funções do MotorCX respondem { erro } em português; aceitamos também { error } e { message } (relay/gateway)
// e, quando vem, a lista { erros: [...] } (simulador do fluxo).
import { friendlyError } from '@/lib/supabase';

const SEM_CONEXAO = 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.';
const SEM_FUNCAO = 'Este serviço ainda não está publicado no servidor. Fale com o administrador.';
const MAX = 300;

export type LeituraErroFuncao = {
  /** status HTTP da resposta da função (null quando não houve resposta: rede, relay ou 2xx) */
  status: number | null;
  /** a frase da função, crua (sem maiúscula/ponto), ou null quando ela não mandou nenhuma */
  mensagem: string | null;
};

type Corpo = Record<string, unknown>;
type ComContexto = { name?: unknown; message?: unknown; context?: unknown };

function textoDe(v: unknown): string | null {
  if (typeof v === 'string') { const t = v.trim(); return t && t.length <= MAX ? t : null; }
  if (v && typeof v === 'object' && typeof (v as Corpo).message === 'string') return textoDe((v as Corpo).message);
  return null;
}

/** A frase de um corpo de resposta: erro > error > message (esta só fora do 2xx), mais a lista `erros`. */
function fraseDoCorpo(corpo: unknown, aceitaMessage: boolean): string | null {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null;
  const c = corpo as Corpo;
  const base = textoDe(c.erro) ?? textoDe(c.error) ?? (aceitaMessage ? textoDe(c.message) ?? textoDe(c.msg) : null);
  if (!base) return null;
  const lista = Array.isArray(c.erros) ? c.erros.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 10) : [];
  return lista.length ? `${base}: ${lista.join(', ')}` : base;
}

/** Lê o corpo do Response guardado no FunctionsHttpError, sem quebrar se já foi lido ou não é JSON. */
async function lerContexto(ctx: unknown): Promise<{ status: number | null; corpo: unknown }> {
  if (!ctx || typeof ctx !== 'object') return { status: null, corpo: null };
  const r = ctx as { status?: unknown; clone?: () => unknown; json?: () => Promise<unknown> };
  const status = typeof r.status === 'number' ? r.status : null;
  let corpo: unknown = null;
  try {
    // clone(): quem chamar depois (ou de novo) ainda consegue ler o corpo
    const fonte = (typeof r.clone === 'function' ? r.clone() : r) as { json?: () => Promise<unknown> };
    if (typeof fonte?.json === 'function') corpo = await fonte.json();
  } catch { /* corpo vazio, já lido ou não é JSON */ }
  return { status, corpo };
}

/** Status e frase da função, sem formatar (para quem decide pelo status ou pelo texto). */
export async function lerErroDaFuncao(fnError: unknown, data?: unknown): Promise<LeituraErroFuncao> {
  if (fnError) {
    const { status, corpo } = await lerContexto((fnError as ComContexto).context);
    return { status, mensagem: fraseDoCorpo(corpo, true) };
  }
  // 2xx com { erro } (algumas ações respondem 200 com a recusa no corpo)
  return { status: null, mensagem: fraseDoCorpo(data, false) };
}

/** Frase pronta para a tela: maiúscula no começo e ponto no fim. */
export function frase(m: string): string {
  const f = m.charAt(0).toUpperCase() + m.slice(1);
  return /[.!?…]$/.test(f) ? f : `${f}.`;
}

/**
 * A mensagem a mostrar para o resultado de um supabase.functions.invoke, ou null quando deu certo.
 *  - erro com corpo { erro | error | message } → a frase da função;
 *  - 2xx com { erro | error } no corpo → a frase da função;
 *  - sem frase: sem conexão (FunctionsFetchError) → aviso de conexão; senão `padrao` ou friendlyError (genérica,
 *    guardando o detalhe técnico).
 */
export async function erroDaFuncao(fnError: unknown, data?: unknown, padrao?: string): Promise<string | null> {
  const { status, mensagem } = await lerErroDaFuncao(fnError, data);
  // 404 do gateway do Supabase: a Edge Function não está publicada (não é recusa da função)
  if (status === 404 && mensagem && /requested function was not found/i.test(mensagem)) return SEM_FUNCAO;
  if (mensagem) return frase(mensagem);
  if (!fnError) return null;
  if ((fnError as ComContexto).name === 'FunctionsFetchError') return SEM_CONEXAO;
  return padrao ?? friendlyError(fnError);
}

/** Como erroDaFuncao, mas lança Error com a mensagem (para quem trata em try/catch). */
export async function exigirFuncao<T = unknown>(r: { data: T; error: unknown }, padrao?: string): Promise<T> {
  const msg = await erroDaFuncao(r.error, r.data, padrao);
  if (msg) throw new Error(msg);
  return r.data;
}
