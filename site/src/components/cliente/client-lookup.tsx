import { useState, useEffect, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Tag, History, AlertTriangle, Landmark } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateBR, friendlyError, logAccess, states, supabase, type Row } from '@/lib/supabase';
import { rotuloEstado, rotuloCiclo, tagToPhrase, mesesAbrev } from '@/lib/operacao';
import { LigacoesAgenteVirtual } from '@/components/voz/ligacoes-cliente';

const channelNames: Record<string,string> = { WA:'WhatsApp', RC:'RCS', AV:'Agente virtual', DC:'Discador', SM:'SMS', EM:'E-mail', ND:'Nenhum' };
const tagKeys = ['safra','cluster','estado','canal','ciclo'] as const;
function parseTag(tag: string) { const parts = tag.split(/[-_.|]/); return { safra: parts.find(x => /^S\d{6}$/.test(x)) ?? '', cluster: parts.find(x => /^[AB][123]$/.test(x)) ?? '', estado: parts.find(x => Object.keys(states).includes(x)) ?? '', canal: parts.find(x => Object.keys(channelNames).includes(x)) ?? '', ciclo: parts.find(x => /^C\d+$/i.test(x)) ?? '' }; }

type CardData = { credorId: string | null; credorNome: string; current: Row; history: Row[] };

export function ClientLookup() {
  const { empresa, credor, credores } = useMotorAuth();
  const [searchParams] = useSearchParams();
  const [id, setId] = useState(''); const [cards, setCards] = useState<CardData[]>([]);
  const [searched, setSearched] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState('');

  async function search(e: FormEvent) { e.preventDefault(); const value = id.trim(); if (!value || !supabase || !empresa) return; setLoading(true); setError(''); setSearched(false); setCards([]);
    try { await logAccess('consulta_cliente', value, empresa.id);
      const [a,b] = await Promise.all([
        supabase.from('estado_cliente').select('*').eq('empresa_id', empresa.id).eq('id_cliente', value),
        supabase.from('trilha').select('*').eq('empresa_id', empresa.id).eq('id_cliente', value).order('data', { ascending: true }).order('id', { ascending: true }),
      ]);
      if (a.error || b.error) throw new Error('query');
      const estados = (a.data ?? []) as Row[];
      const trilhas = (b.data ?? []) as Row[];
      // filtra por credor quando houver um escolhido
      const estFiltrados = credor ? estados.filter(r => r.credor_id === credor.id) : estados;
      const trFiltrados = credor ? trilhas.filter(r => r.credor_id === credor.id) : trilhas;
      const credorNome = (cid: string | null) => cid ? (credores.find(c => c.id === cid)?.nome ?? 'Credor') : 'Credor';
      const byCredor = new Map<string | null, { current: Row; history: Row[] }>();
      estFiltrados.forEach(r => { const k = (r.credor_id ?? null) as string | null; if (!byCredor.has(k)) byCredor.set(k, { current: r, history: [] }); });
      trFiltrados.forEach(r => { const k = (r.credor_id ?? null) as string | null; const e = byCredor.get(k); if (e) e.history.push(r); else byCredor.set(k, { current: {} as Row, history: [r] }); });
      const list: CardData[] = [...byCredor.entries()].map(([cid, v]) => ({ credorId: cid, credorNome: credorNome(cid), current: v.current, history: v.history }));
      setCards(list); setSearched(true);
    } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
  }

  // Pré-preenche e busca quando chega via /cliente?id=...
  useEffect(() => {
    const q = searchParams.get('id');
    if (q && q.trim() && q.trim() !== id && empresa) {
      setId(q.trim());
      // dispara a busca após o estado ser aplicado
      const value = q.trim();
      (async () => {
        if (!supabase || !empresa) return;
        setLoading(true); setError(''); setSearched(false); setCards([]);
        try { await logAccess('consulta_cliente', value, empresa.id);
          const [a,b] = await Promise.all([
            supabase.from('estado_cliente').select('*').eq('empresa_id', empresa.id).eq('id_cliente', value),
            supabase.from('trilha').select('*').eq('empresa_id', empresa.id).eq('id_cliente', value).order('data', { ascending: true }).order('id', { ascending: true }),
          ]);
          if (a.error || b.error) throw new Error('query');
          const estados = (a.data ?? []) as Row[];
          const trilhas = (b.data ?? []) as Row[];
          const estFiltrados = credor ? estados.filter(r => r.credor_id === credor.id) : estados;
          const trFiltrados = credor ? trilhas.filter(r => r.credor_id === credor.id) : trilhas;
          const credorNome = (cid: string | null) => cid ? (credores.find(c => c.id === cid)?.nome ?? 'Credor') : 'Credor';
          const byCredor = new Map<string | null, { current: Row; history: Row[] }>();
          estFiltrados.forEach(r => { const k = (r.credor_id ?? null) as string | null; if (!byCredor.has(k)) byCredor.set(k, { current: r, history: [] }); });
          trFiltrados.forEach(r => { const k = (r.credor_id ?? null) as string | null; const e = byCredor.get(k); if (e) e.history.push(r); else byCredor.set(k, { current: {} as Row, history: [r] }); });
          const list: CardData[] = [...byCredor.entries()].map(([cid, v]) => ({ credorId: cid, credorNome: credorNome(cid), current: v.current, history: v.history }));
          setCards(list); setSearched(true);
        } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, empresa?.id]);

  return <><PageHeading eyebrow="CONSULTA / CLIENTES" title={id ? `Cliente ${id}` : 'Cliente'} description="Consulte a classificação atual e a trilha de um cliente pelo ID."/>
    <form onSubmit={search} className="mb-7 flex max-w-2xl flex-col gap-3 rounded-xl border border-[#dfe8ea] bg-white p-5 sm:flex-row sm:items-end sm:p-6"><div className="flex-1"><label htmlFor="client-id" className="mb-2 block text-xs font-semibold">ID do cliente</label><input id="client-id" value={id} onChange={e => setId(e.target.value)} required placeholder="Digite o ID exato do cliente" className="h-11 w-full rounded-lg border border-[#d8e3e5] px-4 text-sm outline-none focus:border-[#0F4C5C]"/></div><button disabled={loading || !empresa} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50"><Search size={17}/> Consultar</button></form>
    {!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : <>{error && <Notice>{error}</Notice>}{loading && <Loading/>}{!loading && !searched && !error && <Empty>Digite um ID para consultar o extrato do cliente.</Empty>}{!loading && searched && cards.length === 0 && <Empty>Nenhum cliente encontrado para esse ID{credor ? ` no credor ${credor.nome}` : ''}.</Empty>}
    {!loading && cards.length > 0 && <div className="space-y-6">{cards.map((card, idx) => <ClienteCard key={card.credorId ?? idx} card={card} />)}</div>}</>}
  </>;
}

function ClienteCard({ card }: { card: CardData }) {
  const { current, history, credorNome } = card;
  const idVoz = String(current?.id_cliente ?? history[0]?.id_cliente ?? '').trim();
  const parsed = parseTag(String(current?.tag ?? current?.TAG ?? ''));
  const fieldLabels: Record<string, string> = { safra: 'Safra', cluster: 'Segmento', estado: 'Fase', canal: 'Canal', ciclo: 'Ciclo' };
  const fields = tagKeys.map(k => {
    const value = current?.[k] ?? parsed[k];
    let label = String(value || '—');
    let hint = '';
    if (k === 'safra' && /^S\d{6}$/.test(String(value))) {
      const mm = Number(String(value).slice(3, 5));
      const yy = String(value).slice(1, 3);
      label = `${mesesAbrev[mm - 1] ?? mm}/${yy}`;
    } else if (k === 'estado') {
      label = rotuloEstado[String(value)] ?? String(value || '—');
    } else if (k === 'canal') {
      label = channelNames[String(value)] ?? String(value || '—');
    } else if (k === 'ciclo') {
      label = rotuloCiclo(String(current?.estado ?? parsed.estado), String(value)) || String(value || '—');
    } else if (k === 'cluster' && current.cluster_origem && current.cluster_origem !== value) {
      hint = `Origem: ${current.cluster_origem}`;
    }
    return { key: k, label, hint };
  });
  return <div className="space-y-6">
    <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8"><div className="mb-7 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e8f1f3] text-[#0F4C5C]"><Tag size={19}/></div><div><p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">CLASSIFICAÇÃO ATUAL</p><h2 className="flex items-center gap-2 text-lg font-semibold">Cliente {current.id_cliente ?? '—'} <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf2f3] px-2 py-0.5 text-[11px] font-bold text-[#0F4C5C]"><Landmark size={11}/> {credorNome}</span></h2></div></div><span className="rounded-lg bg-[#eaf2f3] px-3 py-2 text-xs font-semibold text-[#0F4C5C]">{tagToPhrase(String(current.tag ?? current.TAG ?? ''))}</span>{current.motivo_hoje?.trim() && <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${String(current.motivo_hoje).toLowerCase().startsWith('com ação') ? 'bg-green-50 text-[#2E7D32]' : 'bg-amber-50 text-[#9a631b]'}`}>{current.motivo_hoje}</span>}</div><details className="mb-4 w-fit"><summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-[#0F4C5C]">Ver detalhe técnico</summary><code className="mt-2 block rounded-lg bg-[#eaf2f3] px-3 py-2 text-xs font-semibold text-[#0F4C5C]">{current.tag ?? current.TAG ?? '—'}</code></details><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{fields.map(f => <div key={f.key} className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{fieldLabels[f.key] ?? f.key}</p><p className="mt-2 text-lg font-semibold text-[#0F4C5C]">{f.label}</p>{f.hint && <p className="mt-1 text-xs text-slate-500">{f.hint}</p>}</div>)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Esteira</p><p className="mt-2 text-sm font-semibold text-[#0F4C5C]">{current.estrategia?.trim() ?? '—'}</p></div>
        <div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Persona</p><p className="mt-2 text-sm font-semibold text-[#0F4C5C]">{current.persona?.trim() ?? '—'}</p></div>
        <div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ação de hoje</p><p className="mt-2 text-sm font-semibold text-[#0F4C5C]">{current.acao_hoje?.trim() ? <span>{current.acao_hoje}{String(current.acao_hoje).toLowerCase().includes('reserva') ? <span className="ml-1 text-xs text-slate-400">(reserva)</span> : null}</span> : '—'}</p></div>
        <div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Passo</p><p className="mt-2 text-sm font-semibold text-[#0F4C5C]">{current.passo_hoje?.trim() ?? '—'}</p></div>
      </div>{current.reenriquecer && <div className="mt-5 flex items-center gap-2 rounded-lg bg-[#fff7e8] p-4 text-sm text-[#80520f]"><AlertTriangle size={18}/> Reenriquecimento: {String(current.reenriquecer)}</div>}</section>
    {idVoz && <LigacoesAgenteVirtual idCliente={idVoz} credorId={card.credorId} />}
    <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8"><div className="mb-6 flex items-center gap-3"><History size={20} className="text-[#0F4C5C]"/><h2 className="text-lg font-semibold">Linha do tempo da trilha</h2></div>{history.length ? <div className="border-l-2 border-[#dce8e9] pl-6">{history.map((row,i) => { const tag = String(row.tag ?? row.TAG ?? ''); const green = tag.includes('CPA'); const gold = ['COL','PRE','LIQ'].some(x => tag.includes(x)); return <div key={row.id ?? i} className="relative pb-7 last:pb-0"><span className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${green ? 'bg-[#2E7D32]' : gold ? 'bg-[#e9a23b]' : 'bg-[#0F4C5C]'}`}/><p className="text-xs text-slate-500">{dateBR(row.data)}</p><div className="mt-2 flex flex-wrap items-center gap-2"><code title={tag} className={`rounded px-2 py-1 text-xs font-bold ${green ? 'bg-green-50 text-[#2E7D32]' : gold ? 'bg-amber-50 text-[#9a631b]' : 'bg-[#eaf2f3] text-[#0F4C5C]'}`}>{tagToPhrase(tag)}</code><span className="text-sm">{row.motivo || 'Sem motivo informado'}</span></div><p className="mt-2 text-xs text-slate-400">Quem marcou: {row.quem_marcou ?? row.marcado_por ?? '—'}</p></div>; })}</div> : <Empty>Não há registros na trilha deste cliente.</Empty>}</section>
  </div>;
}
