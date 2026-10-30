import { useEffect, useState } from 'react';
import { UserPlus, X, KeyRound, ShieldCheck, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Perfil } from '@/lib/supabase';
import { PERFIS_INFO, type PerfilId } from '@/lib/perfis-info';
import { cardShadow } from './empresa-shell';

const roleName: Record<string, string> = { admin: 'Admin', planejamento: 'Planejamento', operacao: 'Operação', gestao: 'Gestão' };

/** Formata o último acesso: "hoje 08:02", "ontem", "12/10", "—". */
function acessoBR(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dStr = fmt.format(d);
  const nowStr = fmt.format(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = fmt.format(yesterday);
  if (dStr === nowStr) {
    const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
    return `hoje ${time}`;
  }
  if (dStr === yStr) return 'ontem';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
}

type Situacao = 'ativo' | 'convite' | 'inativo';
function situacaoDe(u: Perfil): Situacao {
  if (!u.ativo) return 'inativo';
  if (!u.ultimo_acesso) return 'convite';
  return 'ativo';
}

export function PessoasLista() {
  const { empresa, perfil, permissoes } = useMotorAuth();
  const podeGerenciar = permissoes.includes('gerenciar_usuarios');
  const [users, setUsers] = useState<Perfil[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [panelMode, setPanelMode] = useState<'invite' | 'manage' | null>(null);
  const [panelUser, setPanelUser] = useState<Perfil | null>(null);

  async function reload() {
    if (!supabase || !empresa) { setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error } = await supabase
      .from('perfis')
      .select('id,nome,email,papel,ativo,empresa_id,equipe,ultimo_acesso')
      .eq('empresa_id', empresa.id)
      .order('nome');
    if (error) setError(friendlyError(error));
    else setUsers((data ?? []) as Perfil[]);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  async function reenviar(u: Perfil) {
    if (!supabase || !u.email) return;
    const { error } = await supabase.auth.resend({ type: 'signup', email: u.email });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(`Convite reenviado para ${u.email}.`);
  }

  function openInvite() { setPanelUser(null); setPanelMode('invite'); }
  function openManage(u: Perfil) { setPanelUser(u); setPanelMode('manage'); }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Pessoas</h2>
        {podeGerenciar && (
          <button onClick={openInvite} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85">
            <UserPlus size={16} /> Convidar pessoa
          </button>
        )}
      </div>

      {!podeGerenciar && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#E5E5EA] bg-[#F5F5F7] p-4 text-[13px] text-[#6E6E73]">
          <ShieldCheck size={16} className="shrink-0" />
          <p>Quem convida e ajusta perfis é o Admin da sua empresa.</p>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      {success && <div className="mb-4 rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{success}</div>}

      {!empresa ? (
        <div className="rounded-2xl bg-[#F5F5F7] px-6 py-12 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: cardShadow }}>
          Escolha a empresa no topo para ver as pessoas.
        </div>
      ) : loading ? (
        <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
      ) : users.length === 0 ? (
        <div className="rounded-2xl bg-[#F5F5F7] px-6 py-12 text-center text-[14px] text-[#6E6E73]" style={{ boxShadow: cardShadow }}>
          Nenhuma pessoa cadastrada.
        </div>
      ) : (
        <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
          {/* Tabela (desktop) */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E5EA] text-xs text-[#8E8E93]">
                  <th className="pb-3 font-medium">Nome</th>
                  <th className="pb-3 font-medium">Perfil</th>
                  <th className="pb-3 font-medium">Último acesso</th>
                  <th className="pb-3 font-medium">Situação</th>
                  {podeGerenciar && <th className="pb-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {users.map(u => {
                  const sit = situacaoDe(u);
                  return (
                    <tr key={u.id}>
                      <td className="py-3.5">
                        <p className="font-medium text-[#1D1D1F]">{u.nome || '—'}</p>
                        {podeGerenciar && <p className="text-[12px] text-[#8E8E93]">{u.email}</p>}
                      </td>
                      <td className="py-3.5 text-[#1D1D1F]">{roleName[u.papel] ?? u.papel}</td>
                      <td className="py-3.5 text-[#6E6E73] tnum">{acessoBR(u.ultimo_acesso)}</td>
                      <td className="py-3.5">
                        {sit === 'ativo' && <span className="rounded-full bg-[#E8F8EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#248A3D]">Ativo</span>}
                        {sit === 'convite' && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="rounded-full bg-[#FFF3E8] px-2.5 py-0.5 text-[11px] font-semibold text-[#9a631b]">Convite enviado</span>
                            {podeGerenciar && <button onClick={() => void reenviar(u)} className="text-[12px] font-medium text-[#0A60D0] hover:underline">Reenviar</button>}
                          </span>
                        )}
                        {sit === 'inativo' && <span className="rounded-full bg-[#F5F5F7] px-2.5 py-0.5 text-[11px] font-semibold text-[#8E8E93]">Desativado</span>}
                      </td>
                      {podeGerenciar && (
                        <td className="py-3.5 text-right">
                          <button onClick={() => openManage(u)} className="rounded-lg border border-[#D2D2D7] px-3 py-1.5 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Gerenciar</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cartões (mobile) */}
          <div className="space-y-3 sm:hidden">
            {users.map(u => {
              const sit = situacaoDe(u);
              return (
                <div key={u.id} className="rounded-xl border border-[#E5E5EA] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-[#1D1D1F]">{u.nome || '—'}</p>
                    {sit === 'ativo' && <span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[10px] font-semibold text-[#248A3D]">Ativo</span>}
                    {sit === 'convite' && <span className="rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[10px] font-semibold text-[#9a631b]">Convite</span>}
                    {sit === 'inativo' && <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-semibold text-[#8E8E93]">Desativado</span>}
                  </div>
                  <p className="mt-1 text-[13px] text-[#6E6E73]">{roleName[u.papel] ?? u.papel} · {acessoBR(u.ultimo_acesso)}</p>
                  {podeGerenciar && <button onClick={() => openManage(u)} className="mt-2 rounded-lg border border-[#D2D2D7] px-3 py-1.5 text-[12px] font-semibold text-[#1D1D1F]">Gerenciar</button>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {panelMode === 'invite' && (
        <ConvidarPanel onClose={() => setPanelMode(null)} onDone={(msg) => { setPanelMode(null); setSuccess(msg); void reload(); }} />
      )}
      {panelMode === 'manage' && panelUser && (
        <GerenciarPanel user={panelUser} onClose={() => setPanelMode(null)} onDone={(msg) => { setPanelMode(null); if (msg) setSuccess(msg); void reload(); }} />
      )}
    </>
  );
}

/** Painel lateral (drawer) para convidar uma pessoa. */
function ConvidarPanel({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { empresa } = useMotorAuth();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<PerfilId>('operacao');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  const perfilInfo = PERFIS_INFO.find(p => p.id === papel);

  async function enviar() {
    if (!supabase) return;
    setError('');
    if (!nome.trim() || !email.trim()) { setError('Nome e e-mail são obrigatórios.'); return; }
    setBusy(true);
    const { data, error: fnError } = await supabase.functions.invoke('admin-usuarios', { body: { acao: 'convidar', email: email.trim(), nome: nome.trim(), papel } });
    setBusy(false);
    if (fnError) { setError(friendlyError(fnError)); return; }
    const d = data as { ok?: boolean; error?: string } | null;
    if (d?.error) { setError(typeof d.error === 'string' ? d.error : friendlyError()); return; }
    onDone(`Convite enviado para ${email.trim()}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E5E5EA] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-[#1D1D1F]">Convidar pessoa</h2>
          <button onClick={onClose} className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">E-mail *</span>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@empresa.com" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome *</span>
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
            </label>
            <div>
              <span className="mb-2 block text-[13px] font-semibold text-[#1D1D1F]">Perfil *</span>
              <div className="space-y-2">
                {PERFIS_INFO.map(p => (
                  <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${papel === p.id ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
                    <input type="radio" name="papel" checked={papel === p.id} onChange={() => setPapel(p.id as PerfilId)} className="mt-1 h-4 w-4 accent-[#1D1D1F]" />
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#1D1D1F]">{p.nome}</p>
                      <p className="text-[12px] text-[#6E6E73]">{p.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            {papel === 'admin' && (
              <div className="flex items-start gap-2 rounded-lg border border-[#f0d49a] bg-[#FFF7E8] px-4 py-3 text-[12px] text-[#9a631b]">
                <Lock size={14} className="mt-0.5 shrink-0" />
                <p>Verificação em duas etapas obrigatória no 1º acesso.</p>
              </div>
            )}
            {/* Resumo do que a pessoa vai poder fazer */}
            <div className="rounded-xl bg-[#F5F5F7] p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">Resumo</p>
              <p className="mt-1 text-[13px] text-[#1D1D1F]">{perfilInfo?.desc}</p>
            </div>
          </div>
        </div>
        <div className="border-t border-[#E5E5EA] px-5 py-4">
          <button onClick={enviar} disabled={busy} className="h-11 w-full rounded-lg bg-[#1D1D1F] text-sm font-semibold text-white hover:opacity-85 disabled:opacity-50">
            {busy ? 'Enviando…' : 'Enviar convite'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Painel lateral (drawer) para gerenciar uma pessoa. */
function GerenciarPanel({ user, onClose, onDone }: { user: Perfil; onClose: () => void; onDone: (msg: string) => void }) {
  const { perfil } = useMotorAuth();
  const [papel, setPapel] = useState<PerfilId>(user.papel as PerfilId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmarDesativar, setConfirmarDesativar] = useState(false);
  const [resetEnviado, setResetEnviado] = useState(false);

  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  const perfilInfo = PERFIS_INFO.find(p => p.id === papel);
  const papelMudou = papel !== user.papel;
  const isSelf = user.id === perfil?.id;

  async function salvarPapel() {
    if (!supabase || !papelMudou) return;
    setBusy(true); setError('');
    const { error } = await supabase.from('perfis').update({ papel }).eq('id', user.id).select('id,nome,email,papel,ativo,empresa_id,equipe,ultimo_acesso').single();
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    onDone(`Perfil de ${user.nome} alterado para ${PERFIS_INFO.find(p => p.id === papel)?.nome}.`);
  }

  async function redefinirSenha() {
    if (!supabase || !user.email) return;
    setBusy(true); setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/definir-senha` });
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    setResetEnviado(true);
  }

  async function desativar() {
    if (!supabase) return;
    setBusy(true); setError('');
    const { error } = await supabase.from('perfis').update({ ativo: false }).eq('id', user.id);
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    onDone(`${user.nome} perdeu o acesso.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E5E5EA] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-[#1D1D1F]">{user.nome || '—'}</h2>
            <p className="truncate text-[12px] text-[#8E8E93]">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
          {isSelf && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#f0d49a] bg-[#FFF7E8] px-4 py-3 text-[12px] text-[#9a631b]">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <p>Você não pode alterar o seu próprio perfil.</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <span className="mb-2 block text-[13px] font-semibold text-[#1D1D1F]">Perfil</span>
              <select value={papel} disabled={isSelf || busy} onChange={e => setPapel(e.target.value as PerfilId)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]">
                {PERFIS_INFO.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <p className="mt-1.5 text-[12px] text-[#6E6E73]">{perfilInfo?.desc}</p>
            </div>

            <div className="rounded-xl bg-[#F5F5F7] p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">Último acesso</p>
              <p className="mt-1 text-[14px] text-[#1D1D1F] tnum">{acessoBR(user.ultimo_acesso)}</p>
            </div>

            {/* Resumo do que muda */}
            {papelMudou && !isSelf && (
              <div className="rounded-xl border border-[#1D1D1F] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">O que muda</p>
                <p className="mt-1 text-[13px] text-[#1D1D1F]">
                  Perfil atual: <strong>{PERFIS_INFO.find(p => p.id === user.papel)?.nome}</strong> → Novo perfil: <strong>{perfilInfo?.nome}</strong>.
                </p>
                <p className="mt-1 text-[12px] text-[#6E6E73]">{perfilInfo?.desc}</p>
              </div>
            )}

            <div className="space-y-2">
              <button onClick={redefinirSenha} disabled={busy || isSelf} className="flex h-10 w-full items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">
                <KeyRound size={16} /> Redefinir senha
              </button>
              {resetEnviado && <p className="text-[12px] text-[#248A3D]">E-mail de redefinição enviado para {user.email}.</p>}
            </div>
          </div>
        </div>
        <div className="border-t border-[#E5E5EA] px-5 py-4">
          {confirmarDesativar ? (
            <div className="space-y-3">
              <p className="text-[13px] text-[#1D1D1F]">{user.nome} perde o acesso na hora. O histórico fica.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmarDesativar(false)} className="h-10 flex-1 rounded-lg border border-[#D2D2D7] text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
                <button onClick={desativar} disabled={busy} className="h-10 flex-1 rounded-lg bg-[#FF3B30] text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Desativando…' : 'Desativar'}</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              {papelMudou && !isSelf ? (
                <button onClick={salvarPapel} disabled={busy} className="h-10 flex-1 rounded-lg bg-[#1D1D1F] text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar perfil'}</button>
              ) : (
                <button onClick={onClose} className="h-10 flex-1 rounded-lg border border-[#D2D2D7] text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Fechar</button>
              )}
              {!isSelf && user.ativo && (
                <button onClick={() => setConfirmarDesativar(true)} disabled={busy} className="h-10 rounded-lg border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#FF3B30] hover:bg-[#FFE8E6] disabled:opacity-50">Desativar</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
