import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Landmark, Plus, Pencil, Settings, X, Copy, Check } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading, useAllowed, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { dateBR, friendlyError, numberBR, slugify, supabase, type Credor, type Row } from '@/lib/supabase';
import { EstrategiasEmpresa } from '@/components/credores/estrategias-empresa';

type Estrategia = { id: string; nome: string; padrao: boolean; frente?: string };

function CopyCode({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* ignora */ } }
  return (
    <button onClick={copy} className="inline-flex items-center gap-1 rounded-full bg-[#eaf2f3] px-2 py-0.5 font-mono text-[11px] text-[#0F4C5C] hover:bg-[#edf4f5]" title="Copiar código" aria-label={`Copiar código ${value}`}>
      {ok ? <Check size={11} /> : <Copy size={11} />} {value}
    </button>
  );
}

export function Credores() {
  const { empresa, selectCredorRecord, refreshCredores } = useMotorAuth();
  const navigate = useNavigate();
  const canEdit = useAllowed(['admin', 'planejamento']);
  const [lista, setLista] = useState<Credor[]>([]);
  const [estrategias, setEstrategias] = useState<Estrategia[]>([]);
  const [runs, setRuns] = useState<Record<string, Row>>({});
  const [pendMap, setPendMap] = useState<Record<string, number>>({});
  const [pendCod, setPendCod] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Credor | null>(null);

  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [codigoTouched, setCodigoTouched] = useState(false);
  const [estrategiaId, setEstrategiaId] = useState('');
  const [entradaCarga, setEntradaCarga] = useState<'arquivo' | 'api'>('arquivo');
  const [formError, setFormError] = useState('');

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true); setError('');
    const [c, e, r, pm, po] = await Promise.all([
      supabase.from('credores').select('*').eq('empresa_id', empresa.id).order('nome'),
      supabase.from('estrategias').select('id,nome,padrao,frente').eq('empresa_id', empresa.id).order('nome'),
      supabase.from('ultima_execucao').select('credor_id,resumo').eq('empresa_id', empresa.id),
      supabase.from('mapeamento_arquivos').select('credor_id').eq('empresa_id', empresa.id).eq('confirmado', false),
      supabase.from('ocorrencia_codigos').select('credor_id').eq('empresa_id', empresa.id).eq('mapeado', false),
    ]);
    if (c.error || e.error || r.error || pm.error || po.error) { setError(friendlyError()); setLoading(false); return; }
    setLista((c.data ?? []) as Credor[]);
    setEstrategias((e.data ?? []) as Estrategia[]);
    const map: Record<string, Row> = {};
    (r.data ?? []).forEach((row: Row) => { if (row.credor_id) map[row.credor_id as string] = row; });
    setRuns(map);
    const pendM: Record<string, number> = {};
    const pendO: Record<string, number> = {};
    (pm.data ?? []).forEach((row: Row) => { const cid = row.credor_id as string; if (cid) pendM[cid] = (pendM[cid] ?? 0) + 1; });
    (po.data ?? []).forEach((row: Row) => { const cid = row.credor_id as string; if (cid) pendO[cid] = (pendO[cid] ?? 0) + 1; });
    setPendMap(pendM);
    setPendCod(pendO);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  function openNew() { setEditing(null); setNome(''); setCodigo(''); setCodigoTouched(false); setEstrategiaId(''); setEntradaCarga('arquivo'); setFormError(''); setFormOpen(true); }
  function openEdit(c: Credor) { setEditing(c); setNome(c.nome); setCodigo(c.codigo); setCodigoTouched(true); setEstrategiaId(c.estrategia_id ?? ''); setEntradaCarga(c.entrada_carga ?? 'arquivo'); setFormError(''); setFormOpen(true); }

  async function submit() {
    if (!supabase || !empresa) return;
    setFormError('');
    if (nome.trim().length < 2) { setFormError('Informe o nome do credor.'); return; }
    if (editing) {
      setBusy(editing.id);
      const { error } = await supabase.from('credores').update({ nome: nome.trim(), estrategia_id: estrategiaId || null, entrada_carga: entradaCarga, ativo: editing.ativo }).eq('id', editing.id);
      if (error) setFormError(friendlyError()); else { setSuccess('Carteira atualizada com sucesso.'); setFormOpen(false); void reload(); void refreshCredores(); }
      setBusy(''); return;
    }
    const code = codigo.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(code)) { setFormError('Código: 2 a 40 caracteres, só a-z, 0-9 e hífen.'); return; }
    setBusy('new');
    const { data: created, error } = await supabase.from('credores').insert({ empresa_id: empresa.id, nome: nome.trim(), codigo: code, estrategia_id: estrategiaId || null, entrada_carga: entradaCarga, ativo: true }).select().single();
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('repetido')) setFormError('Já existe um credor com este código.');
      else setFormError(friendlyError());
      setBusy(''); return;
    }
    setSuccess('Carteira criada com sucesso.'); setFormOpen(false); void reload(); await refreshCredores(); setBusy('');
    const novo = created as Credor | null;
    if (novo && window.confirm(`Selecionar "${novo.nome}" agora e abrir as configurações?`)) {
      selectCredorRecord(novo);
      navigate(`/credores/${code}/configuracoes`);
    }
  }

  async function toggleAtivo(c: Credor) {
    if (!supabase) return;
    setBusy(c.id);
    const { error } = await supabase.from('credores').update({ ativo: !c.ativo }).eq('id', c.id);
    if (error) setError(friendlyError()); else { setSuccess('Alteração salva com sucesso.'); void reload(); void refreshCredores(); }
    setBusy('');
  }

  const estrMotorcob = estrategias.filter(e => e.frente !== 'motorcli');
  const padraoMotorcob = estrMotorcob.find(e => e.padrao) ?? null;
  const estrNome = (id: string | null) => id ? (estrategias.find(e => e.id === id)?.nome ?? '—') : `Padrão da empresa${padraoMotorcob ? ` (${padraoMotorcob.nome})` : ''}`;

  return <>
    <PageHeading eyebrow="CONFIGURAÇÃO / CARTEIRAS" title="Carteiras" description="Cadastre e gerencie as carteiras da empresa. Cada carteira tem a sua estratégia, a sua lista do dia e os seus números." actions={canEdit && empresa ? <button onClick={openNew} className="flex h-11 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white"><Plus size={16}/> Nova carteira</button> : null}/>
    <div className="mb-6 rounded-xl border border-[#d9e5e8] bg-[#eaf2f3] p-5 text-sm text-[#315d68]"><p>Cada carteira é um conjunto de contratos dentro da empresa. Todo arquivo enviado pertence a uma carteira, e a estratégia, a lista do dia e os números são por carteira. Uma carteira que sai fica com “Em cobrança” desligado — ninguém apaga carteira.</p></div>
    {error && <div className="mb-5"><Notice>{error}</Notice></div>}
    {success && <div className="mb-5"><Notice variant="success">{success}</Notice></div>}
    {!empresa ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice> : loading ? <Loading/> : lista.length === 0 ? <Empty>Nenhuma carteira cadastrada para esta empresa. {canEdit && 'Crie a primeira carteira.'}</Empty> :
      <section className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8">
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead><tr className="border-b border-[#e4ebed] text-xs text-slate-400"><th className="pb-4 font-medium">Carteira</th><th className="pb-4 font-medium">Estratégia padrão</th><th className="pb-4 font-medium">Em cobrança</th><th className="pb-4 font-medium">Criado em</th><th className="pb-4 font-medium">Última rotina</th><th className="pb-4 font-medium">Configurações</th>{canEdit && <th className="pb-4"></th>}</tr></thead>
          <tbody className="divide-y divide-[#e9eff0]">{lista.map(c => { const run = runs[c.id]; const cart = (run?.resumo?.carteira ?? {}) as Row; const pend = (pendMap[c.id] ?? 0) + (pendCod[c.id] ?? 0); const pendTab = pendMap[c.id] ? 'arquivos' : 'ocorrencias'; return <tr key={c.id} className="hover:bg-[#f6fafb]"><td className="py-4"><div className="flex items-center gap-2"><Landmark size={16} className="text-[#0F4C5C]"/><span className="font-semibold">{c.nome}</span><CopyCode value={c.codigo} /><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.entrada_carga === 'api' ? 'bg-[#0A60D0] text-white' : 'bg-[#eaf2f3] text-[#0F4C5C]'}`}>{c.entrada_carga === 'api' ? 'API' : 'Arquivo'}</span>{pend > 0 && <Link to={`/credores/${c.codigo}/configuracoes?tab=${pendTab}`} className="rounded-full bg-[#e9a23b] px-2 py-0.5 text-[10px] font-bold text-white hover:bg-[#d8922c]">{pend} pendência{pend > 1 ? 's' : ''}</Link>}</div></td><td className="py-4">{estrNome(c.estrategia_id)}</td><td className="py-4"><button role="switch" aria-label={`Em cobrança ${c.nome}`} aria-checked={c.ativo} disabled={!canEdit || !!busy} onClick={() => toggleAtivo(c)} className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${c.ativo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${c.ativo ? 'left-6' : 'left-1'}`}/></button></td><td className="py-4 text-slate-500">{dateBR(c.criado_em)}</td><td className="py-4">{run ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>Em cobrança: <strong className="text-[#0F4C5C]">{numberBR(cart.em_cobranca)}</strong></span><span>Retirados: <strong className="text-[#0F4C5C]">{numberBR(cart.retirados)}</strong></span><span>Acordos abertos: <strong className="text-[#0F4C5C]">{numberBR(cart.acordos_abertos)}</strong></span><span>Quitados: <strong className="text-[#0F4C5C]">{numberBR(cart.quitados)}</strong></span></div> : <span className="text-xs text-slate-400">Sem rotina</span>}</td><td className="py-4 text-right"><Link to={`/credores/${c.codigo}/configuracoes`} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]"><Settings size={14}/> Configurações</Link></td>{canEdit && <td className="py-4 text-right"><button onClick={() => openEdit(c)} className="flex h-8 items-center gap-1.5 rounded border border-[#c9dadd] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]"><Pencil size={14}/> Editar</button></td>}</tr>; })}</tbody>
        </table></div>
      </section>}

    {formOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={() => setFormOpen(false)}><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{editing ? 'Editar carteira' : 'Nova carteira'}</h2><button onClick={() => setFormOpen(false)} aria-label="Fechar"><X size={20}/></button></div><div className="space-y-4"><div><label className="mb-2 block text-xs font-semibold">Nome</label><input value={nome} onChange={e => { setNome(e.target.value); if (!codigoTouched) setCodigo(slugify(e.target.value)); }} className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]" placeholder="Nome da carteira"/></div><div><label className="mb-2 block text-xs font-semibold">Código</label><input value={codigo} onChange={e => { setCodigoTouched(true); setCodigo(slugify(e.target.value)); }} disabled={!!editing} className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 font-mono text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]" placeholder="nome-da-carteira"/><p className="mt-1 text-xs text-slate-400">{editing ? 'O código não pode ser alterado depois de criado.' : 'Minúsculas, sem acento, espaços viram hífen. 2 a 40 caracteres.'}</p></div><div><label className="mb-2 block text-xs font-semibold">Estratégia padrão da carteira</label><select value={estrategiaId} onChange={e => setEstrategiaId(e.target.value)} className="h-11 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]"><option value="">Padrão da empresa</option>{estrMotorcob.map(es => <option key={es.id} value={es.id}>{es.nome}</option>)}</select><p className="mt-1 text-xs text-slate-400">Vale para os segmentos desta carteira sem estratégia própria e para Demais clientes. Sem ela, vale o padrão da empresa.</p></div>
<div>
  <label className="mb-2 block text-xs font-semibold">Como a carga chega</label>
  <div className="flex rounded-lg bg-[#f5f7f8] p-1">
    <button type="button" onClick={() => setEntradaCarga('arquivo')} className={`flex-1 rounded-md py-2 text-sm font-medium ${entradaCarga === 'arquivo' ? 'bg-white text-[#0F4C5C]' : 'text-slate-500'}`}>Arquivo</button>
    <button type="button" onClick={() => setEntradaCarga('api')} className={`flex-1 rounded-md py-2 text-sm font-medium ${entradaCarga === 'api' ? 'bg-white text-[#0F4C5C]' : 'text-slate-500'}`}>API</button>
  </div>
  {entradaCarga === 'arquivo'
    ? <p className="mt-1 text-xs text-slate-400">Envie pelo site, em Enviar arquivos. CSV, TXT ou XLSX.</p>
    : <><p className="mt-1 text-xs text-slate-400">O sistema da carteira manda direto pela API, com token. Mesmo relatório do arquivo.</p><div className="mt-2 rounded-lg bg-[#f5f7f8] px-3 py-2 text-xs text-slate-500">Envie pela API: <code className="font-mono text-[#0F4C5C]">POST /v1/cargas?credor={codigo || 'código-da-carteira'}</code> · <Link to="/docs/api" className="text-[#0F4C5C] underline">Ver a documentação</Link></div></>}
</div>{formError && <p role="alert" className="text-sm text-[#C62828]">{formError}</p>}<div className="flex justify-end gap-3"><button onClick={() => setFormOpen(false)} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button><button onClick={submit} disabled={!!busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando...' : editing ? 'Salvar' : 'Criar carteira'}</button></div></div></div></div>}
    {empresa && !loading && <EstrategiasEmpresa estrategias={estrategias} credores={lista} onReload={() => void reload()} />}
  </>;
}
