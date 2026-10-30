import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { X, Plus, Trash2 } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase, type Cluster, type Condicao, type Row } from '@/lib/supabase';
import { ErrorDetail } from '@/components/error-detail';

export type Coluna = { nome: string; tipo: 'numero' | 'texto' };
const calculados: Coluna[] = [
  { nome: 'saldo', tipo: 'numero' }, { nome: 'dias_atraso', tipo: 'numero' }, { nome: 'qtd_contratos', tipo: 'numero' },
  { nome: 'idade', tipo: 'numero' }, { nome: 'qtd_telefones', tipo: 'numero' },
  { nome: 'tem_email', tipo: 'texto' }, { nome: 'tem_celular', tipo: 'texto' }, { nome: 'so_fixo', tipo: 'texto' },
];
const calculadoLabel: Record<string, string> = { saldo: 'Saldo total', dias_atraso: 'Dias de atraso', qtd_contratos: 'Quantidade de contratos', idade: 'Idade (anos)', qtd_telefones: 'Qtd. de telefones', tem_email: 'Tem e-mail', tem_celular: 'Tem celular', so_fixo: 'Só fixo' };
const ops = [
  { id: '=', label: 'é igual a', num: true, txt: true },
  { id: '!=', label: 'é diferente de', num: true, txt: true },
  { id: '>', label: 'maior que', num: true, txt: false },
  { id: '>=', label: 'maior ou igual', num: true, txt: false },
  { id: '<', label: 'menor que', num: true, txt: false },
  { id: '<=', label: 'menor ou igual', num: true, txt: false },
  { id: 'em', label: 'está entre', num: true, txt: true },
  { id: 'nao_em', label: 'não está entre', num: true, txt: true },
  { id: 'contem', label: 'contém', num: false, txt: true },
  { id: 'vazio', label: 'está vazio', num: true, txt: true },
  { id: 'preenchido', label: 'está preenchido', num: true, txt: true },
];
const canalOpts = [
  { id: 'whatsapp', label: 'WhatsApp' }, { id: 'rcs', label: 'RCS' }, { id: 'agente_voz', label: 'Agente virtual' },
  { id: 'discador', label: 'Discador' }, { id: 'sms', label: 'SMS' }, { id: 'email', label: 'E-mail' },
];
const pacoteSugestoes = ['básico', 'básico + WhatsApp válido', 'completo', 'completo + novos telefones', 'completo + localizador'];

function fieldTipo(campo: string, colunas: Coluna[]): 'numero' | 'texto' {
  const all = [...calculados, ...colunas];
  return all.find(c => c.nome === campo)?.tipo ?? 'texto';
}
function opsFor(tipo: 'numero' | 'texto') {
  return ops.filter(o => tipo === 'numero' ? o.num : o.txt).sort((a, b) => (tipo === 'numero' ? 0 : 0));
}

export function ClusterForm({ cluster, colunas, maxOrdem, credorId, criarVinculoCredor, usadoEmCarteiras, onClose, onSaved }: { cluster: Cluster | null; colunas: Coluna[]; maxOrdem: number; credorId?: string; criarVinculoCredor?: boolean; usadoEmCarteiras?: number; onClose: () => void; onSaved: () => void }) {
  const { perfil, empresa } = useMotorAuth();
  const [codigo, setCodigo] = useState(cluster?.codigo ?? '');
  const [nome, setNome] = useState(cluster?.nome ?? '');
  const [estrategiaId, setEstrategiaId] = useState<string>(cluster?.estrategia_id ?? '');
  const [estrategias, setEstrategias] = useState<{ id: string; nome: string }[]>([]);
  const [condicoes, setCondicoes] = useState<Condicao[]>(cluster?.condicoes ?? []);
  const [pacote, setPacote] = useState(cluster?.pacote ?? '');
  const [revalida, setRevalida] = useState(String(cluster?.revalida_dias ?? 90));
  const [soDigital, setSoDigital] = useState(cluster?.so_digital ?? false);
  const [vozD0, setVozD0] = useState(cluster?.voz_d0 ?? false);
  const [bloqueados, setBloqueados] = useState<string[]>(cluster?.canais_bloqueados ?? []);
  const [todosCredores, setTodosCredores] = useState<boolean>(!cluster?.credor_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canDelete = !!cluster && (perfil?.papel === 'admin' || perfil?.papel === 'planejamento');
  const [delOpen, setDelOpen] = useState(false);
  const [delLoading, setDelLoading] = useState(false);
  const [delCarteiras, setDelCarteiras] = useState('');
  const [delClientes, setDelClientes] = useState(0);
  const [delConfirmado, setDelConfirmado] = useState(false);
  const [delError, setDelError] = useState('');
  const [delBusy, setDelBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !empresa) return;
    supabase.from('estrategias').select('id,nome').eq('empresa_id', empresa.id).order('nome').then(({ data }) => {
      setEstrategias((data ?? []) as { id: string; nome: string }[]);
    });
  }, [empresa?.id]);

  function addCond() { setCondicoes(prev => [...prev, { campo: 'saldo', op: '>=', valor: '' }]); }
  function updCond(i: number, patch: Partial<Condicao>) { setCondicoes(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c)); }
  function delCond(i: number) { setCondicoes(prev => prev.filter((_, idx) => idx !== i)); }

  async function submit() {
    if (!supabase || !empresa || !perfil) return;
    const code = codigo.toUpperCase().trim();
    if (!/^[A-Z0-9]{1,4}$/.test(code)) { setError('Use 1 a 4 letras ou números, sem hífen.'); return; }
    if (!nome.trim()) { setError('Informe o nome do cluster.'); return; }
    if (cluster && (usadoEmCarteiras ?? 0) > 1) {
      if (!window.confirm(`Este segmento é da empresa e está em ${usadoEmCarteiras} carteiras: mudar condições ou ordem muda em todas. Continuar?`)) return;
    }
    setBusy(true); setError('');
    const payload = {
      empresa_id: empresa.id, codigo: code, nome: nome.trim(),
      estrategia_id: estrategiaId || null,
      condicoes: condicoes as unknown as Record<string, unknown>[],
      pacote: pacote.trim() || null, revalida_dias: Number(revalida) || null,
      so_digital: soDigital, voz_d0: vozD0, canais_bloqueados: bloqueados,
      credor_id: criarVinculoCredor ? null : (todosCredores ? null : credorId),
      ativo: cluster?.ativo ?? true, atualizado_por: perfil.id,
      ...(cluster ? {} : { ordem: maxOrdem + 10 }),
    };
    try {
      const res = cluster
        ? await supabase.from('clusters').update(payload).eq('id', cluster.id).select('id').single()
        : await supabase.from('clusters').insert(payload).select('id').single();
      if (res.error) {
        const msg = (res.error.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('repetido') || msg.includes('unic') || msg.includes('unique')) setError('Já existe um cluster com este código.');
        else if (msg.includes('estrategia') || msg.includes('outra empresa') || msg.includes('foreign')) setError('Escolha uma estratégia desta empresa.');
        else if (msg.includes('inválido') || msg.includes('invalid') || msg.includes('check') || msg.includes('codigo')) setError('Use 1 a 4 letras ou números, sem hífen.');
        else setError(friendlyError());
        setBusy(false); return;
      }
      // novo segmento na Orquestração: vincula ao credor do topo
      if (!cluster && criarVinculoCredor && credorId && res.data?.id) {
        await supabase.from('segmentos_carteira').upsert(
          { empresa_id: empresa.id, cluster_id: res.data.id, credor_id: credorId, ativo: true },
          { onConflict: 'cluster_id,credor_id' },
        );
      }
      onSaved();
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  }

  const semColunas = colunas.length === 0;

  async function abrirExcluir() {
    if (!supabase || !cluster) return;
    setDelOpen(true); setDelLoading(true); setDelError(''); setDelConfirmado(false);
    try {
      const [sc, eq] = await Promise.all([
        supabase.from('segmentos_carteira').select('credor_id').eq('cluster_id', cluster.id).eq('ativo', true),
        supabase.from('enquadramento').select('clientes').eq('cluster', cluster.codigo).eq('na_carga', true),
      ]);
      const credIds = (sc.data ?? []).map((r: Row) => r.credor_id as string);
      let cart = 'Não está em nenhuma carteira';
      if (credIds.length) {
        const { data: creds } = await supabase.from('credores').select('id,nome').in('id', credIds);
        cart = (creds ?? []).map((c: Row) => c.nome as string).join(', ') || 'Não está em nenhuma carteira';
      }
      setDelCarteiras(cart);
      setDelClientes((eq.data ?? []).reduce((s: number, r: Row) => s + (Number(r.clientes) || 0), 0));
    } catch { setDelError(friendlyError()); }
    setDelLoading(false);
  }

  async function confirmarExcluir() {
    if (!supabase || !cluster) return;
    setDelBusy(true); setDelError('');
    const { error } = await supabase.from('clusters').delete().eq('id', cluster.id);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('permission') || msg.includes('policy') || msg.includes('rls') || msg.includes('denied')) setDelError('Só administração e planejamento podem excluir segmentos.');
      else setDelError(friendlyError());
      setDelBusy(false); return;
    }
    toast.success('Segmento excluído · os clientes são reenquadrados em até 1 minuto');
    setDelOpen(false);
    onSaved();
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Cluster" className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl sm:p-8" onClick={e => e.stopPropagation()}>
      <div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-semibold">{cluster ? 'Editar cluster' : 'Novo cluster'}</h2><button onClick={onClose} aria-label="Fechar" className="text-xl"><X size={20}/></button></div>
      <div className="space-y-5">
        {cluster && (usadoEmCarteiras ?? 0) > 1 && (
          <p className="rounded-lg bg-[#fff7e8] px-4 py-3 text-xs leading-relaxed text-[#80520f]">Este segmento é da empresa e está em <strong>{usadoEmCarteiras} carteiras</strong>: mudar condições ou ordem muda em todas.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="mb-2 block text-xs font-semibold">Código</label><input value={codigo} onChange={e => setCodigo(e.target.value.toUpperCase())} maxLength={4} placeholder="Ex. VEIC" className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm uppercase outline-none focus:border-[#0F4C5C]"/></div>
          <div><label className="mb-2 block text-xs font-semibold">Nome</label><input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do cluster" className="h-11 w-full rounded-lg border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
        </div>

        <div><label className="mb-2 block text-xs font-semibold">Estratégia</label><select value={estrategiaId} onChange={e => setEstrategiaId(e.target.value)} className="h-11 w-full rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]"><option value="">Padrão da empresa</option>{estrategias.map(es => <option key={es.id} value={es.id}>{es.nome}</option>)}</select><p className="mt-1 text-xs text-slate-400">Cluster sem estratégia segue a padrão da empresa; sem padrão, o padrão MotorCX.</p></div>

        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={todosCredores} onChange={e => setTodosCredores(e.target.checked)} className="accent-[#0F4C5C]"/> Valer para todos os credores da empresa</label>

        <div>
          <div className="mb-2 flex items-center justify-between"><label className="text-xs font-semibold">Condições (todas precisam bater)</label><button type="button" onClick={addCond} className="flex items-center gap-1 text-xs font-bold text-[#0F4C5C] hover:underline"><Plus size={14}/> condição</button></div>
          {semColunas && <p className="mb-3 rounded-lg bg-[#fff7e8] p-3 text-xs text-[#80520f]">Envie a primeira base bruta para liberar as colunas da empresa. Enquanto isso, digite o nome da coluna.</p>}
          {condicoes.length === 0 && <p className="text-xs text-slate-400">Nenhuma condição — vale para todos os clientes.</p>}
          <div className="space-y-2">{condicoes.map((c, i) => {
            const tipo = fieldTipo(c.campo, colunas); const opsList = opsFor(tipo); const noValor = c.op === 'vazio' || c.op === 'preenchido'; const isLista = c.op === 'em' || c.op === 'nao_em';
            return <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-2">
              {semColunas ? <input value={c.campo} onChange={e => updCond(i, { campo: e.target.value })} placeholder="Nome da coluna" className="h-9 w-[150px] rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/>
                : <select value={c.campo} onChange={e => updCond(i, { campo: e.target.value })} className="h-9 w-[170px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">
                  <optgroup label="Calculados">{calculados.map(co => <option key={co.nome} value={co.nome}>{calculadoLabel[co.nome]}</option>)}</optgroup>
                  {colunas.length > 0 && <optgroup label="Colunas da base">{colunas.map(co => <option key={co.nome} value={co.nome}>{co.nome}</option>)}</optgroup>}
                </select>}
              <select value={c.op} onChange={e => updCond(i, { op: e.target.value })} className="h-9 w-[150px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">{opsList.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
              {!noValor && (isLista
                ? <input value={Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor ?? '')} onChange={e => updCond(i, { valor: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="valores separados por vírgula" className="h-9 min-w-[180px] flex-1 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/>
                : <input value={Array.isArray(c.valor) ? c.valor.join(', ') : String(c.valor ?? '')} onChange={e => updCond(i, { valor: e.target.value })} placeholder="valor" className="h-9 min-w-[120px] flex-1 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C]"/>)}
              <button type="button" onClick={() => delCond(i)} aria-label="Remover condição" className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]"><Trash2 size={15}/></button>
            </div>;
          })}</div>
        </div>

        <div className="rounded-lg border border-[#e2eaec] p-4">
          <p className="mb-3 text-xs font-semibold">O que muda</p>
          <div className="space-y-4">
            <div><label className="mb-1 block text-xs font-medium text-slate-600">Pacote de enriquecimento</label><input list="pacotes" value={pacote} onChange={e => setPacote(e.target.value)} placeholder="básico, completo..." className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/><datalist id="pacotes">{pacoteSugestoes.map(p => <option key={p} value={p}/>)}</datalist></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1 block text-xs font-medium text-slate-600">Revalidar contatos a cada N dias</label><input type="number" min={1} value={revalida} onChange={e => setRevalida(e.target.value)} className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]"/></div>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={soDigital} onChange={e => setSoDigital(e.target.checked)} className="accent-[#0F4C5C]"/> Só digital (sem agente virtual e discador)</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={vozD0} onChange={e => setVozD0(e.target.checked)} className="accent-[#0F4C5C]"/> Voz no D0 do preventivo</label>
            </div>
            <div><p className="mb-2 text-xs font-medium text-slate-600">Canais bloqueados</p><div className="flex flex-wrap gap-4">{canalOpts.map(c => <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={bloqueados.includes(c.id)} onChange={e => setBloqueados(prev => e.target.checked ? [...prev, c.id] : prev.filter(x => x !== c.id))} className="accent-[#0F4C5C]"/> {c.label}</label>)}</div></div>
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-[#C62828]">{error}</p>}
        {error && <ErrorDetail/>}
        <div className="flex items-center justify-between gap-3">
          {canDelete ? <button type="button" onClick={() => void abrirExcluir()} className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#C62828] hover:bg-red-50"><Trash2 size={15}/> Excluir segmento</button> : <span/>}
          <div className="flex gap-3"><button onClick={onClose} className="h-11 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button><button onClick={submit} disabled={busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar cluster'}</button></div>
        </div>
      </div>
    </div>
    {delOpen && cluster && (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-[#102e38]/60 p-4" onClick={() => { if (!delBusy) setDelOpen(false); }}>
        <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-semibold">Excluir o segmento {cluster.codigo} · {cluster.nome}?</h2>
          {delLoading ? <p className="mt-3 text-sm text-slate-500">Carregando…</p> : <>
            <p className="mt-3 text-sm text-slate-600">Usado em: <strong>{delCarteiras}</strong></p>
            <p className="mt-1 text-sm text-slate-600">{delClientes} cliente(s) estão nele hoje.</p>
            <p className="mt-3 rounded-lg bg-[#fff7e8] p-3 text-xs text-[#80520f]">Esses clientes vão para o próximo segmento em uso que combinar com eles, ou para Demais clientes. A esteira NÃO é apagada (continua em Estratégias).</p>
            {delClientes > 0 && <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={delConfirmado} onChange={e => setDelConfirmado(e.target.checked)} className="accent-[#C62828]"/> Entendi que os clientes serão reenquadrados</label>}
            {delError && <p role="alert" className="mt-3 text-sm text-[#C62828]">{delError}</p>}
            {delError && <ErrorDetail/>}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setDelOpen(false)} disabled={delBusy} className="h-10 rounded-lg border border-[#c9dadd] px-5 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
              <button onClick={() => void confirmarExcluir()} disabled={delBusy || (delClientes > 0 && !delConfirmado)} className="h-10 rounded-lg bg-[#C62828] px-5 text-sm font-semibold text-white disabled:opacity-50">{delBusy ? 'Excluindo…' : 'Excluir segmento'}</button>
            </div>
          </>}
        </div>
      </div>
    )}
  </div>;
}
