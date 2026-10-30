import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { MoreHorizontal, Pencil } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { SITUACOES, SEGMENTOS, formatCNPJ } from '@/lib/empresa-helpers';
import { useConsolePerms, useFrentesMap } from '@/components/workspace/console/console-perms';
import { FrenteBadges } from '@/components/workspace/console/frente-badge';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

export function EmpresaShell({ children, onEdit }: { children: ReactNode; onEdit?: () => void }) {
  const { empresa, perfil, refresh } = useMotorAuth();
  const { can, isMaster } = useConsolePerms();
  const frentesMap = useFrentesMap();
  const isEquipeAdmin = !!perfil?.equipe && perfil?.papel === 'admin';
  const podePausar = can('pausar_empresa');

  // Linha completa da empresa (situacao, slug, motivo, data) — o objeto do auth
  // só traz id/slug/nome/ativa.
  const [emp, setEmp] = useState<Row | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [acao, setAcao] = useState<'suspender' | 'encerrar' | 'reativar' | 'excluir' | 'liberar' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  async function reloadEmp() {
    if (!supabase || !empresa) { setEmp(null); return; }
    const { data } = await supabase.from('empresas').select('id,slug,nome,situacao,situacao_motivo,situacao_em,situacao_por,liberada_ate').eq('id', empresa.id).maybeSingle();
    setEmp((data as Row | null) ?? null);
  }
  useEffect(() => { void reloadEmp(); }, [empresa?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  if (!empresa) {
    return (
      <div className="mx-auto max-w-[960px] px-4 py-10">
        <div className="rounded-2xl bg-white p-10 text-center text-[#6E6E73]" style={{ boxShadow: cardShadow }}>
          Escolha a empresa no topo para ver esta página.
        </div>
      </div>
    );
  }

  const situacao = (emp?.situacao as string) ?? 'ativa';
  const sit = SITUACOES[situacao] ?? SITUACOES.ativa;
  const podeSuspender = situacao === 'ativa' || situacao === 'implantacao';
  const podeReativar = situacao === 'suspensa' || situacao === 'encerrada';

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-8">
      {/* Cabeçalho */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight text-[#1D1D1F]">{empresa.nome}</h1>
            {(() => {
              const segLabel = SEGMENTOS[(empresa as any).segmento as string] || '';
              const cnpjVal = (empresa as any).cnpj ? formatCNPJ((empresa as any).cnpj) : '';
              const bits: string[] = [];
              if (segLabel) bits.push(segLabel);
              if (cnpjVal) bits.push(`CNPJ ${cnpjVal}`);
              return (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-[#6E6E73]">
                  {bits.length > 0 && <span>{bits.join(' · ')}</span>}
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>
                  {empresa && <FrenteBadges frentes={frentesMap[empresa.id]} />}
                </div>
              );
            })()}
            {(situacao === 'suspensa' || situacao === 'encerrada') && emp?.situacao_em && (
              <p className="mt-1 text-[13px] text-[#6E6E73]">{situacao === 'suspensa' ? 'Suspensa' : 'Encerrada'} em {dateBR(emp.situacao_em)}{emp.situacao_motivo ? ` · motivo: ${emp.situacao_motivo}` : ''}{emp.situacao_por ? ` · por ${emp.situacao_por}` : ''}</p>
            )}
            {situacao === 'inadimplente' && emp?.situacao_motivo && (
              <p className="mt-1 text-[13px] text-[#FF3B30]">Inadimplente · {emp.situacao_motivo}</p>
            )}
            {situacao === 'liberada' && emp?.liberada_ate && (
              <p className="mt-1 text-[13px] text-[#9a631b]">Liberada até {dateBR(emp.liberada_ate)}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isEquipeAdmin && onEdit && (
              <button onClick={onEdit} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Pencil size={15} /> Editar empresa</button>
            )}
            {podePausar && (
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen(o => !o)} aria-label="Mais ações" aria-expanded={menuOpen} className="grid h-9 w-9 place-items-center rounded-full border border-[#D2D2D7] bg-white text-[#1D1D1F] hover:bg-[#F5F5F7]"><MoreHorizontal size={18} /></button>
                {menuOpen && (
                  <div className="absolute right-0 top-11 z-50 w-[220px] overflow-hidden rounded-2xl bg-white py-1 text-[#1D1D1F]" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
                    {podeSuspender && <MenuItem onClick={() => { setMenuOpen(false); setAcao('suspender'); }}>Suspender</MenuItem>}
                    {podeSuspender && <MenuItem onClick={() => { setMenuOpen(false); setAcao('encerrar'); }}>Encerrar</MenuItem>}
                    {podeReativar && <MenuItem onClick={() => { setMenuOpen(false); setAcao('reativar'); }}>Reativar</MenuItem>}
                    {situacao === 'inadimplente' && isMaster && <MenuItem onClick={() => { setMenuOpen(false); setAcao('liberar'); }}>Liberar mesmo com fatura em aberto</MenuItem>}
                    {isMaster && <MenuItem onClick={() => { setMenuOpen(false); setAcao('excluir'); }} danger>Excluir empresa de teste</MenuItem>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {children}

      {acao === 'liberar' && (
        <LiberarModal empresaId={empresa.id} onClose={() => setAcao(null)} onDone={async () => { setAcao(null); await reloadEmp(); await refresh(); }} />
      )}
      {acao && acao !== 'liberar' && (
        <SituacaoModal
          acao={acao as 'suspender' | 'encerrar' | 'reativar' | 'excluir'}
          slug={emp?.slug as string | undefined}
          empresaId={empresa.id}
          onClose={() => setAcao(null)}
          onDone={async (excluida) => {
            setAcao(null);
            if (excluida) return;
            await reloadEmp();
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center px-4 py-2.5 text-left text-[14px] hover:bg-[#F5F5F7] ${danger ? 'text-[#FF3B30]' : 'text-[#1D1D1F]'}`}>{children}</button>
  );
}

function SituacaoModal({ acao, slug, empresaId, onClose, onDone }: {
  acao: 'suspender' | 'encerrar' | 'reativar' | 'excluir';
  slug?: string; empresaId: string; onClose: () => void; onDone: (excluida: boolean) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [motivo, setMotivo] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  const titulo = acao === 'suspender' ? 'Suspender empresa' : acao === 'encerrar' ? 'Encerrar empresa' : acao === 'reativar' ? 'Reativar empresa' : 'Excluir empresa de teste';
  const aviso = acao === 'suspender'
    ? 'A rotina e os envios param até reativar. Os usuários continuam entrando.'
    : acao === 'encerrar'
      ? 'A empresa sai da rotina, da Saúde e da emissão de faturas.'
      : acao === 'excluir'
        ? 'Só para empresa criada por engano ou de teste, sem nenhum histórico. Não tem volta.'
        : '';

  async function confirmar() {
    if (!supabase) return;
    setError('');
    if (acao === 'suspender' || acao === 'encerrar') {
      if (motivo.trim().length < 3 || motivo.trim().length > 200) { setError('Informe o motivo (3 a 200 caracteres).'); return; }
      setBusy(true);
      const { error: e } = await supabase.rpc('mudar_situacao_empresa', { empresa: empresaId, nova: acao === 'suspender' ? 'suspensa' : 'encerrada', motivo: motivo.trim() });
      setBusy(false);
      if (e) { setError(e.message || friendlyError(e)); return; }
      await onDone(false);
    } else if (acao === 'reativar') {
      setBusy(true);
      const { error: e } = await supabase.rpc('mudar_situacao_empresa', { empresa: empresaId, nova: 'ativa', motivo: null });
      setBusy(false);
      if (e) { setError(e.message || friendlyError(e)); return; }
      await onDone(false);
    } else {
      if (confirmacao.trim() !== slug) { setError(`Digite ${slug} para confirmar.`); return; }
      setBusy(true);
      const { error: e } = await supabase.rpc('excluir_empresa_teste', { empresa: empresaId, confirmacao: confirmacao.trim() });
      setBusy(false);
      if (e) { setError(e.message || friendlyError(e)); return; }
      await onDone(true);
      navigate('/console');
    }
  }

  const vermelho = acao === 'excluir';

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={`my-auto w-full max-w-[440px] rounded-2xl bg-white p-6 ${vermelho ? 'border-2 border-[#FF3B30]' : ''}`} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4">
          <h2 className={`text-[18px] font-semibold ${vermelho ? 'text-[#FF3B30]' : 'text-[#1D1D1F]'}`}>{titulo}</h2>
          {aviso && <p className="mt-2 text-[14px] text-[#6E6E73]">{aviso}</p>}
        </div>
        {(acao === 'suspender' || acao === 'encerrar') && (
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Motivo *</span>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={200} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="Descreva o motivo" />
            <span className="mt-1 block text-right text-[12px] text-[#8E8E93] tnum">{motivo.length}/200</span>
          </label>
        )}
        {acao === 'excluir' && (
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Digite <strong className="font-mono">{slug}</strong> para confirmar</span>
            <input value={confirmacao} onChange={e => setConfirmacao(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 font-mono text-[15px] outline-none focus:border-[#1D1D1F]" />
          </label>
        )}
        {error && <p role="alert" className="mt-3 text-[14px] text-[#FF3B30]">{error}</p>}
        {acao === 'excluir' && !error && <p className="mt-3 text-[12px] text-[#8E8E93]">Se a empresa tiver histórico, o banco recusará — nesse caso, use Encerrar.</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
          <button onClick={confirmar} disabled={busy} className={`h-10 rounded-lg px-6 text-[14px] font-semibold text-white disabled:opacity-50 ${vermelho ? 'bg-[#FF3B30] hover:opacity-85' : 'bg-[#1D1D1F] hover:opacity-85'}`}>{busy ? 'Salvando...' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  );
}

export { cardShadow };

function LiberarModal({ empresaId, onClose, onDone }: {
  empresaId: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [ate, setAte] = useState<7 | 15 | 30>(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  async function confirmar() {
    if (!supabase) return;
    setError('');
    if (motivo.trim().length < 5) { setError('Informe o motivo (5+ caracteres).'); return; }
    setBusy(true);
    const { data, error: e } = await supabase.rpc('liberar_inadimplente', { empresa: empresaId, motivo: motivo.trim(), ate });
    setBusy(false);
    if (e) { setError(e.message || friendlyError(e)); return; }
    const dataLib = (data as Row)?.data ? dateBR((data as Row).data) : '';
    void dataLib;
    await onDone();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[440px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[#1D1D1F]">Liberar empresa inadimplente</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><MoreHorizontal size={20} /></button>
        </div>
        <p className="text-[14px] text-[#6E6E73]">O acesso e os envios voltam mesmo sem pagamento. Se não pagar até a data, bloqueia de novo.</p>
        <div className="mt-4 space-y-3">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Motivo *</span><textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={200} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="Por que liberar" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Até</span><select value={ate} onChange={e => setAte(Number(e.target.value) as 7 | 15 | 30)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]"><option value={7}>7 dias</option><option value={15}>15 dias</option><option value={30}>30 dias</option></select></label>
        </div>
        {error && <p role="alert" className="mt-3 text-[14px] text-[#FF3B30]">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
          <button onClick={confirmar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Liberando...' : `Liberar até ${ate} dias`}</button>
        </div>
      </div>
    </div>
  );
}
