import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { dataLocal } from '@/lib/empresa-helpers';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// No server credentials are used. The browser session is intentionally not persisted
// by Supabase; only explicitly remembered sessions are copied to localStorage.
const sessionKey = 'motorcob.auth';
const rememberKey = 'motorcob.remember';
const empresaKey = 'motorcob.empresa';
const storage = {
  getItem(k: string) {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(k) ?? localStorage.getItem(k);
  },
  setItem(k: string, value: string) {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(rememberKey) === '1') {
      localStorage.setItem(k, value);
      sessionStorage.removeItem(k);
    } else {
      sessionStorage.setItem(k, value);
      localStorage.removeItem(k);
    }
  },
  removeItem(k: string) {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  },
};
export const supabase: SupabaseClient | null = url && key ? trackClient(createClient(url, key, {
  auth: { storage, storageKey: sessionKey, autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
})) : null;

export function setRemember(remember: boolean) {
  if (remember) localStorage.setItem(rememberKey, '1');
  else localStorage.removeItem(rememberKey);
  const current = sessionStorage.getItem(sessionKey) ?? localStorage.getItem(sessionKey);
  if (current) storage.setItem(sessionKey, current);
}

export const empresaStorageKey = empresaKey;

// --- Captura discreta de erros do Supabase para o "Detalhe técnico" ---
// Guarda o erro original (code, message, details, hint e a tabela/view consultada)
// sem expor chave, token, e-mail ou dado de cliente — apenas código, mensagem do
// banco e nome da tabela/view. Lido pelo componente <ErrorDetail/> e por toastError().
export type ErrorDetail = {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
  table: string | null;
  timestamp: string;
  page: string;
};

let lastDetail: ErrorDetail | null = null;

/** Remove e-mails, tokens JWT e chaves de serviço de um texto de erro. */
function sanitizeText(text: unknown): string | null {
  if (text == null) return null;
  let t = String(text);
  if (!t.trim()) return null;
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  t = t.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]');
  t = t.replace(/\b(sk_[A-Za-z0-9]{6,}|service_role[A-Za-z0-9]*)\b/gi, '[key]');
  return t;
}

/** Guarda o erro original sanitizado. Chamado automaticamente pelo client wrapper
 *  a cada consulta que retorna erro, e manualmente por friendlyError(err)/toastError(err). */
export function captureError(err: unknown, table?: string | null): void {
  const e = (err ?? null) as Record<string, unknown> | null;
  const code = e?.code;
  lastDetail = {
    code: typeof code === 'number' ? String(code) : typeof code === 'string' ? code : null,
    message: sanitizeText(e?.message),
    details: sanitizeText(e?.details),
    hint: sanitizeText(e?.hint),
    table: table ? String(table) : null,
    timestamp: new Date().toISOString(),
    page: typeof window !== 'undefined' ? window.location.pathname : '',
  };
}

export function getErrorDetail(): ErrorDetail | null {
  return lastDetail;
}

export function clearErrorDetail(): void {
  lastDetail = null;
}

/** Envolve um builder do PostgREST para capturar o erro (e a tabela) de toda consulta. */
function trackBuilder(builder: any, table: string | null): any {
  return new Proxy(builder, {
    get(target: any, prop: string | symbol, receiver: any) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'then') {
        return (onFulfilled?: any, onRejected?: any) =>
          value.call(
            target,
            (res: any) => {
              if (res && res.error) captureError(res.error, table);
              else lastDetail = null;
              return onFulfilled ? onFulfilled(res) : res;
            },
            onRejected,
          );
      }
      return (...args: any[]) => {
        const result = value.apply(target, args);
        if (result && typeof result.then === 'function') return trackBuilder(result, table);
        return result;
      };
    },
  });
}

/** Envolve o client Supabase para capturar erros de .from() e .rpc() automaticamente. */
function trackClient(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target: any, prop: string | symbol) {
      if (prop === 'from') {
        return (table: string) => trackBuilder(target.from(table), table);
      }
      if (prop === 'rpc') {
        return (fn: string, ...args: any[]) => trackBuilder(target.rpc(fn, ...args), fn);
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as SupabaseClient;
}

export type Perfil = { id: string; nome: string; email: string; papel: 'admin' | 'planejamento' | 'operacao' | 'gestao'; ativo: boolean; empresa_id: string | null; equipe: boolean; ultimo_acesso?: string | null };
export type Empresa = { id: string; slug: string; nome: string; ativa: boolean };
export type Credor = { id: string; empresa_id: string; codigo: string; nome: string; ativo: boolean; estrategia_id: string | null; demais_ativo: boolean; entrada_carga: 'arquivo' | 'api'; regras_retorno: Record<string, unknown> | null; criado_em?: string; compartilhada_com?: string | null; estrategia_propria?: boolean; frente?: string; discagem?: Record<string, unknown> | null };
export const credorStorageKey = (empresaId: string) => `motorcob.credor.${empresaId}`;
export type Cluster = {
  id: string; empresa_id: string; ordem: number; codigo: string; nome: string;
  condicoes: Condicao[]; pacote: string | null; revalida_dias: number | null;
  so_digital: boolean; voz_d0: boolean; canais_bloqueados: string[]; ativo: boolean;
  estrategia_id: string | null;
  credor_id?: string | null;
  atualizado_em?: string; atualizado_por?: string | null;
};
export type Condicao = { campo: string; op: string; valor: string | string[] | null };

/** Vínculo de um segmento (cluster) a um credor — substitui o credor_id fixo do cluster. */
export type SegmentoCarteira = { empresa_id: string; cluster_id: string; credor_id: string; ativo: boolean };
/** Linha da view segmentos_em_uso: para cada (credor, cluster) diz se está vinculado e em uso. */
export type SegmentoEmUso = { credor_id: string; cluster_id: string; codigo: string; nome: string; ordem: number; estrategia_id: string | null; em_uso: boolean; vinculado: boolean; compartilhada_com?: string | null; estrategia_propria?: boolean };
/** Persona criada pelo usuário, por carteira (credor). */
export type CondicaoPersonaUsuario = { campo: string; op: string; valor: string | string[] | null };
export type PersonaUsuario = { id: string; credor_id: string; nome: string; descricao: string | null; ordem: number; condicoes: CondicaoPersonaUsuario[]; cor: string; ativo: boolean };
export type Frase = { id: string; empresa_id: string; canal: string; nome: string; estagio: string | null; texto: string; origem: 'importado' | 'criado'; ativo: boolean; criado_em?: string; atualizado_em?: string };

export type ApiToken = {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  credor_ids: string[] | null;
  criado_em: string;
  expira_em: string;
  ultimo_uso: string | null;
  revogado_em: string | null;
};

export type Row = Record<string, any>;
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const dateBR = (v: unknown) => {
  if (!v) return '—';
  const str = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dataLocal(str));
  }
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(str));
};
export const dateTimeBR = (v: unknown) => v ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(v))) : '—';
export const numberBR = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR');
export const moneyBR = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pctBR = (v: unknown) => `${(Number(v ?? 0) * (Number(v ?? 0) <= 1 ? 100 : 1)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const GENERIC_ERROR = 'Não foi possível concluir a operação. Tente novamente ou fale com o administrador.';
const TIMEOUT_ERROR = 'A consulta demorou demais. Tente de novo em alguns segundos; se repetir, copie o detalhe técnico e envie ao suporte.';
/** Devolve a mensagem amigável (genérica ou de tempo esgotado para o código 57014).
 *  Quando recebe `err`, guarda também o erro original sanitizado para o Detalhe técnico. */
export function friendlyError(err?: unknown): string {
  if (err != null) captureError(err);
  return lastDetail?.code === '57014' ? TIMEOUT_ERROR : GENERIC_ERROR;
}
export const timeoutErrorMessage = TIMEOUT_ERROR;
export const channels = [
  { id: 'whatsapp', name: 'WhatsApp', code: 'WA' }, { id: 'rcs', name: 'RCS', code: 'RC' },
  { id: 'agente_voz', name: 'Agente virtual', code: 'AV' }, { id: 'discador', name: 'Discador', code: 'DC' },
  { id: 'sms', name: 'SMS', code: 'SM' }, { id: 'email', name: 'E-mail', code: 'EM' },
];
export const states: Record<string, string> = { LOC: 'Localização', CPA: 'CPC A', CPB: 'CPC B', NCP: 'Não CPC', PRE: 'Preventivo', COL: 'Colchão', QBR: 'Quebra', LIQ: 'Liquidado', BLQ: 'Bloqueado' };

/** Converte um nome em slug: minúsculas, sem acento, espaços → hífen, só a-z 0-9 e hífen. */
export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Limpa um nome de arquivo para Storage: sem acentos, espaços e caracteres especiais viram '_'. */
export function safeFileName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function logAccess(acao: string, alvo: string, empresaId?: string | null) {
  if (!supabase) return;
  const payload: Record<string, unknown> = { acao, alvo };
  if (empresaId) payload.empresa_id = empresaId;
  const { error } = await supabase.from('acessos').insert(payload);
  if (error) throw error;
}

export async function signedDownload(path: string, filename?: string, bucket = 'saidas', empresaId?: string | null) {
  if (!supabase) throw new Error('Configuração ausente');
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw error ?? new Error('Arquivo não encontrado');
  const response = await fetch(data.signedUrl);
  if (!response.ok) throw new Error('Arquivo não encontrado');
  const blob = await response.blob();
  await logAccess('download', path, empresaId);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename ?? path.split('/').pop() ?? 'arquivo';
  document.body.appendChild(link);
  link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}
