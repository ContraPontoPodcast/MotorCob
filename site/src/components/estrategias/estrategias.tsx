import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Copy, Pencil, Plus, Route, Star, Trash2 } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateBR, friendlyError, supabase, type Row } from '@/lib/supabase';
import { isVazia, type Estrategia } from '@/lib/estrategia';

export function Estrategias() {
  const { empresa } = useMotorAuth();
  const canEdit = useAllowed(['admin', 'planejamento']);
  const [lista, setLista] = useState<Estrategia[]>([]);
  const [usos, setUsos] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmDel, setConfirmDel] = useState<Estrategia | null>(null);

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true); setError('');
    const { data, error } = await supabase.from('estrategias').select('*').eq('empresa_id', empresa.id).order('nome');
    if (error) { setError(friendlyError()); setLoading(false); return; }
    const items = (data ?? []) as Estrategia[];
    setLista(items);
    if (items.length) {
      const ids = items.map(i => i.id);
      const { data: counts } = await supabase.from('clusters').select('estrategia_id').in('estrategia_id', ids);
      const map: Record<string, number> = {};
      (counts ?? []).forEach((r: Row) => { const k = r.estrategia_id as string; if (k) map[k] = (map[k] ?? 0) + 1; });
      setUsos(map);
    } else setUsos({});
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  async function duplicar(e: Estrategia) {
    if (!supabase || !empresa) return;
    setBusy(e.id);
    const { error } = await supabase.from('estrategias').insert({
      empresa_id: empresa.id, nome: `${e.nome} (cópia)`, descricao: e.descricao,
      definicao: e.definicao as unknown as Record<string, unknown>, padrao: false,
    });
    if (error) setError(friendlyError()); else void reload();
    setBusy('');
  }

  async function marcarPadrao(e: Estrategia) {
    if (!supabase || !empresa) return;
    setBusy(e.id);
    // primeiro desmarca a padrão atual
    await supabase.from('estrategias').update({ padrao: false }).eq('empresa_id', empresa.id).eq('padrao', true);
    const { error } = await supabase.from('estrategias').update({ padrao: true }).eq('id', e.id);
    if (error) setError(friendlyError()); else void reload();
    setBusy('');
  }

  async function excluir(e: Estrategia) {
    if (!supabase) return;
    setBusy(e.id);
    const { error } = await supabase.from('estrategias').delete().eq('id', e.id);
    if (error) setError(friendlyError()); else { setConfirmDel(null); void reload(); }
    setBusy('');
  }

  return <>
    <PageHeading eyebrow="CONFIGURAÇÃO / OPERAÇÃO" title="Estratégias" description="Defina, fase por fase, quais canais acionar, em que dia, em qual ordem e em quais contatos. Os clusters escolhem a estratégia." actions={canEdit && empresa ? <Link to="/estrategias/nova" className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white"><Plus size={16}/> Nova estratégia</Link> : null} />
    <div className="mb-6 rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]"><p>Cluster sem estratégia segue a padrão da empresa; sem padrão, segue o padrão MotorCX. Mudanças valem a partir da rotina do dia seguinte.</p></div>
    {!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
      : error ? <Notice>{error}</Notice>
      : loading ? <Loading/>
      : lista.length === 0 ? <Empty>Nenhuma estratégia cadastrada para esta empresa. {canEdit && 'Crie a primeira estratégia.'}</Empty>
      : <div className="grid gap-4 lg:grid-cols-2">{lista.map(e => (
        <section key={e.id} className="rounded-xl border border-[#dfe8ea] bg-white p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-[#0F4C5C]"><Route size={20}/></div>
              <div>
                <h2 className="text-lg font-semibold leading-tight">{e.nome}</h2>
                {e.padrao && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#fff3df] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#9a631b]"><Star size={11}/> Padrão da empresa</span>}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-[#eaf2f3] px-2.5 py-1 text-xs font-medium text-[#0F4C5C]">{usos[e.id] ?? 0} cluster{(usos[e.id] ?? 0) === 1 ? '' : 's'}</span>
          </div>
          {e.descricao && <p className="mt-3 text-sm text-slate-600">{e.descricao}</p>}
          {isVazia(e.definicao) && <p className="mt-2 text-xs italic text-slate-400">Estratégia vazia — segue o padrão MotorCX.</p>}
          <p className="mt-3 text-xs text-slate-400">Última alteração: {dateBR(e.atualizado_em)}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link to={`/estrategias/${e.id}`} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dadd] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]"><Pencil size={14}/> Editar</Link>
            {canEdit && <>
              <button onClick={() => void duplicar(e)} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dadd] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-50"><Copy size={14}/> Duplicar</button>
              {!e.padrao && <button onClick={() => void marcarPadrao(e)} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#c9dadd] px-3 text-xs font-semibold text-[#9a631b] hover:bg-[#fff7e8] disabled:opacity-50"><Star size={14}/> Marcar como padrão</button>}
              <button onClick={() => setConfirmDel(e)} disabled={!!busy} className="grid h-9 w-9 place-items-center rounded-lg border border-[#c9dadd] text-slate-400 hover:bg-red-50 hover:text-[#C62828]"><Trash2 size={15}/></button>
            </>}
          </div>
        </section>
      ))}</div>}

    {confirmDel && <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={() => setConfirmDel(null)}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={ev => ev.stopPropagation()}>
        <h2 className="text-lg font-semibold">Excluir estratégia</h2>
        <p className="mt-2 text-sm text-slate-600">Tem certeza que deseja excluir <strong>{confirmDel.nome}</strong>? Os clusters que usam esta estratégia passam a seguir a padrão da empresa.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => setConfirmDel(null)} className="h-10 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
          <button onClick={() => void excluir(confirmDel)} disabled={!!busy} className="h-10 rounded-lg bg-[#C62828] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Excluindo...' : 'Excluir'}</button>
        </div>
      </div>
    </div>}
  </>;
}
