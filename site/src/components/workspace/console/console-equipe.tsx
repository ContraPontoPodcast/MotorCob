import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Plus, X, ShieldCheck, RotateCcw, Lock } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { haQuanto } from '@/lib/empresa-helpers';
import { ConsoleShell, cardShadow } from './console-shell';
import { Chave } from './chave';
import { useConsolePerms, PAPEL_LABEL, PAPEL_COR, type EquipeMembro, type PermCatalogo } from './console-perms';

const REAUTH = 'duas etapas';
const MASTER_MIN = ['pelo menos', 'master ativo'];
const SELF = 'própria função';

const PAPEL_DESC: Record<string, string> = {
  master: 'Vê tudo e gerencia a equipe.',
  atendimento: 'Vê todas as empresas e responde chamados.',
  comercial: 'Nasce com alcance "Só a carteira".',
  administrativo: 'Faz: ativação, suspender/encerrar/reativar, faturamento e nota fiscal, produtos e preços (inclusive abaixo do mínimo, com motivo), fornecedores, custos e rotas. Não faz: Orquestração dos clientes nem a Equipe.',
  tecnico: 'Vê a qualidade dos fornecedores e o detalhe técnico dos envios, configura o filtro de inteligência e os nomes devolvidos ao cliente. Atende chamados.',
};

function classificarErro(msg: string): 'reauth' | 'master' | 'self' | null {
  const m = msg.toLowerCase();
  if (m.includes(REAUTH)) return 'reauth';
  if (MASTER_MIN.some(s => m.includes(s))) return 'master';
  if (m.includes(SELF)) return 'self';
  return null;
}

/** Valor padrão de uma permissão por papel (do catálogo). */
function padraoPapel(cat: PermCatalogo, funcao: string): boolean {
  if (funcao === 'master') return cat.master;
  if (funcao === 'comercial') return cat.comercial;
  if (funcao === 'administrativo') return cat.administrativo;
  if (funcao === 'tecnico') return cat.tecnico;
  return cat.atendimento;
}

export function ConsoleEquipePage() {
  const { perfil } = useMotorAuth();
  const navigate = useNavigate();
  const { membros, catalogo, loading, reload, can } = useConsolePerms();
  const [selId, setSelId] = useState<string | null>(null);
  const [convite, setConvite] = useState(false);

  // Sem gerenciar_equipe → sai.
  if (!loading && !can('gerenciar_equipe')) return <Navigate to="/console" replace />;

  async function sairEEntrar() {
    if (!supabase) return;
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  const sel = membros.find(m => m.id === selId) ?? null;

  return (
    <ConsoleShell>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-[14px] text-[#6E6E73]">Pessoas da equipe MotorCX com acesso ao Console.</p>
        <button onClick={() => setConvite(true)} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Convidar</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
          {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
            membros.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Ninguém na equipe ainda.</p> :
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Nome</th><th className="pb-3 font-medium">E-mail</th><th className="pb-3 font-medium">Papel</th><th className="pb-3 font-medium">Alcance</th><th className="pb-3 font-medium">Duas etapas</th><th className="pb-3 font-medium">Último acesso</th><th className="pb-3 font-medium">Situação</th></tr></thead>
                <tbody className="divide-y divide-[#F0F0F2]">{membros.map(m => {
                  const souEu = m.id === perfil?.id;
                  return (
                    <tr key={m.id} className={`cursor-pointer align-top hover:bg-[#F5F5F7] ${selId === m.id ? 'bg-[#F5F5F7]' : ''}`} onClick={() => setSelId(m.id)}>
                      <td className="py-3 font-semibold text-[#1D1D1F]">{m.nome || '—'}{souEu && <span className="ml-1.5 text-[12px] font-normal text-[#8E8E93]">(você)</span>}</td>
                      <td className="py-3 text-[#6E6E73]">{m.email}</td>
                      <td className="py-3"><PapelBadge funcao={m.funcao} /></td>
                      <td className="py-3 text-[#6E6E73]">{m.funcao === 'master' ? 'Todas' : (m.alcance === 'carteira' ? `Carteira · ${m.carteira}` : 'Todas')}</td>
                      <td className="py-3">{m.duas_etapas ? <span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">OK</span> : <span className="rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[11px] font-semibold text-[#9a631b]">Pendente</span>}</td>
                      <td className="py-3 text-[#6E6E73]">{m.ultimo_login ? haQuanto(m.ultimo_login) : (m.ultimo_acesso ? dateTimeBR(m.ultimo_acesso) : '—')}</td>
                      <td className="py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.ativo ? 'bg-[#E8F8EC] text-[#248A3D]' : 'bg-[#F5F5F7] text-[#8E8E93]'}`}>{m.ativo ? 'Ativo' : 'Inativo'}</span></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>}
        </section>

        {sel && (
          <EquipePainel
            membro={sel}
            catalogo={catalogo}
            souEu={sel.id === perfil?.id}
            onReload={reload}
            onSairEEntrar={sairEEntrar}
          />
        )}
      </div>

      <p className="mt-4 text-[12px] text-[#8E8E93]">Master entra sempre com o código de duas etapas. Mantenha pelo menos um Master para não ficar sem acesso.</p>

      {convite && <ConvidarModal onClose={() => setConvite(false)} onSaved={() => { setConvite(false); void reload(); }} />}
    </ConsoleShell>
  );
}

function PapelBadge({ funcao }: { funcao: string }) {
  const label = PAPEL_LABEL[funcao] ?? funcao;
  const cor = PAPEL_COR[funcao] ?? '#8E8E93';
  return <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: cor }}>{label}</span>;
}

function EquipePainel({ membro, catalogo, souEu, onReload, onSairEEntrar }: {
  membro: EquipeMembro; catalogo: PermCatalogo[]; souEu: boolean;
  onReload: () => Promise<void>; onSairEEntrar: () => void;
}) {
  const isMaster = membro.funcao === 'master';
  // edits: chave → boolean (valor desejado). Só chaves tocadas.
  const [edits, setEdits] = useState<Record<string, boolean>>({});
  const [alcance, setAlcance] = useState<'todas' | 'carteira'>(membro.alcance === 'carteira' ? 'carteira' : 'todas');
  const [busy, setBusy] = useState(false);
  const [erroLocal, setErroLocal] = useState('');
  const [confirmAcao, setConfirmAcao] = useState<string | null>(null);

  useEffect(() => { setEdits({}); setAlcance(membro.alcance === 'carteira' ? 'carteira' : 'todas'); setErroLocal(''); setConfirmAcao(null); }, [membro.id]);

  function efetivo(cat: PermCatalogo): boolean {
    if (cat.permissao in edits) return edits[cat.permissao];
    if (cat.permissao in membro.permissoes) return membro.permissoes[cat.permissao];
    return padraoPapel(cat, membro.funcao);
  }
  function diferentePadrao(cat: PermCatalogo): boolean {
    return efetivo(cat) !== padraoPapel(cat, membro.funcao);
  }
  function toggle(cat: PermCatalogo) {
    if (isMaster) return;
    setEdits(prev => ({ ...prev, [cat.permissao]: !efetivo(cat) }));
  }

  const grupos = useMemo(() => {
    const map: Record<string, PermCatalogo[]> = {};
    for (const c of catalogo) { (map[c.grupo] ??= []).push(c); }
    return Object.entries(map);
  }, [catalogo]);

  const temEdits = Object.keys(edits).length > 0 || alcance !== (membro.alcance === 'carteira' ? 'carteira' : 'todas');

  async function mudarFuncao(funcao: string) {
    if (!supabase) return;
    setBusy(true); setErroLocal('');
    const { error } = await supabase.rpc('definir_funcao_equipe', { usuario: membro.id, funcao });
    setBusy(false);
    if (error) { setErroLocal(friendlyError(error)); return; }
    await onReload();
  }

  async function salvar() {
    if (!supabase) return;
    setBusy(true); setErroLocal('');
    const permissoes: Record<string, boolean | null> = {};
    for (const [chave, val] of Object.entries(edits)) {
      const cat = catalogo.find(c => c.permissao === chave);
      const padrao = cat ? padraoPapel(cat, membro.funcao) : false;
      permissoes[chave] = val === padrao ? null : val;
    }
    const { error } = await supabase.rpc('configurar_equipe', { usuario: membro.id, alcance, permissoes });
    setBusy(false);
    if (error) { setErroLocal(friendlyError(error)); return; }
    setEdits({});
    await onReload();
  }

  async function voltarPadrao() {
    if (!supabase) return;
    setBusy(true); setErroLocal('');
    const permissoes: Record<string, null> = {};
    for (const c of catalogo) permissoes[c.permissao] = null;
    const { error } = await supabase.rpc('configurar_equipe', { usuario: membro.id, alcance: 'todas', permissoes });
    setBusy(false);
    if (error) { setErroLocal(friendlyError(error)); return; }
    setEdits({}); setAlcance('todas');
    await onReload();
  }

  async function executar(acao: string) {
    if (!supabase) return;
    setBusy(true); setErroLocal('');
    try {
      if (acao === 'resetar_2fa' || acao === 'desativar' || acao === 'reativar') {
        const { data, error: invError } = await supabase.functions.invoke('admin-usuarios', { body: { acao, usuario_id: membro.id } });
        if (invError) throw invError;
        const d = data as { erro?: string } | null;
        if (d?.erro) throw new Error(d.erro);
      }
      setConfirmAcao(null);
      await onReload();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? friendlyError(e);
      const tipo = classificarErro(msg);
      if (tipo === 'reauth') setErroLocal('entre com o seu código de duas etapas para mudar a equipe');
      else if (tipo === 'master') setErroLocal('a equipe precisa de pelo menos um Master ativo');
      else if (tipo === 'self') setErroLocal('ninguém muda a própria função');
      else setErroLocal(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="rounded-2xl bg-white p-6 lg:sticky lg:top-4 lg:self-start" style={{ boxShadow: cardShadow }}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-[#1D1D1F]">{membro.nome}</p>
          <p className="truncate text-[13px] text-[#6E6E73]">{membro.email}</p>
        </div>
        <PapelBadge funcao={membro.funcao} />
      </div>

      {souEu ? (
        <div className="rounded-xl bg-[#F5F5F7] p-4 text-center text-[14px] text-[#6E6E73]">
          <Lock className="mx-auto mb-2 text-[#8E8E93]" size={20} />
          Peça a outro Master.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Papel */}
          <div>
            <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Papel</p>
            <div className="flex rounded-[12px] bg-[#F5F5F7] p-1">
              {(['master', 'atendimento', 'comercial', 'administrativo', 'tecnico'] as const).map(f => (
                <button key={f} disabled={busy} onClick={() => mudarFuncao(f)} className={`flex-1 rounded-[9px] py-1.5 text-[11px] font-medium transition-colors ${membro.funcao === f ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED] disabled:opacity-50'}`}>{PAPEL_LABEL[f]}</button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-[#8E8E93]">{PAPEL_DESC[membro.funcao] ?? 'As permissões voltam ao padrão do novo papel.'}</p>
          </div>

          {/* Alcance (não aparece para Master) */}
          {!isMaster && (
            <div>
              <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Alcance</p>
              <div className="space-y-2">
                <button onClick={() => setAlcance('todas')} className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${alcance === 'todas' ? 'border-[#1D1D1F]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: alcance === 'todas' ? '#1D1D1F' : '#D2D2D7' }}>{alcance === 'todas' && <span className="h-2 w-2 rounded-full bg-[#1D1D1F]" />}</span>
                  <span><span className="block text-[14px] font-semibold text-[#1D1D1F]">Todas as empresas</span><span className="block text-[12px] text-[#6E6E73]">Vê o Console inteiro dentro das permissões.</span></span>
                </button>
                <button onClick={() => setAlcance('carteira')} className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors ${alcance === 'carteira' ? 'border-[#1D1D1F]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: alcance === 'carteira' ? '#1D1D1F' : '#D2D2D7' }}>{alcance === 'carteira' && <span className="h-2 w-2 rounded-full bg-[#1D1D1F]" />}</span>
                  <span><span className="block text-[14px] font-semibold text-[#1D1D1F]">Só a carteira</span><span className="block text-[12px] text-[#6E6E73]">Só as empresas em que é Vendedor ou Gerente.</span></span>
                </button>
              </div>
            </div>
          )}

          {/* Permissões */}
          <div>
            <p className="mb-2 text-[12px] font-semibold text-[#6E6E73]">Permissões</p>
            {isMaster ? (
              <div className="rounded-xl bg-[#F5F5F7] p-4 text-[13px] text-[#1D1D1F]">
                <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={15} className="text-[#C9A35A]" /> Master tem tudo e vê todas as empresas.</p>
                <p className="mt-1 text-[#6E6E73]">Sempre existe pelo menos um Master.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {grupos.map(([grupo, cats]) => (
                  <div key={grupo}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">{grupo}</p>
                    <div className="divide-y divide-[#F0F0F2] rounded-xl border border-[#F0F0F2]">
                      {cats.map(cat => {
                        const on = efetivo(cat);
                        const diff = diferentePadrao(cat);
                        return (
                          <div key={cat.permissao} className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[13px] text-[#1D1D1F]">{cat.nome}</p>
                              {diff && <span className="text-[11px] font-medium text-[#9a631b]">diferente do padrão do papel</span>}
                            </div>
                            <Chave checked={on} on={() => toggle(cat)} disabled={isMaster} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {erroLocal && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">
              <span className="flex-1">{erroLocal}</span>
              {classificarErro(erroLocal) === 'reauth' && <button onClick={onSairEEntrar} className="rounded-lg border border-[#D2D2D7] bg-white px-2.5 py-1 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Sair e entrar</button>}
            </div>
          )}

          {!isMaster && (
            <div className="flex gap-2">
              <button onClick={voltarPadrao} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-full border border-[#D2D2D7] px-3 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50"><RotateCcw size={13} /> Voltar ao padrão do papel</button>
              <button onClick={salvar} disabled={busy || !temEdits} className="flex h-9 flex-1 items-center justify-center rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button>
            </div>
          )}

          {/* Desativar / Resetar 2FA */}
          <div className="border-t border-[#F0F0F2] pt-4">
            {confirmAcao ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-[#1D1D1F]">Confirmar?</span>
                <button onClick={() => void executar(confirmAcao)} disabled={busy} className="rounded-lg bg-[#1D1D1F] px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? '...' : 'Sim'}</button>
                <button onClick={() => { setConfirmAcao(null); setErroLocal(''); }} disabled={busy} className="rounded-lg border border-[#D2D2D7] px-2.5 py-1 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Não</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setConfirmAcao('resetar_2fa')} className="rounded-lg border border-[#D2D2D7] px-3 py-1.5 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Resetar duas etapas</button>
                {membro.ativo
                  ? <button onClick={() => setConfirmAcao('desativar')} className="rounded-lg border border-[#D2D2D7] px-3 py-1.5 text-[12px] font-semibold text-[#FF3B30] hover:bg-[#FFE8E6]">Desativar</button>
                  : <button onClick={() => setConfirmAcao('reativar')} className="rounded-lg border border-[#D2D2D7] px-3 py-1.5 text-[12px] font-semibold text-[#248A3D] hover:bg-[#E8F8EC]">Reativar</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function ConvidarModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [funcao, setFuncao] = useState<'master' | 'atendimento' | 'comercial' | 'administrativo' | 'tecnico'>('atendimento');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  async function salvar() {
    if (!supabase) return;
    setError('');
    if (!email.trim()) { setError('Informe o e-mail.'); return; }
    if (!nome.trim()) { setError('Informe o nome.'); return; }
    setBusy(true);
    const { data, error: invError } = await supabase.functions.invoke('admin-usuarios', { body: { acao: 'convidar_equipe', email: email.trim(), nome: nome.trim(), funcao } });
    setBusy(false);
    if (invError) { setError(friendlyError(invError)); return; }
    const d = data as { erro?: string } | null;
    if (d?.erro) { setError(typeof d.erro === 'string' ? d.erro : friendlyError()); return; }
    setOk(true);
    setTimeout(onSaved, 1500);
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[480px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold text-[#1D1D1F]">Convidar para a equipe</h2><button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button></div>
        {ok ? <p className="py-8 text-center text-[15px] text-[#248A3D]">Convite enviado. No primeiro acesso, Master cadastra o autenticador.</p> : (
          <div className="space-y-4">
            <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Nome</span><input value={nome} onChange={e => setNome(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label>
            <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">E-mail*</span><input value={email} onChange={e => setEmail(e.target.value)} type="email" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label>
            <div>
              <span className="mb-1.5 block text-[12px] font-semibold text-[#6E6E73]">Papel</span>
              <div className="mb-2 flex rounded-[12px] bg-[#F5F5F7] p-1">{(['atendimento', 'comercial', 'master', 'administrativo', 'tecnico'] as const).map(f => <button key={f} type="button" onClick={() => setFuncao(f)} className={`flex-1 rounded-[9px] py-1.5 text-[12px] font-medium transition-colors ${funcao === f ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{PAPEL_LABEL[f]}</button>)}</div>
              <p className="text-[12px] text-[#8E8E93]">{PAPEL_DESC[funcao] ?? 'Atendimento: vê todas as empresas e responde chamados.'}</p>
            </div>
            {error && <p role="alert" className="text-[14px] text-[#FF3B30]">{error}</p>}
            <div className="flex justify-end gap-3"><button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button><button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Enviando...' : 'Enviar convite'}</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
