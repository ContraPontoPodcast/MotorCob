import { useEffect, useState, type ReactNode } from 'react';
import { Download, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, moneyBR, numberBR, type Row } from '@/lib/supabase';
import { CANAIS_MSG, mesExtenso, ultimosMeses, primeiroDiaMes } from '@/lib/empresa-helpers';
import { exportarCsv } from '@/lib/mensageria';
import { Info } from '@/components/glossario/info';
import { ConsoleShell, cardShadow } from './console-shell';
import { MargemIa } from './console-margem-ia';

const SIT_MARGEM: Record<string, { label: string; cor: string; bg: string }> = {
  ok: { label: 'OK', cor: '#248A3D', bg: '#E8F8EC' },
  abaixo_meta: { label: 'Abaixo da meta', cor: '#9a631b', bg: '#FFF3E8' },
  abaixo_minimo: { label: 'Abaixo do mínimo', cor: '#FF3B30', bg: '#FFE8E6' },
  sem_preco: { label: 'Sem preço', cor: '#8E8E93', bg: '#F5F5F7' },
  sem_receita: { label: 'Sem receita', cor: '#8E8E93', bg: '#F5F5F7' },
};

function pct1(v: unknown) { return `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }

function Kpi({ titulo, valor }: { titulo: ReactNode; valor: string }) {
  return <div className="rounded-2xl bg-[#F5F5F7] p-5"><p className="text-[13px] text-[#6E6E73]">{titulo}</p><p className="mt-1 text-[22px] font-bold tracking-tight tnum" style={{ color: 'var(--base-texto)' }}>{valor}</p></div>;
}

export function ConsoleMargemPage() {
  const [competencia, setCompetencia] = useState(primeiroDiaMes());
  const [modo, setModo] = useState<'real' | 'simulado'>('real');
  const [linhas, setLinhas] = useState<Row[]>([]);
  const [params, setParams] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detalhe, setDetalhe] = useState<Row | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [salvos, setSalvos] = useState(0);
  const meses = ultimosMeses(12);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setError('');
    const [mg, pm] = await Promise.all([
      supabase.rpc('margem_mensageria', { competencia, modo }),
      supabase.from('parametros_margem').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (mg.error) { setError(friendlyError(mg.error)); setLoading(false); return; }
    setLinhas((mg.data ?? []) as Row[]);
    setParams((pm.data as Row | null) ?? null);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [competencia, modo]);

  const totais = linhas.reduce((acc, l) => ({
    receita: acc.receita + Number(l.receita ?? 0),
    custo: acc.custo + Number(l.custo ?? 0),
    mc: acc.mc + Number(l.mc ?? 0),
    abaixo: acc.abaixo + (l.situacao === 'abaixo_minimo' ? 1 : 0),
  }), { receita: 0, custo: 0, mc: 0, abaixo: 0 });
  const pctGeral = totais.receita > 0 ? (totais.mc / totais.receita) * 100 : 0;
  const semCustoTotal = linhas.reduce((s, l) => s + Number(l.sem_custo ?? 0), 0);
  const ordenadas = [...linhas].sort((a, b) => Number(a.mc_pct ?? 0) - Number(b.mc_pct ?? 0));

  function exportar() {
    const cab = ['Empresa', 'Canal', 'Plano', 'Envios', 'Respostas', 'Receita', 'Custo', 'MC', '%MC', 'Situação'];
    const linhasCsv = ordenadas.map(l => [l.empresa ?? '', l.canal ?? '', l.plano ?? '', l.envios ?? 0, l.respostas ?? 0, l.receita ?? 0, l.custo ?? 0, l.mc ?? 0, l.mc_pct ?? 0, SIT_MARGEM[l.situacao as string]?.label ?? l.situacao ?? '']);
    exportarCsv(`margem-${competencia}.csv`, cab, linhasCsv);
  }

  return (
    <ConsoleShell>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      {modo === 'simulado' && <div className="mb-4 rounded-xl bg-[#FFF8E1] px-4 py-3 text-[14px] text-[#9a631b]">Números de simulação.</div>}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <select value={competencia} onChange={e => setCompetencia(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] text-[#1D1D1F] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
          {meses.map(m => <option key={m} value={m}>{mesExtenso(m)}</option>)}
        </select>
        <div className="inline-flex items-center gap-1 rounded-[10px] bg-[#F5F5F7] p-1">
          {(['real', 'simulado'] as const).map(m => <button key={m} onClick={() => setModo(m)} className={`rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${modo === m ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{m === 'real' ? 'Real' : 'Simulado'}</button>)}
        </div>
        <button onClick={() => setParamsOpen(true)} className="flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Pencil size={15} /> Parâmetros</button>
        <button onClick={exportar} className="ml-auto flex h-9 items-center gap-2 rounded-full border border-[#D2D2D7] px-4 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]"><Download size={15} /> Exportar CSV</button>
      </div>

      {params && (
        <div className="mb-5 flex flex-wrap gap-4 text-[13px] text-[#6E6E73]">
          <span>Impostos sobre a receita: <strong className="text-[#1D1D1F]">{params.impostos_pct}%</strong></span>
          <span>Meta de MC: <strong className="text-[#1D1D1F]">{params.mc_meta_pct}%</strong></span>
          <span>Mínimo: <strong className="text-[#1D1D1F]">{params.mc_minimo_pct}%</strong></span>
          {params.mc_minima_ia_pct != null && <span>Mínimo da IA: <strong className="text-[#1D1D1F]">{params.mc_minima_ia_pct}%</strong></span>}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi titulo="Receita" valor={moneyBR(totais.receita)} />
        <Kpi titulo="Custo" valor={moneyBR(totais.custo)} />
        <Kpi titulo="MC (R$)" valor={moneyBR(totais.mc)} />
        <Kpi titulo={<>%MC geral <Info slug="mc-e-mc-margem-de-contribuicao" /></>} valor={pct1(pctGeral)} />
        <Kpi titulo="Abaixo do mínimo" valor={numberBR(totais.abaixo)} />
      </div>

      {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
        <section className="rounded-2xl bg-white p-4" style={{ boxShadow: cardShadow }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-[13px]">
              <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Empresa</th><th className="pb-3 font-medium">Canal</th><th className="pb-3 font-medium">Plano</th><th className="pb-3 font-medium text-right">Envios</th><th className="pb-3 font-medium text-right">Respostas</th><th className="pb-3 font-medium text-right">Receita</th><th className="pb-3 font-medium text-right">Custo</th><th className="pb-3 font-medium text-right">MC</th><th className="pb-3 font-medium text-right">%MC</th></tr></thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {ordenadas.map((l, i) => {
                  const sit = SIT_MARGEM[l.situacao as string] ?? SIT_MARGEM.sem_receita;
                  const canalInfo = CANAIS_MSG.find(c => c.id === l.canal);
                  return (
                    <tr key={i} className="cursor-pointer hover:bg-[#F5F5F7]" onClick={() => setDetalhe(l)}>
                      <td className="py-2.5 pr-3 font-medium text-[#1D1D1F]">{l.empresa ?? '—'}</td>
                      <td className="py-2.5 pr-3"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: canalInfo?.cor ?? '#8E8E93' }}>{canalInfo?.nome ?? l.canal}</span></td>
                      <td className="py-2.5 pr-3 text-[#1D1D1F]">{l.plano ?? '—'}{!!l.plano_proprio && <span className="ml-1 text-[11px] text-[#8E8E93]">próprio</span>}</td>
                      <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{numberBR(l.envios ?? 0)}</td>
                      <td className="py-2.5 pr-3 text-right tnum text-[#6E6E73]">{numberBR(l.respostas ?? 0)}</td>
                      <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(l.receita ?? 0)}</td>
                      <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(l.custo ?? 0)}</td>
                      <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(l.mc ?? 0)}</td>
                      <td className="py-2.5 pr-3 text-right"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: sit.cor, backgroundColor: sit.bg }}>{pct1(l.mc_pct ?? 0)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {semCustoTotal > 0 && <p className="mt-3 text-[12px] text-[#9a631b]">⚠ {semCustoTotal} sem custo cadastrado</p>}
        </section>
      }

      <MargemIa competencia={competencia} mcMinima={params?.mc_minima_ia_pct} recarregar={salvos} />

      {detalhe && <PainelDetalhe linha={detalhe} competencia={competencia} modo={modo} onClose={() => setDetalhe(null)} />}
      {paramsOpen && <ParamsModal params={params} onClose={() => setParamsOpen(false)} onSaved={() => { setParamsOpen(false); setSalvos(n => n + 1); void reload(); }} />}
    </ConsoleShell>
  );
}

function PainelDetalhe({ linha, competencia, modo, onClose }: { linha: Row; competencia: string; modo: string; onClose: () => void }) {
  const canal = linha.canal as string;
  const [planos, setPlanos] = useState<Row[]>([]);
  const [planoSel, setPlanoSel] = useState('');
  const [sim, setSim] = useState<Row | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [usarBusy, setUsarBusy] = useState(false);
  const [simError, setSimError] = useState('');
  const [usadoMsg, setUsadoMsg] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.from('mensageria_planos_rota').select('id,nome').eq('canal', canal).eq('ativo', true).then(({ data }) => setPlanos((data ?? []) as Row[]));
  }, [canal]);
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  async function simular() {
    if (!supabase || !planoSel) return;
    setSimBusy(true); setSimError(''); setSim(null);
    const { data, error } = await supabase.rpc('simular_plano', { empresa: linha.empresa_id, canal, plano: planoSel, competencia, modo });
    setSimBusy(false);
    if (error) { setSimError(friendlyError(error)); return; }
    setSim(data as Row | null);
  }
  async function usarPlano() {
    if (!supabase || !planoSel) return;
    setUsarBusy(true); setSimError('');
    const { error } = await supabase.rpc('definir_rota_empresa', { empresa: linha.empresa_id, canal, plano: planoSel });
    setUsarBusy(false);
    if (error) { setSimError(friendlyError(error)); return; }
    setUsadoMsg('Vale para os próximos envios.');
    toast.success('Plano definido para a empresa.');
  }

  const receitaItens = Array.isArray(linha.receita_itens) ? (linha.receita_itens as Row[]) : [];
  const custoItens = Array.isArray(linha.custo_itens) ? (linha.custo_itens as Row[]) : [];
  const fornecedores = Array.isArray(linha.fornecedores) ? (linha.fornecedores as Row[]) : [];
  const operadoras = Array.isArray(linha.operadoras) ? (linha.operadoras as Row[]) : [];
  const totalCustoForn = fornecedores.reduce((s, f) => s + Number(f.custo ?? 0), 0) || 1;

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="h-full w-full max-w-[440px] overflow-y-auto bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-[#1D1D1F]">{linha.empresa ?? '—'} · {CANAIS_MSG.find(c => c.id === canal)?.nome ?? canal}</h2>
          <button onClick={onClose} className="text-[#8E8E93]"><X size={20} /></button>
        </div>

        <div className="space-y-5">
          {(receitaItens.length > 0 || custoItens.length > 0) && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Por item</p>
              <div className="overflow-x-auto rounded-xl border border-[#F0F0F2]">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="p-2 text-left font-medium">Item</th><th className="p-2 text-right font-medium">Qtd</th><th className="p-2 text-right font-medium">Receita</th><th className="p-2 text-right font-medium">Custo</th></tr></thead>
                  <tbody className="divide-y divide-[#F0F0F2]">
                    {receitaItens.map((r, i) => {
                      const c = custoItens.find(x => x.item === r.item);
                      return <tr key={i}><td className="p-2 text-[#1D1D1F]">{r.item ?? '—'}</td><td className="p-2 text-right tnum text-[#6E6E73]">{numberBR(r.quantidade ?? 0)}</td><td className="p-2 text-right tnum text-[#1D1D1F]">{moneyBR(r.receita ?? 0)}</td><td className="p-2 text-right tnum text-[#1D1D1F]">{moneyBR(c?.custo ?? 0)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fornecedores.length > 0 && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Fornecedores</p>
              <div className="space-y-2">
                {fornecedores.map((f, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-[13px]"><span className="text-[#1D1D1F]">{f.fornecedor ?? '—'}</span><span className="tnum text-[#6E6E73]">{numberBR(f.quantidade ?? 0)} · {moneyBR(f.custo ?? 0)}</span></div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#EEEEF0]"><div className="h-full rounded-full bg-[#0A60D0]" style={{ width: `${(Number(f.custo ?? 0) / totalCustoForn) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {operadoras.length > 0 && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Operadoras</p>
              <div className="space-y-1">
                {operadoras.map((o, i) => <div key={i} className="flex items-center justify-between text-[13px]"><span className="text-[#1D1D1F]">{o.operadora ?? '—'}</span><span className="tnum text-[#6E6E73]">{numberBR(o.quantidade ?? 0)} · {moneyBR(o.custo ?? 0)}</span></div>)}
              </div>
            </div>
          )}

          <div className="border-t border-[#F0F0F2] pt-4">
            <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Simular outro plano</p>
            <div className="flex gap-2">
              <select value={planoSel} onChange={e => setPlanoSel(e.target.value)} className="h-9 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[14px] outline-none focus:border-[#1D1D1F]">
                <option value="">Escolha um plano…</option>
                {planos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <button onClick={simular} disabled={!planoSel || simBusy} className="h-9 rounded-lg bg-[#1D1D1F] px-4 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{simBusy ? '...' : 'Simular'}</button>
            </div>
            {simError && <p className="mt-2 text-[12px] text-[#FF3B30]">{simError}</p>}
            {sim && (
              <div className="mt-3 rounded-xl bg-[#F5F5F7] p-3 text-[13px]">
                <p className="text-[#1D1D1F]">%MC hoje <strong>{pct1(sim.mc_atual_pct)}</strong> → com este plano <strong>{pct1(sim.mc_simulado_pct)}</strong></p>
                <p className="mt-1 text-[#6E6E73]">Diferença: <strong className="text-[#1D1D1F]">{moneyBR(Number(sim.custo_atual ?? 0) - Number(sim.custo_simulado ?? 0))}</strong> de custo</p>
                {Array.isArray(sim.fornecedores_sem_custo) && (sim.fornecedores_sem_custo as string[]).length > 0 && <p className="mt-1 text-[12px] text-[#9a631b]">Sem custo cadastrado: {(sim.fornecedores_sem_custo as string[]).join(', ')}</p>}
                <button onClick={usarPlano} disabled={usarBusy} className="mt-3 h-9 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-medium text-white disabled:opacity-50 hover:opacity-85">Usar este plano para a empresa</button>
                {usadoMsg && <p className="mt-2 text-[12px] text-[#248A3D]">{usadoMsg}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ParamsModal({ params, onClose, onSaved }: { params: Row | null; onClose: () => void; onSaved: () => void }) {
  const [impostos, setImpostos] = useState(String(params?.impostos_pct ?? 0));
  const [meta, setMeta] = useState(String(params?.mc_meta_pct ?? 0));
  const [minimo, setMinimo] = useState(String(params?.mc_minimo_pct ?? 0));
  const temIa = params?.mc_minima_ia_pct != null;
  const [minimoIa, setMinimoIa] = useState(String(params?.mc_minima_ia_pct ?? 70));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  async function salvar() {
    if (!supabase) return;
    setBusy(true); setError('');
    const valores: Record<string, number> = { impostos_pct: Number(impostos), mc_meta_pct: Number(meta), mc_minimo_pct: Number(minimo) };
    if (temIa) valores.mc_minima_ia_pct = Number(minimoIa);
    const { error } = await supabase.from('parametros_margem').update(valores).eq('id', 1);
    setBusy(false);
    if (error) { setError(/MC mínima da IA/.test(error.message ?? '') ? error.message : friendlyError(error)); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[400px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold text-[#1D1D1F]">Parâmetros de margem</h2><button onClick={onClose} className="text-[#8E8E93]"><X size={20} /></button></div>
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Impostos sobre a receita (%)</span><input type="number" step="0.1" value={impostos} onChange={e => setImpostos(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Meta de MC (%)</span><input type="number" step="0.1" value={meta} onChange={e => setMeta(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" /></label>
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Mínimo (%)</span><input type="number" step="0.1" value={minimo} onChange={e => setMinimo(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" /></label>
          {temIa && <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">MC mínima dos itens de IA (%)</span><input type="number" step="0.1" value={minimoIa} onChange={e => setMinimoIa(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] tnum outline-none focus:border-[#1D1D1F]" /><span className="mt-1 block text-[12px] text-[#8E8E93]">Preço de IA abaixo do que ela exige é recusado. Mudar não altera preços: o que ficar abaixo aparece em Itens de IA.</span></label>}
        </div>
        {error && <p role="alert" className="mt-3 text-[14px] text-[#FF3B30]">{error}</p>}
        <div className="mt-5 flex justify-end gap-3"><button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button><button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button></div>
      </div>
    </div>
  );
}
