// Console › Margem (Master da equipe). Redesign v2: abas Canais | Itens de IA, 4 KPIs por aba, tabelas com até 6
// colunas e o detalhe da linha na gaveta. Só tokens do tema (antes havia cores fixas e o escuro quebrava).
// Dados: margem_mensageria, parametros_margem, simular_plano e definir_rota_empresa (iguais aos de antes).
import { useEffect, useState } from 'react';
import { Download, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, moneyBR, numberBR, type Row } from '@/lib/supabase';
import { CANAIS_MSG, mesExtenso, ultimosMeses, primeiroDiaMes } from '@/lib/empresa-helpers';
import { exportarCsv } from '@/lib/mensageria';
import { Info } from '@/components/glossario/info';
import { Abas, Aviso, Botao, Cartao, Estado, Gaveta, Kpis, ListaValores, Modal, Pilula, Rotulo, Segmentos, Tabela, campoCls, campoStyle, type Tom } from '@/components/ds';
import { ConsoleShell } from './console-shell';
import { useConsolePerms } from './console-perms';
import { MargemIa } from './console-margem-ia';

const SIT_MARGEM: Record<string, { label: string; tom: Tom }> = {
  ok: { label: 'OK', tom: 'ok' },
  abaixo_meta: { label: 'Abaixo da meta', tom: 'atencao' },
  abaixo_minimo: { label: 'Abaixo do mínimo', tom: 'erro' },
  sem_preco: { label: 'Sem preço', tom: 'neutro' },
  sem_receita: { label: 'Sem receita', tom: 'neutro' },
};

function pct1(v: unknown) { return `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }

/** Canal com a cor fixa do canal (as únicas cores fixas permitidas no tema). */
function CanalPilula({ canal }: { canal: unknown }) {
  const c = CANAIS_MSG.find(x => x.id === canal);
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `var(--canal-${String(canal)}, ${c?.cor ?? 'var(--base-texto-3)'})`, color: '#FFFFFF' }}>{c?.nome ?? String(canal ?? '—')}</span>;
}

export function ConsoleMargemPage() {
  const { isMaster } = useConsolePerms();
  const [aba, setAba] = useState<'canais' | 'ia'>('canais');
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
  const mcPilula = (l: Row) => { const sit = SIT_MARGEM[l.situacao as string] ?? SIT_MARGEM.sem_receita; return <Pilula tom={sit.tom} title={sit.label}>{pct1(l.mc_pct ?? 0)}</Pilula>; };

  return (
    <ConsoleShell>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[22px] font-bold tracking-tight text-[var(--base-texto)]">Margem</h2>
          {params && <p className="mt-1 text-[13px] text-[var(--base-texto-2)]">Impostos {params.impostos_pct}% · meta de MC {params.mc_meta_pct}% · mínimo {params.mc_minimo_pct}%{params.mc_minima_ia_pct != null ? ` · mínimo da IA ${params.mc_minima_ia_pct}%` : ''}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Competência" value={competencia} onChange={e => setCompetencia(e.target.value)} className={campoCls} style={campoStyle}>
            {meses.map(m => <option key={m} value={m}>{mesExtenso(m)}</option>)}
          </select>
          {aba === 'canais' && <Segmentos rotulo="Modo" itens={[{ v: 'real', n: 'Real' }, { v: 'simulado', n: 'Simulado' }]} valor={modo} onTrocar={setModo} />}
          <Botao tipo="secundario" onClick={() => setParamsOpen(true)}><Pencil size={14} aria-hidden="true" />Parâmetros</Botao>
          {aba === 'canais' && <Botao tipo="secundario" onClick={exportar}><Download size={14} aria-hidden="true" />Exportar CSV</Botao>}
        </div>
      </div>
      {isMaster && <Abas rotulo="Margem" atual={aba} onTrocar={id => setAba(id as 'canais' | 'ia')} itens={[{ id: 'canais', nome: 'Canais' }, { id: 'ia', nome: 'Itens de IA' }]} />}

      {aba === 'ia' && isMaster ? <MargemIa competencia={competencia} mcMinima={params?.mc_minima_ia_pct} recarregar={salvos} /> : (
        <div className="space-y-4">
          {error && <Estado tipo="erro" titulo="Não deu para carregar a margem.">{error}</Estado>}
          {modo === 'simulado' && <Aviso tom="info" titulo="Simulado:">números de simulação.</Aviso>}
          <Kpis itens={[
            { rotulo: 'Receita', valor: moneyBR(totais.receita), detalhe: `custo ${moneyBR(totais.custo)}` },
            { rotulo: 'MC (R$)', valor: moneyBR(totais.mc) },
            { rotulo: <>%MC geral <Info slug="mc-e-mc-margem-de-contribuicao" /></>, valor: pct1(pctGeral), tom: params && pctGeral < Number(params.mc_minimo_pct ?? 0) ? 'alerta' : params && pctGeral < Number(params.mc_meta_pct ?? 0) ? 'atencao' : undefined },
            { rotulo: 'Abaixo do mínimo', valor: numberBR(totais.abaixo), tom: totais.abaixo ? 'alerta' : undefined, detalhe: semCustoTotal ? `${numberBR(semCustoTotal)} sem custo cadastrado` : undefined },
          ]} />
          {loading ? <Estado tipo="carregando" titulo="Carregando…" compacto /> : (
            <Cartao semPadding>
              <Tabela rotulo="Margem por empresa e canal" linhas={ordenadas} chave={l => `${String(l.empresa_id)}-${String(l.canal)}`} onAbrir={setDetalhe}
                selecionada={detalhe ? `${String(detalhe.empresa_id)}-${String(detalhe.canal)}` : null} vazio="Sem envios no mês."
                colunas={[
                  { id: 'emp', titulo: 'Empresa', celula: l => <span className="font-medium">{String(l.empresa ?? '—')}</span> },
                  { id: 'canal', titulo: 'Canal', celula: l => <CanalPilula canal={l.canal} /> },
                  { id: 'plano', titulo: 'Plano', celula: l => <>{String(l.plano ?? '—')}{!!l.plano_proprio && <span className="ml-1 text-[11px] text-[var(--base-texto-3)]">próprio</span>}</> },
                  { id: 'env', titulo: 'Envios', num: true, celula: l => numberBR(l.envios ?? 0) },
                  { id: 'rec', titulo: 'Receita', num: true, celula: l => moneyBR(l.receita ?? 0) },
                  { id: 'mc', titulo: '%MC', num: true, celula: mcPilula },
                ]}
                celular={l => ({ titulo: String(l.empresa ?? '—'), valor: mcPilula(l), resumo: <><CanalPilula canal={l.canal} /><span>{moneyBR(l.receita ?? 0)}</span></> })} />
            </Cartao>
          )}
        </div>
      )}

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
    <Gaveta aberta onFechar={onClose} titulo={`${String(linha.empresa ?? '—')} · ${CANAIS_MSG.find(c => c.id === canal)?.nome ?? canal}`} subtitulo={`${String(linha.plano ?? 'sem plano')} · %MC ${pct1(linha.mc_pct ?? 0)}`}>
      <ListaValores itens={[['Envios', numberBR(linha.envios ?? 0)], ['Respostas', numberBR(linha.respostas ?? 0)], ['Receita', moneyBR(linha.receita ?? 0)], ['Custo', moneyBR(linha.custo ?? 0)], ['MC', moneyBR(linha.mc ?? 0)]]} />
      {(receitaItens.length > 0 || custoItens.length > 0) && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-[var(--base-texto)]">Por item</p>
          <ul className="divide-y rounded-xl border text-[13px] [&>*]:border-[var(--base-borda)]" style={{ borderColor: 'var(--base-borda)' }}>
            {receitaItens.map((r, i) => {
              const c = custoItens.find(x => x.item === r.item);
              return <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2"><span className="text-[var(--base-texto)]">{String(r.item ?? '—')} <small className="text-[var(--base-texto-3)]">· {numberBR(r.quantidade ?? 0)}</small></span><span className="tnum text-[var(--base-texto-2)]">{moneyBR(r.receita ?? 0)} · custo {moneyBR(c?.custo ?? 0)}</span></li>;
            })}
          </ul>
        </div>
      )}
      {fornecedores.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-[var(--base-texto)]">Fornecedores</p>
          <div className="space-y-2">
            {fornecedores.map((f, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-[13px]"><span className="text-[var(--base-texto)]">{String(f.fornecedor ?? '—')}</span><span className="tnum text-[var(--base-texto-2)]">{numberBR(f.quantidade ?? 0)} · {moneyBR(f.custo ?? 0)}</span></div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--base-fill)]"><div className="h-full rounded-full bg-[var(--destaque)]" style={{ width: `${(Number(f.custo ?? 0) / totalCustoForn) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {operadoras.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-[var(--base-texto)]">Operadoras</p>
          <ListaValores itens={operadoras.map(o => [String(o.operadora ?? '—'), `${numberBR(o.quantidade ?? 0)} · ${moneyBR(o.custo ?? 0)}`])} />
        </div>
      )}
      <div className="border-t border-[var(--base-borda)] pt-4">
        <p className="mb-2 text-[13px] font-semibold text-[var(--base-texto)]">Simular outro plano</p>
        <div className="flex gap-2">
          <select aria-label="Plano" value={planoSel} onChange={e => setPlanoSel(e.target.value)} className={`${campoCls} flex-1`} style={campoStyle}>
            <option value="">Escolha um plano…</option>
            {planos.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.nome)}</option>)}
          </select>
          <Botao tipo="secundario" onClick={() => void simular()} disabled={!planoSel || simBusy}>{simBusy ? '...' : 'Simular'}</Botao>
        </div>
        {simError && <div className="mt-2"><Aviso tom="erro">{simError}</Aviso></div>}
        {sim && (
          <div className="mt-3 rounded-xl bg-[var(--base-fill)] p-3 text-[13px]">
            <p className="text-[var(--base-texto)]">%MC hoje <strong>{pct1(sim.mc_atual_pct)}</strong> → com este plano <strong>{pct1(sim.mc_simulado_pct)}</strong></p>
            <p className="mt-1 text-[var(--base-texto-2)]">Diferença: <strong className="text-[var(--base-texto)]">{moneyBR(Number(sim.custo_atual ?? 0) - Number(sim.custo_simulado ?? 0))}</strong> de custo</p>
            {Array.isArray(sim.fornecedores_sem_custo) && (sim.fornecedores_sem_custo as string[]).length > 0 && <p className="mt-1 text-[12px] text-[var(--estado-atencao-texto)]">Sem custo cadastrado: {(sim.fornecedores_sem_custo as string[]).join(', ')}</p>}
            <div className="mt-3"><Botao onClick={() => void usarPlano()} disabled={usarBusy}>Usar este plano para a empresa</Botao></div>
            {usadoMsg && <p className="mt-2 text-[12px] text-[var(--estado-pronto-texto)]">{usadoMsg}</p>}
          </div>
        )}
      </div>
    </Gaveta>
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

  const campo = `${campoCls} w-full tnum`;
  return (
    <Modal titulo="Parâmetros de margem" onFechar={onClose} confirmar="Salvar" ocupado={busy} onConfirmar={() => void salvar()}>
      <Rotulo texto="Impostos sobre a receita (%)"><input type="number" step="0.1" value={impostos} onChange={e => setImpostos(e.target.value)} className={campo} style={campoStyle} /></Rotulo>
      <Rotulo texto="Meta de MC (%)"><input type="number" step="0.1" value={meta} onChange={e => setMeta(e.target.value)} className={campo} style={campoStyle} /></Rotulo>
      <Rotulo texto="Mínimo (%)"><input type="number" step="0.1" value={minimo} onChange={e => setMinimo(e.target.value)} className={campo} style={campoStyle} /></Rotulo>
      {temIa && <Rotulo texto="MC mínima dos itens de IA (%)" dica="Preço de IA abaixo do que ela exige é recusado. Mudar não altera preços: o que ficar abaixo aparece em Itens de IA."><input type="number" step="0.1" value={minimoIa} onChange={e => setMinimoIa(e.target.value)} className={campo} style={campoStyle} /></Rotulo>}
      {error && <Aviso tom="erro">{error}</Aviso>}
    </Modal>
  );
}
