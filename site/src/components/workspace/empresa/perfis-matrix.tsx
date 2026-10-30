import { useEffect, useMemo, useState } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase } from '@/lib/supabase';
import { isPermissionError } from '@/lib/permissoes';
import { PERFIS_INFO } from '@/lib/perfis-info';
import { cardShadow } from './empresa-shell';

const PAPEIS = PERFIS_INFO.map(p => ({ id: p.id, nome: p.nome }));
const LOCKED = new Set(['admin|gerenciar_usuarios', 'admin|gerenciar_permissoes']);

const MSG_SEM_PERMISSAO = 'Seu perfil não tem permissão para alterar permissões.';
const MSG_ERRO_GENERICO = 'Não foi possível salvar. Tente de novo.';

function salvarErrorMsg(err: unknown): string {
  return isPermissionError(err) ? MSG_SEM_PERMISSAO : MSG_ERRO_GENERICO;
}

type Catalogo = {
  codigo: string; nome: string; grupo: string; descricao: string | null; ordem: number;
  admin: boolean; planejamento: boolean; operacao: boolean; gestao: boolean;
};

export function PerfisMatrix() {
  const { empresa, permissoes } = useMotorAuth();
  const podeGerenciarPerms = permissoes.includes('gerenciar_permissoes');
  const [catalogo, setCatalogo] = useState<Catalogo[]>([]);
  const [ajustes, setAjustes] = useState<Record<string, boolean>>({});
  const [pessoasPorPerfil, setPessoasPorPerfil] = useState<Record<string, number>>({ admin: 0, planejamento: 0, operacao: 0, gestao: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  async function reload() {
    if (!supabase || !empresa) { setLoading(false); return; }
    setLoading(true); setError('');
    const [cat, aj, ppl] = await Promise.all([
      supabase.from('permissoes_catalogo').select('codigo,grupo,nome,descricao,admin,planejamento,operacao,gestao,ordem').order('ordem'),
      supabase.from('permissoes_papel').select('papel,permissao,permitido').eq('empresa_id', empresa.id),
      supabase.from('perfis').select('papel').eq('empresa_id', empresa.id),
    ]);
    if (cat.error || aj.error) { setError(salvarErrorMsg(cat.error || aj.error)); setLoading(false); return; }
    setCatalogo((cat.data ?? []) as Catalogo[]);
    const ajMap: Record<string, boolean> = {};
    for (const a of (aj.data ?? []) as { papel: string; permissao: string; permitido: boolean }[]) ajMap[`${a.papel}|${a.permissao}`] = a.permitido;
    setAjustes(ajMap);
    const pplMap: Record<string, number> = { admin: 0, planejamento: 0, operacao: 0, gestao: 0 };
    for (const p of (ppl.data ?? []) as { papel: string }[]) { if (pplMap[p.papel] !== undefined) pplMap[p.papel]++; }
    setPessoasPorPerfil(pplMap);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  const grupos = useMemo(() => {
    const map: Record<string, Catalogo[]> = {};
    for (const c of catalogo) (map[c.grupo] ??= []).push(c);
    return Object.entries(map);
  }, [catalogo]);

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

  if (!empresa) {
    return (
      <div className="rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-6 text-sm text-[#6E6E73]">
        Escolha uma empresa no topo para ver os perfis.
      </div>
    );
  }

  return (
    <>
      {/* Cartões de perfil */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {PERFIS_INFO.map(p => {
          const ajustesPerfil = Object.keys(ajustes).filter(k => k.startsWith(`${p.id}|`)).length;
          return (
            <div key={p.id} className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold text-[#1D1D1F]">{p.nome}</p>
                  <p className="mt-0.5 text-[13px] text-[#6E6E73]">{p.desc}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-[#8E8E93]">
                <span className="tnum">{pessoasPorPerfil[p.id] ?? 0} {pessoasPorPerfil[p.id] === 1 ? 'pessoa' : 'pessoas'}</span>
                {ajustesPerfil > 0 && <span className="rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[11px] font-semibold text-[#9a631b]">{ajustesPerfil} ajuste{ajustesPerfil > 1 ? 's' : ''}</span>}
                {p.id === 'admin' && <span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">duas etapas obrigatória</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Matriz de permissões */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">O que cada perfil pode</h2>
        {podeGerenciarPerms && (
          <button onClick={() => setConfirmReset(true)} disabled={busy === 'reset'} className="flex h-9 items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">
            <RotateCcw size={15} /> Voltar ao padrão MotorCX
          </button>
        )}
      </div>

      {!podeGerenciarPerms && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-4 text-[13px] text-[#6E6E73]">
          <Lock size={16} className="shrink-0" />
          <p>Quem ajusta permissões é o Admin da sua empresa.</p>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      {success && <div className="mb-4 rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{success}</div>}

      {loading ? (
        <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
      ) : catalogo.length === 0 ? (
        <p className="py-10 text-center text-[14px] text-[#8E8E93]">Nenhuma permissão cadastrada.</p>
      ) : (
        <div className="space-y-6">
          {grupos.map(([grupo, lista]) => (
            <section key={grupo} className="overflow-hidden rounded-xl border border-[#E5E5EA] bg-white" style={{ boxShadow: cardShadow }}>
              <div className="border-b border-[#E5E5EA] bg-[#F5F5F7] px-5 py-3 text-sm font-semibold text-[#1D1D1F]">{grupo}</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E5E5EA] text-xs text-[#8E8E93]">
                      <th className="px-5 py-3 font-medium">Permissão</th>
                      {PAPEIS.map(p => <th key={p.id} className="px-3 py-3 text-center font-medium">{p.nome}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0F2]">
                    {lista.map(c => (
                      <tr key={c.codigo}>
                        <td className="px-5 py-3">
                          <div className="font-medium text-[#1D1D1F]">{c.nome}</div>
                          {c.descricao && <div className="text-xs text-[#8E8E93]">{c.descricao}</div>}
                        </td>
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
                                <button
                                  role="switch"
                                  aria-checked={on}
                                  disabled={locked || !podeGerenciarPerms || busy === k}
                                  onClick={() => void toggle(p.id, c.codigo)}
                                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}
                                >
                                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
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
              <button onClick={() => void voltarPadrao()} className="h-10 flex-1 rounded-lg bg-[#1D1D1F] text-sm font-semibold text-white hover:opacity-85">Voltar ao padrão</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
