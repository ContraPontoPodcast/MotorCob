import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, numberBR, supabase, type Cluster, type Row } from '@/lib/supabase';
import { ClusterForm, type Coluna } from '@/components/clusters/cluster-form';

const calculadoLabel: Record<string, string> = { saldo: 'Saldo total', dias_atraso: 'Dias de atraso', qtd_contratos: 'Quantidade de contratos' };
const opPhrase: Record<string, string> = { '=': 'é', '!=': 'é diferente de', '>': '>', '>=': '≥', '<': '<', '<=': '≤', em: 'está entre', nao_em: 'não está entre', contem: 'contém', vazio: 'está vazio', preenchido: 'está preenchido' };
const canalLabel: Record<string, string> = { whatsapp: 'WhatsApp', rcs: 'RCS', agente_voz: 'Agente virtual', discador: 'Discador', sms: 'SMS', email: 'E-mail' };

function condFrase(c: Cluster, colunas: Coluna[]): string {
  if (!c.condicoes || c.condicoes.length === 0) return 'Sem condições (vale para todos)';
  const label = (campo: string) => calculadoLabel[campo] ?? campo;
  const valStr = (v: unknown) => Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return c.condicoes.map(cd => {
    const op = opPhrase[cd.op] ?? cd.op;
    if (cd.op === 'vazio' || cd.op === 'preenchido') return `${label(cd.campo)} ${op}`;
    return `${label(cd.campo)} ${op} ${valStr(cd.valor)}`;
  }).join(' e ');
}
function mudancas(c: Cluster): string[] {
  const out: string[] = [];
  if (c.pacote) out.push(`Pacote: ${c.pacote}`);
  if (c.revalida_dias) out.push(`Revalida contatos a cada ${c.revalida_dias} dias`);
  if (c.so_digital) out.push('Só digital');
  if (c.voz_d0) out.push('Voz no D0 do preventivo');
  if (c.canais_bloqueados?.length) out.push(`Canais bloqueados: ${c.canais_bloqueados.map(x => canalLabel[x] ?? x).join(', ')}`);
  return out;
}

export function Clusters() {
  const { perfil, empresa } = useMotorAuth();
  const canEdit = useAllowed(['admin', 'planejamento']);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [estrategias, setEstrategias] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<Cluster | null>(null);
  const [confirmDel, setConfirmDel] = useState<Cluster | null>(null); const [busy, setBusy] = useState('');

  async function reload() {
    if (!supabase || !empresa) return; setLoading(true); setError('');
    const [c, e, r] = await Promise.all([
      supabase.from('clusters').select('*').eq('empresa_id', empresa.id).order('ordem', { ascending: true }),
      supabase.from('empresas').select('colunas_base').eq('id', empresa.id).maybeSingle(),
      supabase.from('ultima_execucao').select('resumo').eq('empresa_id', empresa.id).limit(1).maybeSingle(),
    ]);
    if (c.error || e.error || r.error) { setError(friendlyError()); setLoading(false); return; }
    setClusters((c.data ?? []) as Cluster[]);
    const cb = (e.data as Row | null)?.colunas_base;
    setColunas(Array.isArray(cb?.colunas) ? cb.colunas : []);
    setResumo((r.data as Row | null)?.resumo?.clusters ?? null);
    // nomes das estratégias usadas pelos clusters
    const ids = ((c.data ?? []) as Cluster[]).map(cl => cl.estrategia_id).filter(Boolean) as string[];
    if (ids.length) {
      const { data: ests } = await supabase.from('estrategias').select('id,nome').in('id', ids);
      const map: Record<string, string> = {};
      (ests ?? []).forEach((x: Row) => { map[x.id as string] = x.nome as string; });
      setEstrategias(map);
    } else setEstrategias({});
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  async function toggleAtivo(cl: Cluster) { if (!supabase) return; setBusy(cl.id); const { error } = await supabase.from('clusters').update({ ativo: !cl.ativo, atualizado_por: perfil?.id }).eq('id', cl.id); if (error) setError(friendlyError()); else void reload(); setBusy(''); }
  async function move(index: number, dir: -1 | 1) { if (!supabase) return; const a = clusters[index]; const b = clusters[index + dir]; if (!a || !b) return; setBusy(`${a.id}|${b.id}`); const { error: e1 } = await supabase.from('clusters').update({ ordem: b.ordem }).eq('id', a.id); const { error: e2 } = await supabase.from('clusters').update({ ordem: a.ordem }).eq('id', b.id); if (e1 || e2) setError(friendlyError()); else void reload(); setBusy(''); }
  async function remove(cl: Cluster) { if (!supabase) return; setBusy(cl.id); const { error } = await supabase.from('clusters').delete().eq('id', cl.id); if (error) setError(friendlyError()); else { setConfirmDel(null); void reload(); } setBusy(''); }

  const maxOrdem = clusters.reduce((m, c) => Math.max(m, c.ordem), 0);
  const resumoEntries = resumo ? Object.entries(resumo) : [];
  const resumoMax = Math.max(...resumoEntries.map(([, v]) => Number(v) || 0), 1);

  return <><PageHeading eyebrow="CONFIGURAÇÃO / SEGMENTAÇÃO" title="Segmentos" description="Defina os grupos de clientes da empresa e o que muda na operação de cada um." actions={canEdit && empresa ? <button onClick={() => { setEditing(null); setFormOpen(true); }} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white"><Plus size={16}/> Novo segmento</button> : null}/>
    <div className="mb-6 rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]"><p>Vale o primeiro cluster da lista cujas condições batem todas. Quem não bate em nenhum fica no cluster padrão (ticket × atraso: A1…B3). Mudanças valem a partir da rotina do dia seguinte.</p></div>
    {!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : error ? <Notice>{error}</Notice> : loading ? <Loading/> : clusters.length === 0 ? <Empty>Nenhum cluster cadastrado para esta empresa. {canEdit && 'Crie o primeiro cluster.'}</Empty> : <div className="space-y-4">{clusters.map((c, i) => <section key={c.id} className="rounded-xl border border-[#dfe8ea] bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3"><span className="rounded-md bg-[#0F4C5C] px-2.5 py-1 text-xs font-bold text-white">{c.codigo}</span><h2 className="text-lg font-semibold">{c.nome}</h2>{!c.ativo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">Inativo</span>}</div>
        <div className="flex items-center gap-2">
          {canEdit && <><button onClick={() => move(i, -1)} disabled={i === 0 || !!busy} aria-label="Subir" className="grid h-8 w-8 place-items-center rounded border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40"><ArrowUp size={15}/></button><button onClick={() => move(i, 1)} disabled={i === clusters.length - 1 || !!busy} aria-label="Descer" className="grid h-8 w-8 place-items-center rounded border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40"><ArrowDown size={15}/></button><button onClick={() => { setEditing(c); setFormOpen(true); }} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]"><Pencil size={14}/> Editar</button><button onClick={() => setConfirmDel(c)} className="grid h-8 w-8 place-items-center rounded border border-[#c9dadd] text-slate-400 hover:bg-red-50 hover:text-[#C62828]"><Trash2 size={15}/></button></>}
          <button role="switch" aria-label={`Ativar ${c.nome}`} aria-checked={c.ativo} disabled={!!busy || !canEdit} onClick={() => toggleAtivo(c)} className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${c.ativo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${c.ativo ? 'left-6' : 'left-1'}`}/></button>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-600">{condFrase(c, colunas)}</p>
      <p className="mt-2 text-xs text-slate-500">Estratégia: <strong className="text-[#0F4C5C]">{c.estrategia_id ? (estrategias[c.estrategia_id] ?? '—') : 'Padrão da empresa'}</strong></p>
      {mudancas(c).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{mudancas(c).map((m, idx) => <span key={idx} className="rounded-full bg-[#eaf2f3] px-3 py-1 text-xs font-medium text-[#0F4C5C]">{m}</span>)}</div>}
    </section>)}</div>}

    <section className="mt-8 rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8"><div className="mb-5 flex items-center gap-3"><Layers size={19} className="text-[#0F4C5C]"/><h2 className="text-lg font-semibold">Clientes por cluster na última rotina</h2></div>{resumoEntries.length ? <div className="space-y-3">{resumoEntries.map(([code, qty]) => <div key={code} className="grid grid-cols-[90px_1fr_70px] items-center gap-3 text-xs"><span className="font-bold text-[#0F4C5C]">{code}</span><div className="h-2.5 overflow-hidden rounded-full bg-[#eef2f3]"><div className="h-full rounded-full bg-[#0F4C5C]" style={{ width: `${(Number(qty) / resumoMax) * 100}%` }}/></div><span className="text-right font-semibold">{numberBR(qty)}</span></div>)}</div> : <Empty>Sem dados de clusters na última rotina.</Empty>}</section>

    {formOpen && empresa && <ClusterForm cluster={editing} colunas={colunas} maxOrdem={maxOrdem} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); void reload(); }} />}
    {confirmDel && <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={() => setConfirmDel(null)}><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}><h2 className="text-lg font-semibold">Excluir cluster</h2><p className="mt-2 text-sm text-slate-600">Tem certeza que deseja excluir o cluster <strong>{confirmDel.codigo} — {confirmDel.nome}</strong>? Esta ação não pode ser desfeita.</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setConfirmDel(null)} className="h-10 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button><button onClick={() => void remove(confirmDel)} disabled={!!busy} className="h-10 rounded-lg bg-[#C62828] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Excluindo...' : 'Excluir'}</button></div></div></div>}
  </>;
}
