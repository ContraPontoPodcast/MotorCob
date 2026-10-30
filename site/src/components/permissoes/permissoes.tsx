import { useEffect, useMemo, useState } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { supabase } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { isPermissionError } from '@/lib/permissoes';
import { UsuariosPermissoesNav } from '@/components/usuarios/usuarios-permissoes-nav';

const PAPEIS = [
  { id: 'admin', nome: 'Admin' },
  { id: 'planejamento', nome: 'Planejamento' },
  { id: 'operacao', nome: 'Operação' },
  { id: 'gestao', nome: 'Gestão' },
] as const;

type Catalogo = {
  codigo: string; nome: string; grupo: string; descricao: string | null; ordem: number;
  admin: boolean; planejamento: boolean; operacao: boolean; gestao: boolean;
};
type Ajuste = { papel: string; permissao: string; permitido: boolean };

const LOCKED = new Set(['admin|gerenciar_usuarios', 'admin|gerenciar_permissoes']);

const MSG_SEM_PERMISSAO = 'Seu perfil não tem permissão para alterar permissões.';
const MSG_ERRO_GENERICO = 'Não foi possível salvar. Tente de novo.';

/** Mensagem amigável para erro de gravação/carga, sem código técnico. */
function salvarErrorMsg(err: unknown): string {
  return isPermissionError(err) ? MSG_SEM_PERMISSAO : MSG_ERRO_GENERICO;
}

export function Permissoes() {
  const { empresa } = useMotorAuth();
  const [catalogo, setCatalogo] = useState<Catalogo[]>([]);
  const [ajustes, setAjustes] = useState<Record<string, boolean>>({}); // chave papel|permissao
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  async function reload() {
    if (!supabase || !empresa) { setLoading(false); return; }
    setLoading(true); setError('');
    const [cat, aj] = await Promise.all([
      supabase.from('permissoes_catalogo').select('codigo,grupo,nome,descricao,admin,planejamento,operacao,gestao,ordem').order('ordem'),
      supabase.from('permissoes_papel').select('papel,permissao,permitido').eq('empresa_id', empresa.id),
    ]);
    if (cat.error || aj.error) { setError(salvarErrorMsg(cat.error || aj.error)); setLoading(false); return; }
    setCatalogo((cat.data ?? []) as Catalogo[]);
    const ajMap: Record<string, boolean> = {};
    for (const a of (aj.data ?? []) as Ajuste[]) ajMap[`${a.papel}|${a.permissao}`] = a.permitido;
    setAjustes(ajMap);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  const grupos = useMemo(() => {
    const map: Record<string, Catalogo[]> = {};
    for (const c of catalogo) (map[c.grupo] ??= []).push(c);
    return Object.entries(map);
  }, [catalogo]);

  /** Padrão MotorCob para (papel, codigo): a coluna do perfil no catálogo. */
  function padrao(papel: string, codigo: string): boolean {
    const linha = catalogo.find(c => c.codigo === codigo);
    if (!linha) return false;
    return Boolean((linha as Record<string, unknown>)[papel]);
  }
  function valor(papel: string, codigo: string): boolean {
    const k = `${papel}|${codigo}`;
    if (k in ajustes) return ajustes[k];
    return padrao(papel, codigo);
  }
  function isAjuste(papel: string, codigo: string): boolean {
    return `${papel}|${codigo}` in ajustes;
  }
  function isLocked(papel: string, codigo: string): boolean {
    return LOCKED.has(`${papel}|${codigo}`);
  }

  async function toggle(papel: string, codigo: string) {
    if (isLocked(papel, codigo) || !supabase || !empresa) return;
    const k = `${papel}|${codigo}`;
    const novo = !valor(papel, codigo);
    const padraoValor = padrao(papel, codigo);
    setBusy(k); setError(''); setSuccess('');
    // Otimista
    setAjustes(prev => { const next = { ...prev }; if (novo === padraoValor) delete next[k]; else next[k] = novo; return next; });
    try {
      if (novo === padraoValor) {
        const { error: delErr } = await supabase.from('permissoes_papel').delete().eq('empresa_id', empresa.id).eq('papel', papel).eq('permissao', codigo);
        if (delErr) throw delErr;
      } else {
        const { error: upErr } = await supabase.from('permissoes_papel').upsert(
          { empresa_id: empresa.id, papel, permissao: codigo, permitido: novo },
          { onConflict: 'empresa_id,papel,permissao' },
        );
        if (upErr) throw upErr;
      }
    } catch (e) {
      setError(salvarErrorMsg(e));
      await reload();
    } finally {
      setBusy('');
    }
  }

  async function voltarPadrao() {
    setConfirmReset(false);
    if (!supabase || !empresa) return;
    setBusy('reset'); setError(''); setSuccess('');
    const { error: delErr } = await supabase.from('permissoes_papel').delete().eq('empresa_id', empresa.id);
    if (delErr) { setError(salvarErrorMsg(delErr)); setBusy(''); return; }
    setAjustes({});
    setSuccess('Permissões restauradas ao padrão MotorCX.');
    setBusy('');
  }

  // Sem empresa ativa (equipe MotorCob sem empresa escolhida).
  if (!empresa) {
    return <>
      <PageHeading title="Permissões" description="Ajuste o acesso de cada perfil da sua empresa." />
      <div className="rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-6 text-sm text-[#6E6E73]">
        Escolha uma empresa no topo para ver as permissões.
      </div>
    </>;
  }

  return <>
    <UsuariosPermissoesNav />
    <PageHeading title="Permissões" description="Ajuste o acesso de cada perfil da sua empresa." actions={
      <button onClick={() => setConfirmReset(true)} disabled={busy === 'reset'} className="flex h-10 items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-sm font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50"><RotateCcw size={16}/> Voltar ao padrão MotorCX</button>
    }/>
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-5 text-sm text-[#6E6E73]"><Lock size={19} className="shrink-0"/><p>Cada célula mostra o acesso efetivo do perfil. Um pontinho laranja indica ajuste diferente do padrão MotorCX. Admin sempre mantém gerenciamento de usuários e permissões.</p></div>
    {error && <div className="mb-5"><Notice>{error}</Notice></div>}
    {success && <div className="mb-5"><Notice variant="success">{success}</Notice></div>}
    {loading ? <Loading/> : catalogo.length === 0 ? <Empty>Nenhuma permissão cadastrada.</Empty> : (
      <div className="space-y-6">
        {grupos.map(([grupo, lista]) => (
          <section key={grupo} className="overflow-hidden rounded-xl border border-[#E5E5EA] bg-white">
            <div className="border-b border-[#E5E5EA] bg-[#F5F5F7] px-5 py-3 text-sm font-semibold text-[#1D1D1F]">{grupo}</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead><tr className="border-b border-[#E5E5EA] text-xs text-[#8E8E93]">
                  <th className="px-5 py-3 font-medium">Permissão</th>
                  {PAPEIS.map(p => <th key={p.id} className="px-3 py-3 text-center font-medium">{p.nome}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-[#F0F0F2]">
                  {lista.map(c => (
                    <tr key={c.codigo}>
                      <td className="px-5 py-3"><div className="font-medium text-[#1D1D1F]">{c.nome}</div>{c.descricao && <div className="text-xs text-[#8E8E93]">{c.descricao}</div>}</td>
                      {PAPEIS.map(p => {
                        const k = `${p.id}|${c.codigo}`;
                        const on = valor(p.id, c.codigo);
                        const locked = isLocked(p.id, c.codigo);
                        const ajustado = isAjuste(p.id, c.codigo);
                        const padraoValor = padrao(p.id, c.codigo);
                        return (
                          <td key={p.id} className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {ajustado && <span title={`Padrão MotorCX: ${padraoValor ? 'liberado' : 'bloqueado'}`} className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#FF9500' }} />}
                              <button role="switch" aria-checked={on} disabled={locked || busy === k} onClick={() => void toggle(p.id, c.codigo)}
                                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}>
                                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`}/>
                                {locked && <Lock size={9} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/80" />}
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    )}
    {confirmReset && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-5" role="dialog" aria-modal="true">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
          <h2 className="text-lg font-semibold text-[#1D1D1F]">Voltar ao padrão MotorCX?</h2>
          <p className="mt-2 text-sm text-[#6E6E73]">Apagar os ajustes de permissões da {empresa.nome}? Os perfis voltam ao padrão MotorCX.</p>
          <div className="mt-5 flex gap-3">
            <button onClick={() => setConfirmReset(false)} className="h-10 flex-1 rounded-lg border border-[#D2D2D7] text-sm font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
            <button onClick={() => void voltarPadrao()} className="h-10 flex-1 rounded-lg bg-[#1D1D1F] text-sm font-semibold text-white hover:bg-[#3a3a3c]">Voltar ao padrão</button>
          </div>
        </div>
      </div>
    )}
  </>;
}
