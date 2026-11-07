import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Activity, BookOpen, Clock, Upload } from 'lucide-react';
import { Loading, Notice, PageHeading, useAllowed } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase, type Row } from '@/lib/supabase';
import { canalLabel } from '@/lib/estrategia';
import {
  canaisConfiguraveis as canalOpts, CONFLITO_CANAIS_EMPRESA, CONFLITO_CREDOR_CANAIS, lerCusto, linhasCarteira, linhasEmpresa,
  naoPerturbeParaTela, VOZ as vozChannels, type CanalTela, QUEM_ENVIA_CANAIS, quemEnviaTela,
} from '@/lib/canais-config';
import { canalTipoMensagem } from '@/lib/frases';
import { numerosPorClienteOpts } from '@/lib/operacao';
import { FrasesTab } from '@/components/canais/frases';
import { ImportarPlaybookModal } from '@/components/canais/importar-playbook';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
type CanalRow = CanalTela;

const defaults: Record<string, CanalRow> = Object.fromEntries(
  canalOpts.map(c => [c.id, {
    canal: c.id, ativo: true, janela_inicio: '08:00', janela_fim: '20:00',
    sabado: true, capacidade_dia: null, custo: null,
    tentativas_dia: c.id === 'agente_voz' || c.id === 'discador' ? 3 : null,
    respeitar_nao_perturbe: null,
    numeros_por_cliente: null,
    produto_padrao: null,
  }]),
);

/** Indicador de herança no modo carteira. */
function Heranca({ sobrescrito, onVoltar }: { sobrescrito: boolean; onVoltar: () => void }) {
  if (!sobrescrito) return <p className="mt-1 text-[11px] text-[#8E8E93]">da empresa</p>;
  return (
    <p className="mt-1 text-[11px] text-[#1D1D1F]">
      desta carteira · <button type="button" onClick={onVoltar} className="text-[#0A60D0] hover:underline">voltar ao da empresa</button>
    </p>
  );
}

export function Canais() {
  const { empresa, credores } = useMotorAuth();
  const areasLib = useAreasLiberadas();
  const canaisMensageria: string[] = areasLib.mensageria ? areasLib.canais : [];
  const canEdit = useAllowed(['admin', 'planejamento']);
  const [escopo, setEscopo] = useState<string>('empresa'); // 'empresa' | credor_id
  const [rows, setRows] = useState<Record<string, CanalRow>>({});
  const [sobrescritos, setSobrescritos] = useState<Record<string, string[]>>({});
  const [carregados, setCarregados] = useState<Record<string, string[]>>({});
  const [custoTexto, setCustoTexto] = useState<Record<string, string>>({});
  const [produtosPorCanal, setProdutosPorCanal] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [tabs, setTabs] = useState<Record<string, 'config' | 'frases'>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const secaoFrases = searchParams.get('secao') === 'frases';

  const isCarteira = escopo !== 'empresa';

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true); setError('');
    if (escopo === 'empresa') {
      const { data, error } = await supabase.from('canais_empresa').select('*').eq('empresa_id', empresa.id);
      if (error) { setError(friendlyError(error)); setLoading(false); return; }
      const map: Record<string, CanalRow> = {};
      const custos: Record<string, string> = {};
      (data ?? []).forEach((r: Row) => {
        map[r.canal as string] = { ...(defaults[r.canal as string] ?? {}), ...r, respeitar_nao_perturbe: naoPerturbeParaTela(r.respeitar_nao_perturbe) } as CanalRow;
        if (r.custo != null) custos[r.canal as string] = Number(r.custo).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
      });
      setRows(map); setSobrescritos({}); setCarregados({}); setCustoTexto(custos);
    } else {
      const { data, error } = await supabase.from('canais_credor').select('*').eq('empresa_id', empresa.id).eq('credor_id', escopo);
      if (error) { setError(friendlyError(error)); setLoading(false); return; }
      const map: Record<string, CanalRow> = {};
      const sob: Record<string, string[]> = {};
      (data ?? []).forEach((r: Row) => {
        const canal = r.canal as string;
        map[canal] = { ...(defaults[canal] ?? {}), ...r, respeitar_nao_perturbe: naoPerturbeParaTela(r.respeitar_nao_perturbe) } as CanalRow;
        sob[canal] = Array.isArray(r.sobrescritos) ? (r.sobrescritos as string[]) : [];
      });
      setRows(map); setSobrescritos(sob); setCarregados(sob);
    }
    setLoading(false);
  }

  // Produtos liberados por canal (campo Produto padrão, só no modo carteira).
  useEffect(() => {
    const sb = supabase;
    if (!sb || !empresa || !isCarteira) { setProdutosPorCanal({}); return; }
    let active = true;
    (async () => {
      const map: Record<string, Row[]> = {};
      await Promise.all(canalOpts.map(async c => {
        const { data } = await sb.rpc('produtos_liberados', { empresa: empresa.id, canal: c.id });
        map[c.id] = (data ?? []) as Row[];
      }));
      if (active) setProdutosPorCanal(map);
    })();
    return () => { active = false; };
  }, [empresa?.id, isCarteira]);

  useEffect(() => { void reload(); }, [empresa?.id, escopo]);

  function patch(canal: string, p: Partial<CanalRow>) {
    setRows(prev => ({ ...prev, [canal]: { ...(prev[canal] ?? defaults[canal]), ...p } }));
    if (isCarteira) {
      setSobrescritos(prev => {
        const s = new Set(prev[canal] ?? []);
        Object.keys(p).forEach(k => s.add(k));
        return { ...prev, [canal]: [...s] };
      });
    }
  }
  function setTab(canal: string, tab: 'config' | 'frases') { setTabs(prev => ({ ...prev, [canal]: tab })); }

  function voltarEmpresa(canal: string, campo: string) {
    setSobrescritos(prev => ({ ...prev, [canal]: (prev[canal] ?? []).filter(k => k !== campo) }));
  }

  async function salvar() {
    if (!supabase || !empresa) return;
    setBusy(true); setError(''); setSuccess('');
    if (escopo === 'empresa') {
      const custos: Record<string, number | null> = {};
      for (const c of canalOpts) {
        const lido = lerCusto(custoTexto[c.id] ?? '');
        if ('erro' in lido) { setError(`${canalLabel[c.id]} · custo por ação: ${lido.erro}`); setBusy(false); return; }
        custos[c.id] = lido.valor;
      }
      const comCusto: Record<string, CanalRow> = Object.fromEntries(canalOpts.map(c => [c.id, { ...(rows[c.id] ?? defaults[c.id]), custo: custos[c.id] }]));
      const { error } = await supabase.from('canais_empresa').upsert(linhasEmpresa(empresa.id, comCusto, defaults), { onConflict: CONFLITO_CANAIS_EMPRESA });
      if (error) setError(friendlyError(error)); else { setSuccess('Configuração dos canais salva com sucesso.'); void reload(); }
    } else {
      const upserts = linhasCarteira(empresa.id, escopo, rows, defaults, sobrescritos, carregados);
      if (upserts.length === 0) { setSuccess('Nenhum ajuste desta carteira para salvar.'); setBusy(false); return; }
      const { error } = await supabase.from('credor_canais').upsert(upserts, { onConflict: CONFLITO_CREDOR_CANAIS });
      if (error) setError(friendlyError(error)); else { setSuccess('Ajustes da carteira salvos com sucesso.'); void reload(); }
    }
    setBusy(false);
  }

  if (!empresa) return <><PageHeading eyebrow="CONFIGURAÇÃO / OPERAÇÃO" title="Canais e mensagens" description="Ajuste horário, capacidade e custo de cada canal da empresa."/><Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
  if (loading) return <><PageHeading eyebrow="CONFIGURAÇÃO / OPERAÇÃO" title="Canais e mensagens" description="Ajuste horário, capacidade, custo e textos de cada canal da empresa."/><Loading/></>;

  return <>
    <PageHeading eyebrow="CONFIGURAÇÃO / OPERAÇÃO" title="Canais e mensagens" description="Ajuste horário, capacidade, custo e textos de cada canal da empresa." actions={canEdit ? <button onClick={() => setImportOpen(true)} className="flex h-11 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-sm font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Upload size={16}/> Importar playbook</button> : null} />

    {/* Seletor de escopo: Empresa (todas as carteiras) ou uma carteira. */}
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <label className="text-xs font-semibold text-slate-600">Aplicar a:</label>
      <select value={escopo} onChange={e => setEscopo(e.target.value)} className="h-9 rounded-lg border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C]">
        <option value="empresa">Empresa (todas as carteiras)</option>
        {credores.filter(cr => cr.ativo).map(cr => <option key={cr.id} value={cr.id}>{cr.nome}</option>)}
      </select>
      {isCarteira && <span className="rounded-full bg-[#eaf2f3] px-2.5 py-0.5 text-[11px] font-semibold text-[#0F4C5C]">carteira</span>}
    </div>

    <div className={`mb-6 rounded-xl border p-5 text-sm ${isCarteira ? 'border-[#d9e5e8] bg-[#eaf2f3] text-[#315d68]' : 'border-[#d9e5e8] bg-[#eaf2f3] text-[#315d68]'}`}>
      {isCarteira
        ? <p>Esta carteira herda os canais da empresa e pode sobrescrever campos. Campos em cinza “da empresa” vêm da empresa; “desta carteira” foram sobrescritos. Salvar grava só o que foi alterado.</p>
        : <p>Desligue um canal para que nenhuma estratégia o use. Os 6 canais aparecem sempre; ao salvar, gravamos o que estiver diferente do padrão. <strong>WhatsApp</strong> e <strong>RCS</strong> têm aba <strong>Modelos de mensagem</strong>; <strong>SMS</strong> e <strong>Agente virtual</strong> também. Discador e E-mail não usam mensagem.</p>}
    </div>
    {!isCarteira && <div className="mb-6 rounded-xl border border-[#e2eaec] bg-[#f7fafb] p-5 text-sm text-[#4a6770]"><p>As regras de retorno de cada canal (DLR, bounce, sem conta…) ficam em <Link to="/credores" className="font-semibold text-[#0F4C5C] underline">Carteiras</Link> → (carteira) → Configurações → Canais.</p></div>}
    {error && <div className="mb-5"><Notice>{error}</Notice></div>}
    {success && <div className="mb-5"><Notice variant="success">{success}</Notice></div>}

    <div className="grid gap-4 lg:grid-cols-2">
      {canalOpts.map(c => {
        const r = rows[c.id] ?? defaults[c.id];
        const sob = sobrescritos[c.id] ?? [];
        const tab = tabs[c.id] ?? (secaoFrases ? 'frases' : 'config');
        const temMensagem = canalTipoMensagem(c.id) !== 'nenhuma';
        const abaFrasesLabel = 'Modelos de mensagem';
        const tabEfetiva = temMensagem ? tab : 'config';
        const produtos = produtosPorCanal[c.id] ?? [];
        return (
          <section key={c.id} className={`rounded-xl border bg-white ${r.ativo ? 'border-[#dfe8ea]' : 'border-[#e5edef] opacity-80'}`}>
            <div className="flex items-center justify-between border-b border-[#ecf0f1] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-[#0F4C5C]"><Activity size={20}/></div>
                <h2 className="text-lg font-semibold">{canalLabel[c.id]}</h2>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-500">
                Ligado
                <button role="switch" aria-label={`Ligar ${c.label}`} aria-checked={r.ativo} disabled={!canEdit} onClick={() => patch(c.id, { ativo: !r.ativo })} className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${r.ativo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${r.ativo ? 'left-6' : 'left-1'}`}/></button>
              </label>
            </div>

            <div className="flex gap-1 border-b border-[#ecf0f1] px-4">
              <button onClick={() => setTab(c.id, 'config')} className={`-mb-px border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${tabEfetiva === 'config' ? 'border-[#0F4C5C] text-[#0F4C5C]' : 'border-transparent text-slate-400 hover:text-[#0F4C5C]'}`}>Configuração</button>
              {temMensagem && <button onClick={() => setTab(c.id, 'frases')} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${tabEfetiva === 'frases' ? 'border-[#0F4C5C] text-[#0F4C5C]' : 'border-transparent text-slate-400 hover:text-[#0F4C5C]'}`}><BookOpen size={13}/> {abaFrasesLabel}</button>}
              {c.id === 'agente_voz' && <Link to="/canais/agente-virtual" className="-mb-px border-b-2 border-transparent px-3 py-2.5 text-xs font-semibold text-slate-400 transition-colors hover:text-[#0F4C5C]">Fluxos</Link>}
            </div>

            {tabEfetiva === 'config' ? (
              <div className="space-y-4 p-6">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Clock size={13}/> Horário (seg–sex)</label>
                  <div className="flex items-center gap-2">
                    <input type="time" value={r.janela_inicio ?? ''} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { janela_inicio: e.target.value })} className="h-10 w-28 rounded border border-[#d8e3e5] px-2 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]"/>
                    <span className="text-slate-400">até</span>
                    <input type="time" value={r.janela_fim ?? ''} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { janela_fim: e.target.value })} className="h-10 w-28 rounded border border-[#d8e3e5] px-2 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]"/>
                  </div>
                  {isCarteira && <Heranca sobrescrito={sob.includes('janela_inicio') || sob.includes('janela_fim')} onVoltar={() => { voltarEmpresa(c.id, 'janela_inicio'); voltarEmpresa(c.id, 'janela_fim'); }} />}
                  {!isCarteira && <p className="mt-1 text-[11px] text-slate-400">Nunca passa do horário geral (seg–sex 08:00–20:00, sábado 08:00–14:00).</p>}
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={r.sabado} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { sabado: e.target.checked })} className="accent-[#0F4C5C]"/> Aciona no sábado</label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Capacidade por dia</label>
                    <input type="number" min={0} value={r.capacidade_dia ?? ''} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { capacidade_dia: e.target.value ? Number(e.target.value) : null })} placeholder="sem limite" className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]"/>
                    {isCarteira && <Heranca sobrescrito={sob.includes('capacidade_dia')} onVoltar={() => voltarEmpresa(c.id, 'capacidade_dia')} />}
                    {!isCarteira && <p className="mt-1 text-[11px] text-slate-400">Passou do limite, entram primeiro quebra/preventivo/CPC e, empatados, maior saldo.</p>}
                  </div>
                  {!isCarteira && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Custo por ação (R$)</label>
                      <input type="text" inputMode="decimal" value={custoTexto[c.id] ?? ''} disabled={!canEdit || !r.ativo} onChange={e => setCustoTexto(prev => ({ ...prev, [c.id]: e.target.value }))} placeholder="0,00" className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]"/>
                    </div>
                  )}
                </div>

                {vozChannels.has(c.id) && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Tentativas por dia</label>
                    <input type="number" min={1} value={r.tentativas_dia ?? 3} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { tentativas_dia: Number(e.target.value) })} className="h-10 w-28 rounded border border-[#d8e3e5] px-2 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]"/>
                    {isCarteira && <Heranca sobrescrito={sob.includes('tentativas_dia')} onVoltar={() => voltarEmpresa(c.id, 'tentativas_dia')} />}
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Respeitar Não Perturbe</label>
                  <select value={r.respeitar_nao_perturbe ?? ''} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { respeitar_nao_perturbe: naoPerturbeParaTela(e.target.value) })} className="h-10 w-full rounded border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]">
                    <option value="">Padrão (voz respeita, digitais não)</option>
                    <option value="sim">Sim</option>
                    <option value="nao">Não</option>
                  </select>
                  {isCarteira && <Heranca sobrescrito={sob.includes('respeitar_nao_perturbe')} onVoltar={() => voltarEmpresa(c.id, 'respeitar_nao_perturbe')} />}
                </div>

                {!isCarteira && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Números por cliente</label>
                    <select value={String(r.numeros_por_cliente ?? 1)} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { numeros_por_cliente: Number(e.target.value) })} className="h-10 w-full rounded border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]">
                      {numerosPorClienteOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                )}

                {!isCarteira && QUEM_ENVIA_CANAIS.has(c.id) && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Quem envia</label>
                    <select aria-label={`Quem envia o ${canalLabel[c.id]}`} value={quemEnviaTela(c.id, r.quem_envia, canaisMensageria)} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { quem_envia: e.target.value as 'lista' | 'motorcx' })} className="h-10 w-full rounded border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]">
                      <option value="lista">Lista para baixar (seu fornecedor envia)</option>
                      <option value="motorcx" disabled={!canaisMensageria.includes(c.id)}>MotorCX envia{canaisMensageria.includes(c.id) ? '' : ' (precisa da Mensageria)'}</option>
                    </select>
                    <p className="mt-1 text-[11px] text-[#8E8E93]">Desligado: use a chave do canal.</p>
                  </div>
                )}

                {isCarteira && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Produto padrão</label>
                    <select value={r.produto_padrao ?? ''} disabled={!canEdit || !r.ativo} onChange={e => patch(c.id, { produto_padrao: e.target.value || null })} className="h-10 w-full rounded border border-[#d8e3e5] bg-white px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f7f8]">
                      <option value="">Padrão do canal</option>
                      {produtos.map(p => <option key={String(p.codigo)} value={String(p.codigo)}>{String(p.nome)}</option>)}
                    </select>
                    <Heranca sobrescrito={sob.includes('produto_padrao')} onVoltar={() => voltarEmpresa(c.id, 'produto_padrao')} />
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6"><FrasesTab canal={c.id}/></div>
            )}
          </section>
        );
      })}
    </div>

    {canEdit && <div className="mt-6 flex justify-end"><button onClick={salvar} disabled={busy} className="h-11 rounded-lg bg-[#0F4C5C] px-6 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando...' : isCarteira ? 'Salvar ajustes da carteira' : 'Salvar canais'}</button></div>}
    {importOpen && <ImportarPlaybookModal onClose={() => setImportOpen(false)} onDone={() => { /* frases recarregam sozinhas por aba */ }}/>}
  </>;
}
