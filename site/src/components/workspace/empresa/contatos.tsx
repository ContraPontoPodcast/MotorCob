import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, dateBR, type Row } from '@/lib/supabase';
import { PAPEL_CONTATO, formatTelefone } from '@/lib/empresa-helpers';
import { toast } from 'sonner';
import { EmpresaShell, cardShadow } from './empresa-shell';
import { Chave } from '@/components/workspace/console/chave';

const PAPEL_COR: Record<string, string> = { operacional: '#0A60D0', financeiro: '#248A3D', legal: '#7A4FB0', tecnico: '#9a631b' };

export function ContatosPage() {
  const { empresa, permissoes } = useMotorAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const canEdit = permissoes.includes('gerenciar_usuarios');

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true);
    const { data, error } = await supabase.from('empresa_contatos').select('*').eq('empresa_id', empresa.id).order('nome');
    if (error) { setError(friendlyError(error)); setRows([]); }
    else setRows(data ?? []);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  async function excluir(c: Row) {
    if (!supabase || !window.confirm(`Excluir o contato ${c.nome}?`)) return;
    const { error } = await supabase.from('empresa_contatos').delete().eq('id', c.id);
    if (error) setError(friendlyError(error)); else void reload();
  }

  async function toggleRecebeFaturas(c: Row, v: boolean) {
    if (!supabase) return;
    const { error } = await supabase.from('empresa_contatos').update({ recebe_faturas: v }).eq('id', c.id);
    if (error) setError(friendlyError(error));
    else setRows(prev => prev.map(r => (r.id === c.id ? { ...r, recebe_faturas: v } : r)));
  }

  const faturasContatos = rows.filter(c => c.recebe_faturas);
  const voltouFaturas = faturasContatos.filter(c => (c.email_situacao as string) === 'voltou');
  const nenhumOk = faturasContatos.length > 0 && !faturasContatos.some(c => (c.email_situacao as string) === 'ok');

  return (
    <EmpresaShell>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      {voltouFaturas.map(c => (
        <div key={`v-${c.id}`} className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#FFF3E8] px-4 py-3 text-[14px] text-[#9a631b]">
          <span className="flex items-center gap-2"><AlertTriangle size={16} className="shrink-0" /> O e-mail de {[c.nome, c.sobrenome].filter(Boolean).join(' ')} ({PAPEL_CONTATO[c.papel as string] ?? 'contato'}) voltou. A fatura não chega para ele. Confira o endereço.</span>
          {canEdit && <button onClick={() => { setEdit(c); setOpen(true); }} className="shrink-0 rounded-full bg-[#1D1D1F] px-4 py-1.5 text-[13px] font-semibold text-white hover:opacity-85">Corrigir</button>}
        </div>
      ))}
      {nenhumOk && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">
          <AlertTriangle size={16} className="shrink-0" /> Nenhum contato recebe a fatura por e-mail. Ela vai para os Admins até você corrigir.
        </div>
      )}
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Contatos</h2>
          {canEdit && <button onClick={() => { setEdit(null); setOpen(true); }} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Novo contato</button>}
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-[#6E6E73]">A fatura (demonstrativo, boleto e nota) vai por e-mail para todos os contatos com "Recebe faturas". Sem nenhum marcado, vai para os de papel Financeiro.</p>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          rows.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhum contato cadastrado.</p> :
          <div className="divide-y divide-[#F0F0F2]">
            {rows.map(c => {
              const papel = PAPEL_CONTATO[c.papel as string];
              return (
                <div key={c.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-semibold text-[#1D1D1F]">{[c.nome, c.sobrenome].filter(Boolean).join(' ')}</p>
                        {papel && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `${PAPEL_COR[c.papel as string] ?? '#8E8E93'}1A`, color: PAPEL_COR[c.papel as string] ?? '#8E8E93' }}>{papel}</span>}
                        {c.recebe_faturas && <span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">Faturas</span>}
                        {c.setor && <span className="text-[13px] text-[#8E8E93]">{c.setor}</span>}
                        <EmailSituacao c={c} />
                      </div>
                      <p className="mt-0.5 text-[13px] text-[#6E6E73]">{[c.telefone && formatTelefone(c.telefone), c.email].filter(Boolean).join(' · ')}</p>
                      {c.observacao && <p className="mt-0.5 text-[13px] text-[#8E8E93]">{c.observacao}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => { setEdit(c); setOpen(true); }} className="grid h-8 w-8 place-items-center rounded-lg text-[#6E6E73] hover:bg-[#F5F5F7]"><Pencil size={15} /></button>
                        <button onClick={() => excluir(c)} className="grid h-8 w-8 place-items-center rounded-lg text-[#FF3B30] hover:bg-[#FFE8E6]"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <Chave
                      className="mt-1"
                      label={<span className="text-[14px] font-medium text-[#1D1D1F]">Recebe faturas</span>}
                      checked={!!c.recebe_faturas}
                      on={(v) => void toggleRecebeFaturas(c, v)}
                      disabled={!c.email}
                      desc={!c.email ? 'Cadastre o e-mail' : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>}
      </section>
      {open && <ContatoModal empresaId={empresa!.id} contato={edit} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void reload(); }} />}
    </EmpresaShell>
  );
}

function ContatoModal({ empresaId, contato, onClose, onSaved }: { empresaId: string; contato: Row | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ nome: contato?.nome ?? '', sobrenome: contato?.sobrenome ?? '', setor: contato?.setor ?? '', papel: contato?.papel ?? '', telefone: contato?.telefone ? formatTelefone(contato.telefone) : '', email: contato?.email ?? '', observacao: contato?.observacao ?? '', recebe_faturas: contato?.recebe_faturas ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  function set(k: string, v: string) { setF(p => ({ ...p, [k]: v })); }

  async function salvar() {
    if (!supabase) return;
    setError('');
    if (f.nome.trim().length < 2) { setError('Informe o nome.'); return; }
    if (f.observacao.length > 1000) { setError('Observação até 1000 caracteres.'); return; }
    setBusy(true);
    const payload = { empresa_id: empresaId, nome: f.nome.trim(), sobrenome: f.sobrenome.trim() || null, setor: f.setor.trim() || null, papel: f.papel || null, telefone: f.telefone.replace(/\D/g, '') || null, email: f.email.trim() || null, observacao: f.observacao.trim() || null, recebe_faturas: f.recebe_faturas && !!f.email.trim() };
    const res = contato
      ? supabase.from('empresa_contatos').update(payload).eq('id', contato.id)
      : supabase.from('empresa_contatos').insert(payload);
    const { error } = await res;
    setBusy(false);
    if (error) { setError(friendlyError(error)); return; }
    if (contato && f.email.trim() && (contato.email ?? '') !== f.email.trim()) {
      toast.success('E-mail corrigido. O próximo envio vai para o endereço novo.');
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[480px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[#1D1D1F]">{contato ? 'Editar contato' : 'Novo contato'}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={20} /></button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Nome*</span><input value={f.nome} onChange={e => set('nome', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Sobrenome</span><input value={f.sobrenome} onChange={e => set('sobrenome', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Setor</span><input value={f.setor} onChange={e => set('setor', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Papel</span><select value={f.papel} onChange={e => { const v = e.target.value; setF(p => ({ ...p, papel: v, recebe_faturas: !contato && v === 'financeiro' ? true : p.recebe_faturas })); }} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]"><option value="">—</option>{Object.entries(PAPEL_CONTATO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Telefone</span><input value={f.telefone} onChange={e => set('telefone', formatTelefone(e.target.value))} placeholder="(11) 99999-9999" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">E-mail</span><input value={f.email} onChange={e => set('email', e.target.value)} type="email" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Observação</span><textarea value={f.observacao} onChange={e => set('observacao', e.target.value)} rows={3} maxLength={1000} className="w-full rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" /></label>
          <div className="sm:col-span-2">
            <Chave
              label={<span className="text-[14px] font-medium text-[#1D1D1F]">Recebe faturas</span>}
              checked={!!f.recebe_faturas}
              on={(v) => setF(p => ({ ...p, recebe_faturas: v }))}
              disabled={!f.email.trim()}
              desc={!f.email.trim() ? 'Cadastre o e-mail' : 'A fatura (demonstrativo, boleto e nota) vai por e-mail para este contato'}
            />
          </div>
        </div>
        {error && <p role="alert" className="mt-4 text-[14px] text-[#FF3B30]">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
          <button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

/** Pílula de situação do e-mail do contato. */
function EmailSituacao({ c }: { c: Row }) {
  const sit = c.email_situacao as string | undefined;
  if (sit === 'voltou') {
    const motivo = c.email_motivo ? String(c.email_motivo) : '';
    const data = c.email_voltou_em ? dateBR(c.email_voltou_em) : '';
    const title = [motivo, data && `voltou em ${data}`].filter(Boolean).join(' · ');
    return <span title={title} className="rounded-full bg-[#FFE8E6] px-2 py-0.5 text-[11px] font-semibold text-[#FF3B30]">E-mail voltou</span>;
  }
  if (sit === 'ok' && c.email_entregue_em) {
    return <span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">Entregue {dateBR(c.email_entregue_em)}</span>;
  }
  return <span className="text-[13px] text-[#C7C7CC]">—</span>;
}
