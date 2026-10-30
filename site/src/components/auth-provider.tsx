import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Perfil, type Empresa, type Credor, credorStorageKey, friendlyError } from '@/lib/supabase';
import { isPermissionError } from '@/lib/permissoes';

type AuthState = {
  session: Session | null;
  perfil: Perfil | null;
  empresa: Empresa | null;
  empresas: Empresa[];
  credor: Credor | null;
  credores: Credor[];
  permissoes: string[];
  selectEmpresa: (id: string) => Promise<void>;
  selectCredor: (id: string | null) => void;
  selectCredorRecord: (credor: Credor | null) => void;
  refreshCredores: () => Promise<Credor[]>;
  loading: boolean;
  error: boolean;
  desativado: boolean;
  refresh: () => Promise<void>;
};
const Context = createContext<AuthState>({
  session: null, perfil: null, empresa: null, empresas: [], credor: null, credores: [], permissoes: [],
  selectEmpresa: async () => {}, selectCredor: () => {}, selectCredorRecord: () => {}, refreshCredores: async () => [], loading: true, error: false, desativado: false, refresh: async () => {},
});
export const useMotorAuth = () => useContext(Context);

const IDLE_MS = 30 * 60 * 1000;       // 30 minutos
const WARN_MS = 29 * 60 * 1000;       // aviso 1 minuto antes
const EMPRESA_KEY = 'mc-empresa';     // empresa ativa da equipe (localStorage)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [credor, setCredor] = useState<Credor | null>(null);
  const [credores, setCredores] = useState<Credor[]>([]);
  const [permissoes, setPermissoes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [desativado, setDesativado] = useState(false);
  const [showExpiry, setShowExpiry] = useState(false);
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  async function loadPermissoes(uid: string): Promise<string[]> {
    if (!supabase) { setPermissoes([]); return []; }
    const { data, error: rpcError } = await supabase.rpc('permissoes_do_usuario', { uid });
    if (rpcError) {
      // Erro de permissão do banco → acesso desativado.
      if (isPermissionError(rpcError)) { setDesativado(true); setPermissoes([]); return []; }
      setPermissoes([]); return [];
    }
    const list = ((data ?? []) as { codigo: string; permitido: boolean }[]).filter(r => r.permitido).map(r => r.codigo);
    setPermissoes(list);
    if (list.length === 0) setDesativado(true);
    else setDesativado(false);
    return list;
  }

  async function loadCredores(emp: Empresa | null): Promise<Credor[]> {
    if (!supabase || !emp) { setCredores([]); setCredor(null); return []; }
    const { data } = await supabase.from('credores').select('id,empresa_id,codigo,nome,ativo,estrategia_id,demais_ativo,entrada_carga,criado_em').eq('empresa_id', emp.id).order('nome');
    const list = (data ?? []) as Credor[];
    setCredores(list);
    const urlCode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('credor') : null;
    const storedCode = typeof window !== 'undefined' ? localStorage.getItem(credorStorageKey(emp.id)) : null;
    const code = urlCode ?? storedCode;
    let found = code ? list.find(c => c.codigo === code) ?? null : null;
    if (!found && list.length === 1) found = list[0];
    setCredor(found);
    return list;
  }

  async function refreshCredores(): Promise<Credor[]> {
    return loadCredores(empresa);
  }

  async function load(next: Session | null) {
    setSession(next); setPerfil(null); setEmpresa(null); setEmpresas([]); setCredor(null); setCredores([]); setPermissoes([]); setError(false); setDesativado(false);
    // mc-empresa permanece no logout: a equipe volta à última empresa escolhida.
    if (next && supabase) {
      const { data: p, error: profileError } = await supabase
        .from('perfis').select('id,nome,email,papel,ativo,empresa_id,equipe')
        .eq('id', next.user.id).maybeSingle();
      if (profileError) { setError(true); setLoading(false); return; }
      const prf = p as Perfil | null;
      setPerfil(prf);
      // Carrega permissões efetivas do usuário.
      await loadPermissoes(next.user.id);
      if (prf?.equipe) {
        const { data: emps } = await supabase
          .from('empresas').select('id,slug,nome,ativa').eq('ativa', true).order('nome');
        const list = (emps ?? []) as Empresa[];
        setEmpresas(list);
        const stored = typeof window !== 'undefined' ? localStorage.getItem(EMPRESA_KEY) : null;
        let found = stored ? list.find(e => String(e.id) === stored) ?? null : null;
        if (!found && list.length === 1) found = list[0];
        if (found) { setEmpresa(found); await loadCredores(found); }
      } else if (prf?.empresa_id) {
        const { data: emp } = await supabase
          .from('empresas').select('id,slug,nome,ativa').eq('id', prf.empresa_id).maybeSingle();
        if (emp) { setEmpresa(emp as Empresa); await loadCredores(emp as Empresa); }
      }
    }
    setLoading(false);
  }

  async function selectEmpresa(id: string) {
    if (typeof window !== 'undefined') localStorage.setItem(EMPRESA_KEY, id);
    const found = empresas.find(e => e.id === id);
    if (found) { setEmpresa(found); setCredor(null); setCredores([]); await loadCredores(found); }
    else if (supabase) {
      const { data } = await supabase.from('empresas').select('id,slug,nome,ativa').eq('id', id).maybeSingle();
      if (data) { setEmpresa(data as Empresa); setCredor(null); setCredores([]); await loadCredores(data as Empresa); }
    }
    // Recarrega permissões ao trocar de empresa (caso venham a ser escopadas por empresa).
    if (session) await loadPermissoes(session.user.id);
  }

  function applyCredor(found: Credor | null) {
    setCredor(found);
    if (empresa) {
      const key = credorStorageKey(empresa.id);
      if (found) localStorage.setItem(key, found.codigo); else localStorage.removeItem(key);
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (found) next.set('credor', found.codigo); else next.delete('credor');
      return next;
    }, { replace: true });
  }
  function selectCredor(id: string | null) {
    const found = id ? credores.find(c => String(c.id) === String(id)) ?? null : null;
    applyCredor(found);
  }
  function selectCredorRecord(credor: Credor | null) {
    applyCredor(credor);
  }

  // --- Sessão: expira após 30 min sem uso, com aviso 1 min antes ---
  const warnTimer = useRef<number | null>(null);
  const expireTimer = useRef<number | null>(null);

  function clearTimers() {
    if (warnTimer.current) { window.clearTimeout(warnTimer.current); warnTimer.current = null; }
    if (expireTimer.current) { window.clearTimeout(expireTimer.current); expireTimer.current = null; }
  }
  function armTimers() {
    clearTimers();
    warnTimer.current = window.setTimeout(() => setShowExpiry(true), WARN_MS);
    expireTimer.current = window.setTimeout(() => { void expirar(); }, IDLE_MS);
  }
  async function expirar() {
    clearTimers(); setShowExpiry(false);
    if (supabase) await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }
  function continuarConectado() {
    setShowExpiry(false); armTimers();
  }

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    const client = supabase;
    let active = true;
    client.auth.getSession().then(({ data }) => { if (active) void load(data.session); }).catch(() => { if (active) { setError(true); setLoading(false); } });
    const { data: listener } = client.auth.onAuthStateChange((event, next) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      setTimeout(() => { if (active) void load(next); }, 0);
    });
    return () => { active = false; listener.subscription.unsubscribe(); clearTimers(); };
  }, []);

  // Inicia/renova os timers de ociosidade quando há sessão ativa.
  useEffect(() => {
    if (!session || desativado) { clearTimers(); return; }
    armTimers();
    const reset = () => { if (!showExpiry) armTimers(); };
    const evts = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    evts.forEach(e => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimers(); evts.forEach(e => window.removeEventListener(e, reset)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, desativado]);

  return (
    <Context.Provider value={{ session, perfil, empresa, empresas, credor, credores, permissoes, selectEmpresa, selectCredor, selectCredorRecord, refreshCredores, loading, error, desativado, refresh: async () => { setLoading(true); const s = (await supabase?.auth.getSession())?.data.session ?? null; await load(s); } }}>
      {children}
      {showExpiry && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-5" role="dialog" aria-modal="true" aria-label="Sessão expirando">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <h2 className="text-lg font-semibold text-[#1D1D1F]">Sua sessão vai expirar</h2>
            <p className="mt-2 text-sm text-[#6E6E73]">Você será desconectado em 1 minuto por inatividade.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => void expirar()} className="h-10 flex-1 rounded-lg border border-[#D2D2D7] text-sm font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Sair agora</button>
              <button onClick={continuarConectado} className="h-10 flex-1 rounded-lg bg-[#1D1D1F] text-sm font-semibold text-white hover:bg-[#3a3a3c]">Continuar conectado</button>
            </div>
          </div>
        </div>
      )}
    </Context.Provider>
  );
}
