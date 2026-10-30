import { useEffect, useState } from 'react';
import { ChevronDown, FileText, RefreshCw, Loader2, X, Lock } from 'lucide-react';
import { supabase, friendlyError, moneyBR, dateBR, dateTimeBR, type Row } from '@/lib/supabase';
import { mesExtenso, mesCurto, ultimosMeses } from '@/lib/empresa-helpers';
import { ConsoleShell, cardShadow } from './console-shell';
import { Chave } from './chave';
import { useConsolePerms } from './console-perms';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { ProcessoLongo } from '@/components/comuns/processo-longo';
import { TabelaResponsiva } from '@/components/comuns/tabela-responsiva';
import { AcordosTab, LancarAcordoModal, AcordoBloqueado } from './console-acordos';

type Tab = 'faturas' | 'cobrancas' | 'notas' | 'config' | 'acordos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'faturas', label: 'Faturas do ciclo' },
  { id: 'cobrancas', label: 'Cobranças' },
  { id: 'notas', label: 'Notas fiscais' },
  { id: 'config', label: 'Configuração da nota' },
  { id: 'acordos', label: 'Acordos' },
];

export function ConsoleFaturamentoPage() {
  const { can, isMaster } = useConsolePerms();
  const canEmitir = can('emitir_faturas');
  const [tab, setTab] = useState<Tab>('faturas');
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [acordosAndamento, setAcordosAndamento] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('acordos');
      if (!active) return;
      const n = ((data as Row[]) ?? []).filter(a => ['em_dia', 'parcela_vencida'].includes(String(a.situacao ?? ''))).length;
      setAcordosAndamento(n);
    })();
    return () => { active = false; };
  }, [sucesso]);

  return (
    <ConsoleShell>
      {erro && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">
          <span>{erro}</span>
          <button onClick={() => setErro('')} aria-label="Fechar" className="shrink-0 text-[#FF3B30]"><X size={16} /></button>
        </div>
      )}
      {sucesso && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">
          <span>{sucesso}</span>
          <button onClick={() => setSucesso('')} aria-label="Fechar" className="shrink-0 text-[#248A3D]"><X size={16} /></button>
        </div>
      )}

      <div className="no-scrollbar mb-5 flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1 sm:w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 rounded-[9px] px-4 py-1.5 text-[15px] font-medium transition-colors ${tab === t.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{t.label}{t.id === 'acordos' && acordosAndamento > 0 && <span className="ml-1.5 rounded-full bg-[#E5E5EA] px-1.5 py-0.5 text-[11px] font-semibold text-[#6E6E73] tnum">{acordosAndamento}</span>}</button>
        ))}
      </div>

      {tab === 'faturas' && <FaturasCiclo canEmitir={canEmitir} isMaster={isMaster} setErro={setErro} setSucesso={setSucesso} />}
      {tab === 'cobrancas' && <CobrancasTab canEmitir={canEmitir} setErro={setErro} setSucesso={setSucesso} />}
      {tab === 'notas' && <NotasTab canEmitir={canEmitir} setErro={setErro} setSucesso={setSucesso} />}
      {tab === 'config' && <ConfigNotaTab isMaster={isMaster} setErro={setErro} setSucesso={setSucesso} />}
      {tab === 'acordos' && <AcordosTab setErro={setErro} setSucesso={setSucesso} />}
    </ConsoleShell>
  );
}

// ============================ Tab 1: Faturas do ciclo ============================

type FatTab = 'rascunhos' | 'aberto' | 'vencidas' | 'pagas';

const FAT_TABS: { id: FatTab; label: string }[] = [
  { id: 'rascunhos', label: 'Rascunhos' },
  { id: 'aberto', label: 'Em aberto' },
  { id: 'vencidas', label: 'Vencidas' },
  { id: 'pagas', label: 'Pagas' },
];

function FaturasCiclo({ canEmitir, isMaster, setErro, setSucesso }: {
  canEmitir: boolean; isMaster: boolean; setErro: (s: string) => void; setSucesso: (s: string) => void;
}) {
  const [competencia, setCompetencia] = useState(ultimosMeses(6)[1]);
  const [faturas, setFaturas] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionadas, setSelecionadas] = useState<Record<string, boolean>>({});
  const [expandida, setExpandida] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<FatTab>('rascunhos');
  const [confirmaEmitir, setConfirmaEmitir] = useState<Row[] | null>(null);
  const [resumo, setResumo] = useState<Row | null>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [confirmaCancelar, setConfirmaCancelar] = useState<Row | null>(null);
  const [liberar, setLiberar] = useState<Row | null>(null);
  const [selecionadasVenc, setSelecionadasVenc] = useState<Record<string, boolean>>({});
  const [lancarAcordo, setLancarAcordo] = useState<{ empresaId: string; empresaNome: string; pre: string[] } | null>(null);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.from('faturas_painel').select('*').eq('competencia', competencia).order('empresa');
      if (error) throw error;
      setFaturas((data ?? []) as Row[]);
    } catch (e) {
      setErro(friendlyError(e));
      setFaturas([]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [competencia]);

  const porTab: Record<FatTab, Row[]> = {
    rascunhos: faturas.filter(f => String(f.situacao ?? '') === 'rascunho'),
    aberto: faturas.filter(f => String(f.situacao ?? '') === 'emitida' && !['vencida', 'em_acordo'].includes(String(f.situacao_atual ?? ''))),
    vencidas: faturas.filter(f => String(f.situacao_atual ?? '') === 'vencida'),
    pagas: faturas.filter(f => String(f.situacao ?? '') === 'paga'),
  };
  const lista = porTab[tab];
  const rascunhos = porTab.rascunhos;
  const idsSel = rascunhos.filter(f => selecionadas[f.id]).map(f => f.id);
  const todosRascunhosSel = rascunhos.length > 0 && rascunhos.every(f => selecionadas[f.id]);

  function toggleTudo() {
    setSelecionadas(prev => { const n = { ...prev }; if (todosRascunhosSel) rascunhos.forEach(f => delete n[f.id]); else rascunhos.forEach(f => n[f.id] = true); return n; });
  }
  function toggleUm(id: string) {
    setSelecionadas(prev => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  }

  // --- Vencidas: seleção para lançar acordo (várias da mesma empresa) ---
  const vencidas = porTab.vencidas;
  const vencSel = vencidas.filter(f => selecionadasVenc[f.id]);
  const vencEmpresas = new Set(vencSel.map(f => String(f.empresa_id ?? '')));
  const vencMesmaEmpresa = vencSel.length > 0 && vencEmpresas.size === 1;
  function toggleVenc(id: string) {
    setSelecionadasVenc(prev => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  }
  function toggleTudoVenc() {
    setSelecionadasVenc(prev => { const n = { ...prev }; const todas = vencidas.every(f => selecionadasVenc[f.id]); if (todas) vencidas.forEach(f => delete n[f.id]); else vencidas.forEach(f => n[f.id] = true); return n; });
  }
  function abrirLancarAcordo(faturasSel: Row[]) {
    if (faturasSel.length === 0) return;
    const f = faturasSel[0];
    setLancarAcordo({ empresaId: String(f.empresa_id ?? ''), empresaNome: String(f.empresa ?? '—'), pre: faturasSel.map(x => x.id) });
  }

  async function gerarRascunhos() {
    if (!supabase) return;
    setBusy(true); setErro(''); setSucesso('');
    try {
      const { error } = await supabase.rpc('gerar_rascunhos', { competencia });
      if (error) throw error;
      setSucesso('Rascunhos gerados para o ciclo.');
      void reload();
    } catch (e) { setErro(friendlyError(e)); } finally { setBusy(false); }
  }

  async function cancelarRascunho(f: Row) {
    if (!supabase) return;
    setBusy(true); setErro(''); setSucesso('');
    try {
      const { error } = await supabase.rpc('cancelar_rascunho', { fatura: f.id });
      if (error) throw error;
      setSucesso('Rascunho cancelado.');
      setConfirmaCancelar(null);
      void reload();
    } catch (e) { setErro(friendlyError(e)); } finally { setBusy(false); }
  }

  async function pedirResumo(ids: string[]) {
    if (!supabase) return;
    setBusy(true); setErro('');
    try {
      const { data, error } = await supabase.rpc('resumo_emissao', { ids });
      if (error) throw error;
      setResumo((data as Row) ?? null);
    } catch (e) { setErro(friendlyError(e)); } finally { setBusy(false); }
  }

  function iniciarEmissao(ids: string[]) {
    const sel = rascunhos.filter(f => ids.includes(f.id));
    setConfirmaEmitir(sel);
    setResumo(null);
    void pedirResumo(ids);
  }

  async function confirmarEmissao() {
    if (!supabase || !confirmaEmitir) return;
    const ids = confirmaEmitir.map(f => f.id);
    setEmitindo(true); setErro('');
    try {
      const { error } = await supabase.rpc('emitir_faturas', { faturas: ids });
      if (error) throw error;
      setSucesso(`${ids.length} fatura${ids.length === 1 ? '' : 's'} emitida${ids.length === 1 ? '' : 's'}. Demonstrativo, boleto e e-mail a caminho.`);
      setConfirmaEmitir(null); setResumo(null); setSelecionadas({});
      void reload();
    } catch (e) { setErro(friendlyError(e)); } finally { setEmitindo(false); }
  }

  async function demonstrativo(faturaId: string) {
    if (!supabase) return;
    setErro('');
    try {
      const { data, error } = await supabase.functions.invoke('cobranca', { body: { acao: 'demonstrativo', fatura: faturaId } });
      if (error) throw error;
      const url = (data as Row)?.url;
      if (url) window.open(String(url), '_blank', 'noopener,noreferrer');
      else throw new Error('Demonstrativo indisponível.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : friendlyError(e));
    }
  }

  if (emitindo) {
    return (
      <div className="flex justify-center py-10">
        <ProcessoLongo etapas={['Gerando o demonstrativo', 'Criando o boleto', 'Enviando o e-mail']} etapaAtual={1} aviso="O envio continua em segundo plano; o aviso chega no sino." />
      </div>
    );
  }

  return (
    <>
      {/* Seletor de mês + ações */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-[14px] font-semibold text-[#1D1D1F]">Ciclo</label>
          <select value={competencia} onChange={e => setCompetencia(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">
            {ultimosMeses(6).map(m => <option key={m} value={m}>{mesExtenso(m)}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {isMaster && (
            <button onClick={gerarRascunhos} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Gerar rascunhos
            </button>
          )}
          {canEmitir && tab === 'rascunhos' && (
            <button onClick={() => iniciarEmissao(idsSel)} disabled={busy || idsSel.length === 0} className="flex h-9 items-center gap-2 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-40">
              {busy && <Loader2 size={14} className="animate-spin" />} Emitir selecionadas{idsSel.length > 0 ? ` (${idsSel.length})` : ''}
            </button>
          )}
          {canEmitir && tab === 'vencidas' && vencMesmaEmpresa && vencSel.length > 1 && (
            <button onClick={() => abrirLancarAcordo(vencSel)} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">
              {busy && <Loader2 size={14} className="animate-spin" />} Lançar acordo ({vencSel.length})
            </button>
          )}
        </div>
      </div>

      {/* Abas com contagem */}
      <div className="no-scrollbar mb-4 flex items-center gap-1 overflow-x-auto rounded-[12px] bg-[#F5F5F7] p-1 sm:w-fit">
        {FAT_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[14px] font-medium transition-colors ${tab === t.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>
            {t.label}{porTab[t.id].length > 0 && <span className="ml-1.5 rounded-full bg-[#E5E5EA] px-1.5 py-0.5 text-[11px] font-semibold text-[#6E6E73] tnum">{porTab[t.id].length}</span>}
          </button>
        ))}
      </div>

      <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          lista.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhuma fatura nesta aba.</p> :
            <TabelaFaturas
              tab={tab}
              lista={lista}
              selecionadas={selecionadas}
              selecionadasVenc={selecionadasVenc}
              expandida={expandida}
              canEmitir={canEmitir}
              isMaster={isMaster}
              busy={busy}
              onToggle={toggleUm}
              onToggleTudo={toggleTudo}
              todosSel={todosRascunhosSel}
              onToggleVenc={toggleVenc}
              onToggleTudoVenc={toggleTudoVenc}
              todosVencSel={vencidas.length > 0 && vencidas.every(f => selecionadasVenc[f.id])}
              onExpand={(id) => setExpandida(expandida === id ? null : id)}
              onEmitir={(f) => iniciarEmissao([f.id])}
              onCancelar={(f) => setConfirmaCancelar(f)}
              onDemonstrativo={demonstrativo}
              onLiberar={(f) => setLiberar(f)}
              onLancarAcordo={(f) => abrirLancarAcordo([f])}
            />}
        <p className="mt-4 text-[12px] leading-relaxed text-[#8E8E93]">
          Ao emitir: o demonstrativo em PDF é gerado, o boleto é criado no Stripe (PDF separado) e o e-mail vai para os contatos financeiros da empresa.
        </p>
      </section>

      {confirmaEmitir && (
        <ConfirmaAcao
          aberto
          titulo="Emitir faturas"
          texto={resumo ? (
            <div className="space-y-2">
              <p>{Number(resumo.quantidade ?? confirmaEmitir.length)} faturas serão emitidas, somando <strong>{moneyBR(resumo.total)}</strong>.</p>
              <p>O e-mail com o demonstrativo, o boleto e a nota sai para {Number(resumo.contatos ?? 0)} contato(s).</p>
              <p>Depois de emitida, a fatura não volta a rascunho.</p>
              {Number(resumo.sem_contato ?? 0) > 0 && (
                <p className="rounded-lg bg-[#FFF3E8] px-3 py-2 text-[13px] text-[#9a631b]">Sem e-mail de fatura: {String(resumo.sem_contato ?? '')} — marque Recebe faturas antes.</p>
              )}
            </div>
          ) : 'Carregando resumo...'}
          botao={`Emitir ${confirmaEmitir.length} · ${resumo ? moneyBR(resumo.total) : ''}`}
          loading={busy}
          onConfirm={confirmarEmissao}
          onClose={() => { setConfirmaEmitir(null); setResumo(null); }}
        />
      )}

      {confirmaCancelar && (
        <ConfirmaAcao
          aberto
          titulo="Cancelar rascunho"
          texto={`Cancelar o rascunho de ${String(confirmaCancelar.empresa ?? '—')}? Ele some da lista.`}
          botao="Cancelar o rascunho"
          loading={busy}
          onConfirm={() => cancelarRascunho(confirmaCancelar)}
          onClose={() => setConfirmaCancelar(null)}
        />
      )}

      {liberar && (
        <LiberarInadimplenteModal
          fatura={liberar}
          onClose={() => setLiberar(null)}
          onDone={() => { setLiberar(null); void reload(); }}
          setErro={setErro}
          setSucesso={setSucesso}
        />
      )}

      {lancarAcordo && (
        <LancarAcordoModal
          empresaId={lancarAcordo.empresaId}
          empresaNome={lancarAcordo.empresaNome}
          preSelecionadas={lancarAcordo.pre}
          onClose={() => setLancarAcordo(null)}
          onDone={() => { setLancarAcordo(null); setSelecionadasVenc({}); void reload(); }}
          setErro={setErro}
          setSucesso={setSucesso}
        />
      )}
    </>
  );
}

function TabelaFaturas({ tab, lista, selecionadas, selecionadasVenc, expandida, canEmitir, isMaster, busy, onToggle, onToggleTudo, todosSel, onToggleVenc, onToggleTudoVenc, todosVencSel, onExpand, onEmitir, onCancelar, onDemonstrativo, onLiberar, onLancarAcordo }: {
  tab: FatTab; lista: Row[]; selecionadas: Record<string, boolean>; selecionadasVenc: Record<string, boolean>; expandida: string | null;
  canEmitir: boolean; isMaster: boolean; busy: boolean;
  onToggle: (id: string) => void; onToggleTudo: () => void; todosSel: boolean;
  onToggleVenc: (id: string) => void; onToggleTudoVenc: () => void; todosVencSel: boolean;
  onExpand: (id: string) => void; onEmitir: (f: Row) => void; onCancelar: (f: Row) => void;
  onDemonstrativo: (id: string) => void; onLiberar: (f: Row) => void; onLancarAcordo: (f: Row) => void;
}) {
  const cabecalho: string[] = tab === 'rascunhos'
    ? ['', 'Empresa', 'Situação', 'Mês de', 'Valor', 'E-mail para', '']
    : tab === 'aberto'
      ? ['Empresa', 'Situação', 'Mês de', 'Valor', 'Vence em', '']
      : tab === 'vencidas'
        ? canEmitir ? ['', 'Empresa', 'Situação', 'Mês de', 'Valor', 'Atraso · lembretes', ''] : ['Empresa', 'Situação', 'Mês de', 'Valor', 'Atraso · lembretes', '']
        : ['Empresa', 'Situação', 'Mês de', 'Valor', 'Paga em', ''];

  const linhas = lista.map(f => {
    const sit = sitFaturaBadge(f);
    const isRascunho = String(f.situacao ?? '') === 'rascunho';
    const sel = !!selecionadas[f.id];
    const aberta = expandida === f.id;
    const empSit = String(f.empresa_situacao ?? '');
    const inadimplente = empSit === 'inadimplente';
    const liberadaAte = f.liberada_ate ? dateBR(f.liberada_ate) : '';
    const diasAtraso = Number(f.dias_atraso ?? 0);
    const bloqueiaEm = Number(f.bloqueia_em ?? null);
    const lembretes = Number(f.lembretes ?? 0);
    const celulas: React.ReactNode[] = [];

    if (tab === 'rascunhos') {
      celulas.push(canEmitir ? <input type="checkbox" checked={sel} onChange={() => onToggle(f.id)} className="h-4 w-4 accent-[#1D1D1F]" /> : <span />);
    } else if (tab === 'vencidas' && canEmitir) {
      celulas.push(<input type="checkbox" checked={!!selecionadasVenc[f.id]} onChange={() => onToggleVenc(f.id)} className="h-4 w-4 accent-[#1D1D1F]" />);
    }
    celulas.push(<span className="font-medium text-[#1D1D1F]">{String(f.empresa ?? '—')}</span>);
    celulas.push(<span className="inline-flex items-center gap-1.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>{inadimplente && <span className="rounded-full bg-[#FFE8E6] px-2 py-0.5 text-[11px] font-semibold text-[#FF3B30]">Inadimplente</span>}{liberadaAte && <span className="rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[11px] font-semibold text-[#9a631b]">Liberada até {liberadaAte}</span>}</span>);
    celulas.push(<span className="text-[#6E6E73]">{f.competencia ? mesCurto(f.competencia) : '—'}</span>);
    celulas.push(<span className="font-semibold text-[#1D1D1F] tnum">{moneyBR(f.valor_total)}</span>);
    if (tab === 'rascunhos') {
      celulas.push(<span className="text-[#6E6E73] tnum">{Number(f.contatos_fatura ?? 0)} contato(s)</span>);
    } else if (tab === 'aberto') {
      celulas.push(<span className="text-[#6E6E73]">{f.vence_em ? dateBR(f.vence_em) : '—'}</span>);
    } else if (tab === 'vencidas') {
      celulas.push(<span className="text-[13px]"><span className="tnum text-[#FF3B30]">{diasAtraso} dia(s)</span>{lembretes > 0 && <span className="text-[#8E8E93]"> · {lembretes} lembrete(s)</span>}{bloqueiaEm != null && !isNaN(bloqueiaEm) && bloqueiaEm <= 3 && <span className="block text-[12px] text-[#FF3B30]">bloqueia em {bloqueiaEm} dia(s)</span>}</span>);
    } else {
      celulas.push(<span className="text-[#6E6E73]">{f.paga_em ? dateBR(f.paga_em) : '—'}{f.acordo_id && <span className="block text-[12px] text-[#6E6E73]">Paga (via acordo nº {String(f.acordo_id).slice(0, 8)})</span>}</span>);
    }
    celulas.push(
      <span className="flex items-center justify-end gap-1.5">
        {tab === 'vencidas' && (canEmitir
          ? <button onClick={() => onLancarAcordo(f)} disabled={busy} className="rounded-lg bg-[#1D1D1F] px-3 py-1 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">Lançar acordo</button>
          : <AcordoBloqueado />)}
        <button onClick={() => onExpand(f.id)} className="text-[#8E8E93]"><ChevronDown size={16} className={`transition ${aberta ? 'rotate-180' : ''}`} /></button>
      </span>
    );
    return { celulas, onClick: undefined as (() => void) | undefined };
  });

  return (
    <div>
      {tab === 'rascunhos' && canEmitir && rascunhosCount(lista) > 0 && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-[#6E6E73]">
          <input type="checkbox" checked={todosSel} onChange={onToggleTudo} className="h-4 w-4 accent-[#1D1D1F]" /> Selecionar todos os rascunhos
        </div>
      )}
      {tab === 'vencidas' && canEmitir && lista.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-[#6E6E73]">
          <input type="checkbox" checked={todosVencSel} onChange={onToggleTudoVenc} className="h-4 w-4 accent-[#1D1D1F]" /> Selecionar todas as vencidas
        </div>
      )}
      <TabelaResponsiva cabecalho={cabecalho} linhas={linhas} destaque={[1, 2, 4]} />
      {/* Linhas expandidas (detalhe) */}
      {lista.filter(f => expandida === f.id).map(f => (
        <FaturaDetalhe key={f.id} f={f} tab={tab} canEmitir={canEmitir} isMaster={isMaster} busy={busy} onEmitir={onEmitir} onCancelar={onCancelar} onDemonstrativo={onDemonstrativo} onLiberar={onLiberar} onLancarAcordo={onLancarAcordo} />
      ))}
    </div>
  );
}

function rascunhosCount(lista: Row[]) { return lista.length; }

function FaturaDetalhe({ f, tab, canEmitir, isMaster, busy, onEmitir, onCancelar, onDemonstrativo, onLiberar, onLancarAcordo }: {
  f: Row; tab: FatTab; canEmitir: boolean; isMaster: boolean; busy: boolean;
  onEmitir: (f: Row) => void; onCancelar: (f: Row) => void;
  onDemonstrativo: (id: string) => void; onLiberar: (f: Row) => void; onLancarAcordo: (f: Row) => void;
}) {
  const isRascunho = String(f.situacao ?? '') === 'rascunho';
  const itens: Row[] = Array.isArray(f.itens) ? (f.itens as Row[]) : [];
  const empSit = String(f.empresa_situacao ?? '');
  const inadimplente = empSit === 'inadimplente';
  return (
    <div className="mt-2 rounded-xl border border-[#E5E5EA] bg-[#FAFAFB] p-4">
      {isRascunho ? (
        <div>
          <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Rascunho da fatura</p>
          {itens.length > 0 ? (
            <div className="mb-3 overflow-hidden rounded-lg border border-[#E5E5EA] bg-white">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-[#F5F5F7] px-3 py-2 text-[12px] font-semibold text-[#6E6E73]"><span>Item</span><span className="text-right">Qtd.</span><span className="text-right">Valor</span></div>
              {itens.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-[#F0F0F2] px-3 py-2 text-[13px] text-[#1D1D1F]">
                  <span>{String(it.nome ?? it.item ?? '—')}</span>
                  <span className="text-right tnum text-[#6E6E73]">{String(it.quantidade ?? '—')}</span>
                  <span className="text-right tnum font-medium">{moneyBR(it.valor)}</span>
                </div>
              ))}
            </div>
          ) : <p className="mb-3 text-[13px] text-[#6E6E73]">Total: <strong className="text-[#1D1D1F]">{moneyBR(f.valor_total)}</strong></p>}
          <div className="flex flex-wrap gap-2">
            {canEmitir && <button onClick={() => onEmitir(f)} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-[#1D1D1F] px-5 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin" />} Emitir</button>}
            {canEmitir && <button onClick={() => onCancelar(f)} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">Cancelar rascunho</button>}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onDemonstrativo(String(f.id))} className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><FileText size={13} /> Demonstrativo (PDF)</button>
          {f.boleto_pdf && <a href={String(f.boleto_pdf)} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><FileText size={13} /> Boleto (PDF)</a>}
          {tab === 'vencidas' && (canEmitir
            ? <button onClick={() => onLancarAcordo(f)} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">Lançar acordo</button>
            : <AcordoBloqueado />)}
          {tab === 'vencidas' && inadimplente && (
            isMaster ? (
              <button onClick={() => onLiberar(f)} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85">Liberar mesmo com fatura em aberto</button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> Só o Master libera empresa inadimplente</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

function LiberarInadimplenteModal({ fatura, onClose, onDone, setErro, setSucesso }: {
  fatura: Row; onClose: () => void; onDone: () => void; setErro: (s: string) => void; setSucesso: (s: string) => void;
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
    const { data, error: e } = await supabase.rpc('liberar_inadimplente', { empresa: fatura.empresa_id, motivo: motivo.trim(), ate });
    setBusy(false);
    if (e) { setError(e.message || friendlyError(e)); return; }
    const dataLib = (data as Row)?.data ? dateBR((data as Row).data) : '';
    setSucesso(`O acesso e os envios voltam até ${dataLib}; se não pagar até lá, bloqueia de novo.`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[440px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[#1D1D1F]">Liberar empresa inadimplente</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button>
        </div>
        <p className="text-[14px] text-[#6E6E73]">{String(fatura.empresa ?? '—')} tem a fatura de <strong className="text-[#1D1D1F]">{moneyBR(fatura.valor_total)}</strong> em aberto. Liberar mantém o acesso e os envios mesmo sem pagamento.</p>
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

function sitFaturaBadge(f: Row): { label: string; cor: string; bg: string; title?: string } {
  const s = String(f.situacao ?? '');
  if (s === 'rascunho') {
    if (String(f.emissao ?? '') === 'automatica') {
      const dt = f.emite_em ? dateBR(f.emite_em) : (f.vence_em ? dateBR(f.vence_em) : '—');
      return { label: `Sai sozinha em ${dt}`, cor: '#9a631b', bg: '#FFF3E8' };
    }
    return { label: 'Rascunho', cor: '#8E8E93', bg: '#F5F5F7' };
  }
  if (s === 'emitida') return { label: 'Emitida', cor: '#248A3D', bg: '#E8F8EC' };
  if (s === 'paga') return { label: 'Paga', cor: '#248A3D', bg: '#E8F8EC' };
  if (s === 'vencida') return { label: 'Vencida', cor: '#FF3B30', bg: '#FFE8E6' };
  if (s === 'cancelada') return { label: 'Cancelada', cor: '#8E8E93', bg: '#F5F5F7' };
  return { label: s || '—', cor: '#8E8E93', bg: '#F5F5F7' };
}

// ============================ Tab 2: Cobranças ============================

const SIT_COBRANCA: Record<string, { label: (r: Row) => string; cor: string; bg: string }> = {
  pendente: { label: (r) => r.vence_em ? `Pendente · vence ${dateBR(r.vence_em)}` : 'Pendente', cor: '#9a631b', bg: '#FFF3E8' },
  paga: { label: (r) => `Paga ${r.paga_em ? dateTimeBR(r.paga_em) : ''}`.trim(), cor: '#248A3D', bg: '#E8F8EC' },
  vencida: { label: () => 'Venceu sem pagamento', cor: '#8E8E93', bg: '#F5F5F7' },
  recusada: { label: (r) => `Recusado: ${r.motivo ?? '—'}`, cor: '#FF3B30', bg: '#FFE8E6' },
  cancelada: { label: () => 'Cancelada', cor: '#8E8E93', bg: '#F5F5F7' },
};

const FORMAS_LABEL: Record<string, string> = { boleto: 'Boleto', pix: 'Pix', cartao: 'Cartão de crédito' };

function CobrancasTab({ canEmitir, setErro, setSucesso }: { canEmitir: boolean; setErro: (s: string) => void; setSucesso: (s: string) => void }) {
  const [cobrancas, setCobrancas] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.from('cobrancas').select('*, empresas(nome)').order('criada_em', { ascending: false });
      if (error) throw error;
      setCobrancas((data ?? []) as Row[]);
    } catch (e) {
      setErro(friendlyError(e));
      setCobrancas([]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  async function marcarPaga(recargaId: string, nomeEmpresa: string) {
    if (!supabase) return;
    if (!window.confirm(`Confirmar o pagamento recebido por fora do Stripe de ${nomeEmpresa}? O boleto ou Pix pendente daquela recarga deixa de valer.`)) return;
    setBusy(true); setErro(''); setSucesso('');
    try {
      const { error } = await supabase.rpc('confirmar_recarga', { recarga: recargaId });
      if (error) throw error;
      setSucesso('Recarga marcada como paga.');
      void reload();
    } catch (e) {
      setErro(friendlyError(e));
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Cobranças</h2>
      {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
        cobrancas.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhuma cobrança.</p> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
                <th className="pb-3 font-medium">Empresa</th>
                <th className="pb-3 font-medium">Origem</th>
                <th className="pb-3 font-medium">Forma</th>
                <th className="pb-3 font-medium text-right">Valor</th>
                <th className="pb-3 font-medium">Situação</th>
                <th className="pb-3 font-medium text-right"></th>
              </tr></thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {cobrancas.map(c => {
                  const empNome = String((c.empresas as Row | undefined)?.nome ?? c.empresa ?? '—');
                  const origem = String(c.origem ?? '—') + (c.automatica ? ' · automática' : '');
                  const sit = SIT_COBRANCA[String(c.situacao ?? '')] ?? { label: () => String(c.situacao ?? '—'), cor: '#8E8E93', bg: '#F5F5F7' };
                  const isRecargaPendente = String(c.origem ?? '').startsWith('Recarga') && String(c.situacao ?? '') === 'pendente';
                  const recargaId = String(c.recarga_id ?? String(c.origem ?? '').replace(/^Recarga\s*/i, '').trim() ?? '');
                  return (
                    <tr key={c.id} className="align-middle">
                      <td className="py-3 font-medium text-[#1D1D1F]">{empNome}</td>
                      <td className="py-3 text-[#6E6E73]">{origem}</td>
                      <td className="py-3 text-[#6E6E73]">{FORMAS_LABEL[String(c.forma)] ?? c.forma ?? '—'}</td>
                      <td className="py-3 text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(c.valor)}</td>
                      <td className="py-3"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label(c)}</span></td>
                      <td className="py-3 text-right">
                        {canEmitir && isRecargaPendente && recargaId && (
                          <button onClick={() => marcarPaga(recargaId, empNome)} disabled={busy} className="rounded-lg bg-[#1D1D1F] px-3 py-1 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">Marcar como paga</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
      <p className="mt-4 text-[12px] leading-relaxed text-[#8E8E93]">
        Marcar como paga continua para o pagamento recebido por fora do Stripe; ao marcar, o boleto ou Pix pendente daquela recarga deixa de valer.
      </p>
    </section>
  );
}

// ============================ Tab 3: Notas fiscais ============================

function NotasTab({ canEmitir, setErro, setSucesso }: { canEmitir: boolean; setErro: (s: string) => void; setSucesso: (s: string) => void }) {
  const [notas, setNotas] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.from('notas_fiscais').select('*, empresas(nome)').order('criada_em', { ascending: false });
      if (error) throw error;
      setNotas((data ?? []) as Row[]);
    } catch (e) {
      setErro(friendlyError(e));
      setNotas([]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  async function emitirDeNovo(n: Row) {
    if (!supabase) return;
    setBusy(true); setErro(''); setSucesso('');
    try {
      const body: Record<string, unknown> = { acao: 'emitir_nf' };
      if (n.fatura_id) body.fatura = n.fatura_id;
      else if (n.recarga_id) body.recarga = n.recarga_id;
      const { error } = await supabase.functions.invoke('cobranca', { body });
      if (error) throw error;
      setSucesso('Nova emissão da nota iniciada.');
      void reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : friendlyError(e));
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Notas fiscais</h2>
      {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
        notas.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhuma nota fiscal.</p> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
                <th className="pb-3 font-medium">Empresa</th>
                <th className="pb-3 font-medium">Origem</th>
                <th className="pb-3 font-medium text-right">Valor</th>
                <th className="pb-3 font-medium">Situação</th>
                <th className="pb-3 font-medium text-right"></th>
              </tr></thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {notas.map(n => {
                  const empNome = String((n.empresas as Row | undefined)?.nome ?? n.empresa ?? '—');
                  const s = String(n.situacao ?? '');
                  return (
                    <tr key={n.id} className="align-middle">
                      <td className="py-3 font-medium text-[#1D1D1F]">{empNome}</td>
                      <td className="py-3 text-[#6E6E73]">{String(n.origem ?? '—')}</td>
                      <td className="py-3 text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(n.valor)}</td>
                      <td className="py-3">
                        {s === 'processando' && <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-semibold text-[#8E8E93]">Processando</span>}
                        {s === 'autorizada' && <span className="inline-flex items-center gap-2"><span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">Autorizada nº {n.numero ?? '—'}</span>{n.link_pdf && <a href={String(n.link_pdf)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[#0A60D0] hover:underline">PDF</a>}</span>}
                        {s === 'erro' && <span className="inline-flex items-center gap-2"><span className="rounded-full bg-[#FFE8E6] px-2 py-0.5 text-[11px] font-semibold text-[#FF3B30]">Erro: {n.mensagem ?? '—'}</span></span>}
                        {s === 'cancelada' && <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[11px] font-semibold text-[#8E8E93]">Cancelada</span>}
                      </td>
                      <td className="py-3 text-right">
                        {canEmitir && s === 'erro' && <button onClick={() => emitirDeNovo(n)} disabled={busy} className="rounded-lg border border-[#D2D2D7] px-3 py-1 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">Emitir de novo</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
    </section>
  );
}

// ============================ Tab 4: Configuração da nota ============================

const SIMPLES_OPTS = [
  { v: '1', label: '1 · Não optante' },
  { v: '2', label: '2 · MEI' },
  { v: '3', label: '3 · ME/EPP' },
];
const REGIME_APUR_OPTS = [
  { v: '1', label: '1 · Regime de apuração 1' },
  { v: '2', label: '2 · Regime de apuração 2' },
  { v: '3', label: '3 · Regime de apuração 3' },
];
const REGIME_ESP_OPTS = [
  { v: '0', label: '0 · Nenhum' },
  { v: '3', label: '3 · Microempresa municipal' },
  { v: '6', label: '6 · Sociedade de profissionais' },
  { v: '9', label: '9 · Outros' },
];
const RETENCAO_OPTS = [
  { v: '1', label: '1 · Não retido' },
  { v: '2', label: '2 · Retido pelo tomador' },
];

const CAMPOS_OBRIG: { key: string; label: string }[] = [
  { key: 'razao_social', label: 'Razão social do prestador' },
  { key: 'cnpj', label: 'CNPJ do prestador' },
  { key: 'endereco', label: 'Endereço do prestador' },
  { key: 'email_financeiro', label: 'E-mail do financeiro' },
  { key: 'inscricao_municipal', label: 'Inscrição municipal' },
  { key: 'municipio_ibge', label: 'Município emissor' },
  { key: 'municipio_prestacao_ibge', label: 'Município da prestação' },
  { key: 'codigo_tributacao_nacional', label: 'Código de tributação nacional do ISS' },
  { key: 'codigo_tributacao_municipal', label: 'Código de tributação municipal' },
  { key: 'codigo_nbs', label: 'Código NBS' },
  { key: 'simples_nacional', label: 'Simples Nacional' },
  { key: 'retencao_iss', label: 'Retenção do ISS' },
  { key: 'aliquota_iss', label: 'Alíquota do ISS' },
  { key: 'descricao_fatura', label: 'Descrição na nota da fatura' },
  { key: 'descricao_recarga', label: 'Descrição na nota da recarga' },
];

function ConfigNotaTab({ isMaster, setErro, setSucesso }: { isMaster: boolean; setErro: (s: string) => void; setSucesso: (s: string) => void }) {
  const [cfg, setCfg] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.from('nf_config').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      setCfg((data as Row) ?? null);
    } catch (e) {
      setErro(friendlyError(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  function set<K extends string>(k: K, v: unknown) { setCfg(prev => prev ? { ...prev, [k]: v } : prev); }

  const faltam = cfg ? CAMPOS_OBRIG.filter(c => {
    const v = cfg[c.key];
    const empty = v == null || String(v).trim() === '';
    if (empty) return true;
    if (c.key === 'simples_nacional' && String(v) === '3' && !cfg.regime_apuracao) return true;
    return false;
  }).map(c => c.label) : [];

  async function salvar() {
    if (!supabase || !cfg) return;
    setBusy(true); setErro(''); setSucesso('');
    try {
      const { error } = await supabase.from('nf_config').update({
        ativo: !!cfg.ativo,
        ambiente: cfg.ambiente ?? 'homologacao',
        quando_emitir: cfg.quando_emitir ?? 'pagamento',
        razao_social: cfg.razao_social ?? null,
        cnpj: cfg.cnpj ? String(cfg.cnpj).replace(/\D/g, '') : null,
        endereco: cfg.endereco ?? null,
        email_financeiro: cfg.email_financeiro ?? null,
        inscricao_municipal: cfg.inscricao_municipal ?? null,
        municipio_ibge: cfg.municipio_ibge ?? null,
        municipio_prestacao_ibge: cfg.municipio_prestacao_ibge ?? null,
        codigo_tributacao_nacional: cfg.codigo_tributacao_nacional ?? null,
        codigo_tributacao_municipal: cfg.codigo_tributacao_municipal ?? null,
        codigo_nbs: cfg.codigo_nbs ?? null,
        simples_nacional: cfg.simples_nacional ?? null,
        regime_apuracao: cfg.simples_nacional === '3' ? (cfg.regime_apuracao ?? null) : null,
        regime_especial: cfg.regime_especial ?? '0',
        retencao_iss: cfg.retencao_iss ?? null,
        aliquota_iss: cfg.aliquota_iss ?? null,
        descricao_fatura: cfg.descricao_fatura ?? null,
        descricao_recarga: cfg.descricao_recarga ?? null,
      }).eq('id', 1);
      if (error) throw error;
      setSucesso('Configuração da nota salva.');
      void reload();
    } catch (e) {
      setErro(friendlyError(e));
    } finally { setBusy(false); }
  }

  if (loading) return <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;
  if (!cfg) return <p className="py-10 text-center text-[14px] text-[#8E8E93]">Sem configuração de nota.</p>;

  const ambiente = String(cfg.ambiente ?? 'homologacao');
  const readOnly = !isMaster;

  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Configuração da nota</h2>
        <span className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: ambiente === 'producao' ? '#E8F8EC' : '#FFF3E8', color: ambiente === 'producao' ? '#248A3D' : '#9a631b' }}>
          {ambiente === 'producao' ? 'Produção' : 'Homologação (teste)'}
        </span>
      </div>

      {!isMaster && <p className="mb-4 rounded-xl bg-[#F5F5F7] px-4 py-3 text-[13px] text-[#6E6E73]">Só o Master edita a configuração da nota. Você está vendo em modo leitura.</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <SwitchLinha label="Emitir nota" desc="Liga a emissão de NFS-e para faturas e recargas." checked={!!cfg.ativo} on={v => set('ativo', v)} readOnly={readOnly} />
        <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Ambiente</span><select disabled={readOnly} value={ambiente} onChange={e => set('ambiente', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]"><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></label>
        <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Quando emitir a nota da fatura</span><select disabled={readOnly} value={String(cfg.quando_emitir ?? 'pagamento')} onChange={e => set('quando_emitir', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]"><option value="pagamento">No pagamento</option><option value="emissao">Na emissão da fatura</option></select></label>
        <In label="Razão social do prestador" v={String(cfg.razao_social ?? '')} on={v => set('razao_social', v)} readOnly={readOnly} />
        <In label="CNPJ do prestador (só números)" v={String(cfg.cnpj ?? '')} on={v => set('cnpj', v.replace(/\D/g, '').slice(0, 14))} readOnly={readOnly} inputMode="numeric" />
        <In label="Endereço do prestador" v={String(cfg.endereco ?? '')} on={v => set('endereco', v)} readOnly={readOnly} />
        <In label="E-mail do financeiro (remetente das faturas)" v={String(cfg.email_financeiro ?? '')} on={v => set('email_financeiro', v)} readOnly={readOnly} />
        <In label="Inscrição municipal" v={String(cfg.inscricao_municipal ?? '')} on={v => set('inscricao_municipal', v)} readOnly={readOnly} />
        <In label="Município emissor (código IBGE, 7 dígitos)" v={String(cfg.municipio_ibge ?? '')} on={v => set('municipio_ibge', v.replace(/\D/g, '').slice(0, 7))} readOnly={readOnly} inputMode="numeric" />
        <In label="Município da prestação (código IBGE, 7 dígitos)" v={String(cfg.municipio_prestacao_ibge ?? '')} on={v => set('municipio_prestacao_ibge', v.replace(/\D/g, '').slice(0, 7))} readOnly={readOnly} inputMode="numeric" />
        <In label="Código de tributação nacional do ISS (6 dígitos)" v={String(cfg.codigo_tributacao_nacional ?? '')} on={v => set('codigo_tributacao_nacional', v.replace(/\D/g, '').slice(0, 6))} readOnly={readOnly} inputMode="numeric" />
        <In label="Código de tributação municipal (3)" v={String(cfg.codigo_tributacao_municipal ?? '')} on={v => set('codigo_tributacao_municipal', v.replace(/\D/g, '').slice(0, 3))} readOnly={readOnly} inputMode="numeric" />
        <In label="Código NBS (9)" v={String(cfg.codigo_nbs ?? '')} on={v => set('codigo_nbs', v.replace(/\D/g, '').slice(0, 9))} readOnly={readOnly} inputMode="numeric" />
        <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Simples Nacional</span><select disabled={readOnly} value={String(cfg.simples_nacional ?? '')} onChange={e => set('simples_nacional', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]"><option value="">—</option>{SIMPLES_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
        {String(cfg.simples_nacional ?? '') === '3' && (
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Regime de apuração</span><select disabled={readOnly} value={String(cfg.regime_apuracao ?? '')} onChange={e => set('regime_apuracao', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]"><option value="">—</option>{REGIME_APUR_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
        )}
        <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Regime especial</span><select disabled={readOnly} value={String(cfg.regime_especial ?? '0')} onChange={e => set('regime_especial', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]">{REGIME_ESP_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Retenção do ISS</span><select disabled={readOnly} value={String(cfg.retencao_iss ?? '')} onChange={e => set('retencao_iss', e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]"><option value="">—</option>{RETENCAO_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
        <In label="Alíquota do ISS (%)" v={String(cfg.aliquota_iss ?? '')} on={v => set('aliquota_iss', v)} readOnly={readOnly} inputMode="decimal" />
        <label className="block sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Descrição na nota da fatura</span><textarea disabled={readOnly} value={String(cfg.descricao_fatura ?? '')} onChange={e => set('descricao_fatura', e.target.value)} rows={2} className="w-full rounded-lg border border-[#D2D2D7] bg-white px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]" /></label>
        <label className="block sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Descrição na nota da recarga</span><textarea disabled={readOnly} value={String(cfg.descricao_recarga ?? '')} onChange={e => set('descricao_recarga', e.target.value)} rows={2} className="w-full rounded-lg border border-[#D2D2D7] bg-white px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]" /></label>
      </div>

      {cfg.ativo && faltam.length > 0 && (
        <p className="mt-4 rounded-xl bg-[#FFF3E8] px-4 py-3 text-[13px] text-[#9a631b]">Para ligar a nota, falta: {faltam.join(', ')}.</p>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-[#8E8E93]">Preencha com o contador. Enquanto estiver em Homologação, as notas são de teste e não valem para a Receita.</p>

      {isMaster && (
        <div className="mt-5 flex justify-end">
          <button onClick={salvar} disabled={busy} className="flex h-10 items-center gap-2 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin" />}{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      )}
    </section>
  );
}

// ---------- subcomponentes ----------

function In({ label, v, on, readOnly, inputMode }: { label: string; v: string; on: (v: string) => void; readOnly?: boolean; inputMode?: 'text' | 'numeric' | 'decimal' }) {
  return <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{label}</span><input value={v} onChange={e => on(e.target.value)} disabled={readOnly} inputMode={inputMode} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]" /></label>;
}

function SwitchLinha({ label, desc, checked, on, readOnly }: { label: string; desc: string; checked: boolean; on: (v: boolean) => void; readOnly?: boolean }) {
  return (
    <Chave
      className="rounded-lg border border-[#E5E5EA] px-4 py-3"
      label={<span className="text-[15px] font-medium text-[#1D1D1F]">{label}</span>}
      desc={desc}
      checked={checked}
      on={on}
      readOnly={readOnly}
    />
  );
}
