import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Lock, Send } from 'lucide-react';
import { supabase, friendlyError, moneyBR, dateBR, dateTimeBR, today, type Row } from '@/lib/supabase';
import { mesExtenso, mesCurto } from '@/lib/empresa-helpers';
import { cardShadow } from './console-shell';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { TabelaResponsiva, type LinhaTabela } from '@/components/comuns/tabela-responsiva';

// ============================ Aba Acordos ============================
//
// rpc acordos() → linhas com: empresa, empresa_id, id, situacao, parcelas,
// pagas, valor_total, valor_faturas, ajuste, ajuste_motivo, formas[],
// informado_em, proxima_vencimento, proxima_valor, dias_atraso, quebra_em,
// valor_restante, faturas[{competencia, valor}], parcelas_detalhe[{numero,
// tipo, vencimento, valor, situacao, paga_em, link_nota_fiscal}].

const SIT_ACORDO: Record<string, { label: (r: Row) => string; cor: string; bg: string }> = {
  em_dia: { label: () => 'Em dia', cor: '#248A3D', bg: '#E8F8EC' },
  parcela_vencida: { label: (r) => `Parcela vencida há ${Number(r.dias_atraso ?? 0)} dia(s)`, cor: '#9a631b', bg: '#FFF3E8' },
  quebrado: { label: () => 'Quebrado', cor: '#FF3B30', bg: '#FFE8E6' },
  quitado: { label: () => 'Quitado', cor: '#8E8E93', bg: '#F5F5F7' },
  cancelado: { label: () => 'Cancelado', cor: '#8E8E93', bg: '#F5F5F7' },
};

export function AcordosTab({ setErro, setSucesso }: { setErro: (s: string) => void; setSucesso: (s: string) => void }) {
  const [acordos, setAcordos] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalhe, setDetalhe] = useState<Row | null>(null);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.rpc('acordos');
      if (error) throw error;
      setAcordos((data as Row[]) ?? []);
    } catch (e) {
      setErro(friendlyError(e));
      setAcordos([]);
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  const linhas: LinhaTabela[] = acordos.map(a => {
    const sit = SIT_ACORDO[String(a.situacao ?? '')] ?? { label: () => String(a.situacao ?? '—'), cor: '#8E8E93', bg: '#F5F5F7' };
    const parcelas = Number(a.parcelas ?? 0);
    const pagas = Number(a.pagas ?? 0);
    const prox = proximaTexto(a);
    const celulas: React.ReactNode[] = [];
    celulas.push(<span className="font-medium text-[#1D1D1F]">{String(a.empresa ?? '—')}</span>);
    celulas.push(<span className="inline-flex items-center gap-1.5"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label(a)}</span>{String(a.situacao ?? '') === 'parcela_vencida' && Number(a.dias_atraso ?? 0) >= 0 && <span className="text-[11px] font-semibold text-[#FF3B30]">quebra em {Number(a.quebra_em ?? 0)} dia(s)</span>}</span>);
    celulas.push(<span className="tnum text-[#6E6E73]">{pagas} de {parcelas} pagas</span>);
    celulas.push(<span className="font-semibold text-[#1D1D1F] tnum">{moneyBR(a.valor_total)}</span>);
    celulas.push(<span className="text-[13px] text-[#6E6E73]">{prox}</span>);
    celulas.push(<button onClick={() => setDetalhe(a)} className="rounded-lg border border-[#D2D2D7] px-3 py-1 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Ver</button>);
    return { celulas, onClick: undefined };
  });

  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Acordos</h2>
      {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
        acordos.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhum acordo.</p> :
          <TabelaResponsiva cabecalho={['Empresa', 'Situação', 'Parcelas', 'Valor', 'Próxima', '']} linhas={linhas} destaque={[0, 1, 3]} />}
      {detalhe && (
        <AcordoDetalheModal
          acordo={detalhe}
          onClose={() => setDetalhe(null)}
          onDone={() => { setDetalhe(null); void reload(); }}
          setErro={setErro}
          setSucesso={setSucesso}
        />
      )}
    </section>
  );
}

function proximaTexto(a: Row): string {
  const sit = String(a.situacao ?? '');
  if (sit === 'quitado' || sit === 'cancelado') return '—';
  if (sit === 'quebrado') {
    const restante = Number(a.valor_restante ?? 0);
    return restante > 0 ? `saldo de ${moneyBR(restante)} em cobrança` : '—';
  }
  if (sit === 'parcela_vencida') {
    return `quebra em ${Number(a.quebra_em ?? 0)} dia(s)`;
  }
  // em_dia
  if (a.proxima_vencimento) return `${dateBR(a.proxima_vencimento)} · ${moneyBR(a.proxima_valor)}`;
  return '—';
}

// ============================ Detalhe do acordo ============================

function AcordoDetalheModal({ acordo, onClose, onDone, setErro, setSucesso }: {
  acordo: Row; onClose: () => void; onDone: () => void; setErro: (s: string) => void; setSucesso: (s: string) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [confirmaCancelar, setConfirmaCancelar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [erroLocal, setErroLocal] = useState('');

  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  const faturas: Row[] = Array.isArray(acordo.faturas) ? (acordo.faturas as Row[]) : [];
  const parcelas: Row[] = Array.isArray(acordo.parcelas_detalhe) ? (acordo.parcelas_detalhe as Row[]) : [];
  const formas: string[] = Array.isArray(acordo.formas) ? (acordo.formas as string[]) : [];
  const ajuste = Number(acordo.ajuste ?? 0);
  const sit = String(acordo.situacao ?? '');
  const temParcelaPaga = parcelas.some(p => String(p.situacao ?? '') === 'paga');
  const podeCancelar = (sit === 'em_dia' || sit === 'parcela_vencida') && !temParcelaPaga;

  async function enviarEmail() {
    if (!supabase) return;
    setEnviando(true); setErroLocal('');
    try {
      const { error } = await supabase.functions.invoke('cobranca', { body: { acao: 'informar_acordo', acordo: acordo.id } });
      if (error) throw error;
      setSucesso('E-mail com as parcelas enviado.');
      onDone();
    } catch (e) {
      setErroLocal(e instanceof Error ? e.message : friendlyError(e));
    } finally { setEnviando(false); }
  }

  async function cancelar() {
    if (!supabase) return;
    setErroLocal('');
    if (motivo.trim().length < 5) { setErroLocal('Informe o motivo (5+ caracteres).'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('cancelar_acordo', { acordo: acordo.id, motivo: motivo.trim() });
      if (error) throw error;
      setSucesso('Acordo cancelado. As faturas voltam a vencidas.');
      setConfirmaCancelar(false);
      onDone();
    } catch (e) {
      setErroLocal(friendlyError(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[640px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[#1D1D1F]">Acordo · {String(acordo.empresa ?? '—')}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button>
        </div>

        {/* Faturas que entraram no acordo */}
        <div className="mb-4">
          <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Faturas no acordo</p>
          {faturas.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-[#E5E5EA]">
              {faturas.map((f, i) => (
                <div key={i} className="flex items-center justify-between gap-3 border-b border-[#F0F0F2] px-3 py-2 text-[13px] last:border-0">
                  <span className="text-[#1D1D1F]">{f.competencia ? mesExtenso(f.competencia) : '—'}</span>
                  <span className="font-medium text-[#1D1D1F] tnum">{moneyBR(f.valor_total)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[13px] text-[#8E8E93]">—</p>}
        </div>

        {/* Ajuste e formas */}
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#E5E5EA] px-3 py-2">
            <p className="text-[12px] text-[#6E6E73]">{ajuste < 0 ? 'Desconto' : 'Acréscimo'}</p>
            <p className="text-[15px] font-semibold text-[#1D1D1F] tnum">{moneyBR(Math.abs(ajuste))}</p>
            {acordo.ajuste_motivo && <p className="mt-0.5 text-[12px] text-[#8E8E93]">Motivo: {String(acordo.ajuste_motivo)}</p>}
          </div>
          <div className="rounded-lg border border-[#E5E5EA] px-3 py-2">
            <p className="text-[12px] text-[#6E6E73]">Formas aceitas</p>
            <p className="text-[15px] font-semibold text-[#1D1D1F]">{formas.length ? formas.map(f => FORMAS_LABEL[f] ?? f).join(', ') : '—'}</p>
          </div>
        </div>

        {/* Informado */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F5F5F7] px-3 py-2">
          <span className="text-[13px] text-[#1D1D1F]">Informado ao cliente: <strong>{acordo.informado_em ? dateTimeBR(acordo.informado_em) : 'não informado'}</strong></span>
          {!acordo.informado_em && (
            <button onClick={enviarEmail} disabled={enviando} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">
              {enviando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar e-mail agora
            </button>
          )}
        </div>

        {/* Parcelas */}
        <div className="mb-4">
          <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Parcelas</p>
          <div className="overflow-hidden rounded-lg border border-[#E5E5EA]">
            <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 bg-[#F5F5F7] px-3 py-2 text-[12px] font-semibold text-[#6E6E73]">
              <span>#</span><span>Tipo</span><span className="text-right">Vencimento</span><span className="text-right">Valor</span><span className="text-right">Situação</span>
            </div>
            {parcelas.map((p, i) => {
              const tipo = String(p.tipo ?? 'parcela');
              const pSit = String(p.situacao ?? '');
              return (
                <div key={i} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 border-b border-[#F0F0F2] px-3 py-2 text-[13px] last:border-0">
                  <span className="tnum text-[#6E6E73]">{Number(p.numero ?? i + 1)}</span>
                  <span className="text-[#1D1D1F]">{tipo === 'saldo' ? 'Saldo do acordo' : 'Parcela'}</span>
                  <span className="text-right tnum text-[#6E6E73]">{p.vencimento ? dateBR(p.vencimento) : '—'}</span>
                  <span className="text-right tnum font-medium text-[#1D1D1F]">{moneyBR(p.valor)}</span>
                  <span className="text-right">
                    {pSit === 'paga' ? <span className="text-[12px] font-semibold text-[#248A3D]">Paga{p.paga_em ? ` ${dateBR(p.paga_em)}` : ''}</span>
                      : pSit === 'vencida' ? <span className="text-[12px] font-semibold text-[#FF3B30]">Vencida</span>
                      : <span className="text-[12px] font-medium text-[#8E8E93]">Em aberto</span>}
                    {p.link_nota_fiscal && <a href={String(p.link_nota_fiscal)} target="_blank" rel="noreferrer" className="ml-2 text-[12px] font-semibold text-[#0A60D0] hover:underline">NFS-e</a>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {erroLocal && <p role="alert" className="mb-3 text-[14px] text-[#FF3B30]">{erroLocal}</p>}

        {/* Cancelar */}
        <div className="flex justify-end">
          {podeCancelar ? (
            <button onClick={() => setConfirmaCancelar(true)} className="flex h-9 items-center gap-2 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-semibold text-[#FF3B30] hover:bg-[#FFE8E6]">Cancelar acordo</button>
          ) : temParcelaPaga ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1.5 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> Acordo com parcela paga não é cancelado: segue até quitar ou quebrar.</span>
          ) : null}
        </div>

        {confirmaCancelar && (
          <ConfirmaAcao
            aberto
            titulo="Cancelar acordo"
            texto={
              <div className="space-y-2">
                <p>As faturas voltam a vencidas e a régua de lembretes e bloqueio volta a contar.</p>
                <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Motivo *</span><textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} maxLength={200} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="Por que cancelar" /></label>
              </div>
            }
            botao="Cancelar o acordo"
            loading={busy}
            onConfirm={cancelar}
            onClose={() => { setConfirmaCancelar(false); setErroLocal(''); }}
          />
        )}
      </div>
    </div>
  );
}

// ============================ Lançar acordo (modal) ============================

const PARCELAS_OPTS = [1, 2, 3, 4, 6, 12];
const FORMAS_LABEL: Record<string, string> = { boleto: 'Boleto', pix: 'Pix', cartao: 'Cartão' };

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function addMonthsISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() + n);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function LancarAcordoModal({ empresaId, empresaNome, preSelecionadas, onClose, onDone, setErro, setSucesso }: {
  empresaId: string; empresaNome: string; preSelecionadas: string[];
  onClose: () => void; onDone: () => void; setErro: (s: string) => void; setSucesso: (s: string) => void;
}) {
  const [faturas, setFaturas] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionadas, setSelecionadas] = useState<Record<string, boolean>>({});
  const [tipoAjuste, setTipoAjuste] = useState<'desconto' | 'acrescimo'>('desconto');
  const [valorAjuste, setValorAjuste] = useState('');
  const [parcelas, setParcelas] = useState(3);
  const [primeira, setPrimeira] = useState(addDaysISO(today(), 5));
  const [motivo, setMotivo] = useState('');
  const [formas, setFormas] = useState<string[]>(['pix', 'boleto']);
  const [informar, setInformar] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirma, setConfirma] = useState(false);
  const [erroLocal, setErroLocal] = useState('');

  const minPrimeira = today();
  const maxPrimeira = addDaysISO(today(), 30);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('faturas_painel').select('*').eq('empresa_id', empresaId).in('situacao_atual', ['aberta', 'vencida']);
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        // só as sem acordo
        const elegiveis = rows.filter(r => !r.acordo_id);
        if (!active) return;
        setFaturas(elegiveis);
        const sel: Record<string, boolean> = {};
        elegiveis.forEach(f => { if (preSelecionadas.includes(f.id)) sel[f.id] = true; });
        // se nenhuma pré-selecionada, marca todas
        if (Object.keys(sel).length === 0 && elegiveis.length > 0) elegiveis.forEach(f => { sel[f.id] = true; });
        setSelecionadas(sel);
      } catch (e) {
        setErroLocal(friendlyError(e));
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [empresaId]);

  const soma = useMemo(() => faturas.filter(f => selecionadas[f.id]).reduce((s, f) => s + Number(f.valor_total ?? 0), 0), [faturas, selecionadas]);
  const ajusteValor = (() => {
    let s = String(valorAjuste).trim();
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  })();
  const ajuste = tipoAjuste === 'desconto' ? -Math.abs(ajusteValor) : Math.abs(ajusteValor);
  const total = soma + ajuste;
  const totalCentavos = Math.round(total * 100);

  const parcelaValores = useMemo(() => {
    if (parcelas <= 0) return [];
    const base = Math.floor(totalCentavos / parcelas);
    const resto = totalCentavos - base * parcelas;
    return Array.from({ length: parcelas }, (_, i) => (base + (i === 0 ? resto : 0)) / 100);
  }, [totalCentavos, parcelas]);

  const parcelaMinima = parcelaValores.length > 0 ? Math.min(...parcelaValores) : 0;
  const parcelaBaixa = parcelaMinima > 0 && parcelaMinima < 5;
  const temAjuste = ajusteValor > 0;
  const motivoValido = motivo.trim().length >= 5;
  const formasOk = formas.length > 0;
  const faturasOk = Object.values(selecionadas).some(Boolean);
  const podeLancar = faturasOk && formasOk && !parcelaBaixa && total > 0 && (!temAjuste || motivoValido);

  function toggleForma(f: string) {
    setFormas(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }
  function toggleFatura(id: string) {
    setSelecionadas(prev => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  }

  async function confirmar() {
    if (!supabase) return;
    setBusy(true); setErroLocal('');
    const fatIds = faturas.filter(f => selecionadas[f.id]).map(f => f.id);
    try {
      const { data: rid, error } = await supabase.rpc('lancar_acordo', {
        empresa: empresaId, faturas: fatIds, parcelas, primeira, formas, ajuste, motivo: temAjuste ? motivo.trim() : null, informar,
      });
      if (error) throw error;
      const id = typeof rid === 'string' ? rid : String((rid as Row)?.id ?? rid ?? '');
      let msg = 'Acordo lançado. Ficou na Auditoria.';
      if (informar && id) {
        try {
          const { error: e2 } = await supabase.functions.invoke('cobranca', { body: { acao: 'informar_acordo', acordo: id } });
          if (e2) throw e2;
          msg = 'Acordo lançado. Cliente informado por e-mail e no sino; ficou na Auditoria.';
        } catch (e2) {
          msg = `Acordo lançado. O e-mail não saiu agora: ${e2 instanceof Error ? e2.message : friendlyError(e2)}. O sistema tenta de novo sozinho. Ficou na Auditoria.`;
        }
      }
      setSucesso(msg);
      setConfirma(false);
      onDone();
    } catch (e) {
      setErroLocal(friendlyError(e));
    } finally { setBusy(false); }
  }

  const mesesSel = faturas.filter(f => selecionadas[f.id]).map(f => f.competencia ? mesExtenso(f.competencia) : '—');

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[560px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-[#1D1D1F]">Lançar acordo · {empresaNome}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button>
        </div>

        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
          <div className="space-y-5">
            {/* Faturas que entram no acordo */}
            <div>
              <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Faturas que entram no acordo</p>
              {faturas.length === 0 ? <p className="text-[13px] text-[#8E8E93]">Nenhuma fatura em aberto ou vencida sem acordo.</p> : (
                <div className="space-y-1.5">
                  {faturas.map(f => {
                    const sel = !!selecionadas[f.id];
                    const vencida = String(f.situacao_atual ?? '') === 'vencida';
                    return (
                      <label key={f.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${sel ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA]'}`}>
                        <input type="checkbox" checked={sel} onChange={() => toggleFatura(f.id)} className="h-4 w-4 accent-[#1D1D1F]" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium text-[#1D1D1F]">{f.competencia ? mesCurto(f.competencia) : '—'} · {moneyBR(f.valor_total)}</p>
                          {vencida && <p className="text-[12px] text-[#FF3B30]">Venceu em {f.vence_em ? dateBR(f.vence_em) : '—'} · {Number(f.dias_atraso ?? 0)} dia(s) de atraso</p>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              <p className="mt-2 text-[12px] leading-relaxed text-[#8E8E93]">Só faturas em aberto ou vencidas. Fatura em acordo sai de Vencidas e não gera lembrete nem bloqueio.</p>
            </div>

            {/* Condições */}
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-[#1D1D1F]">Condições</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Desconto / Acréscimo</span>
                  <div className="flex gap-1.5">
                    <select value={tipoAjuste} onChange={e => setTipoAjuste(e.target.value as 'desconto' | 'acrescimo')} className="h-10 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[14px] outline-none focus:border-[#1D1D1F]">
                      <option value="desconto">Desconto</option>
                      <option value="acrescimo">Acréscimo</option>
                    </select>
                    <input value={valorAjuste} onChange={e => setValorAjuste(e.target.value)} inputMode="decimal" placeholder="0,00" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">1ª parcela</span>
                  <input type="date" value={primeira} min={minPrimeira} max={maxPrimeira} onChange={e => setPrimeira(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" />
                </label>
              </div>

              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Parcelas</span>
                <div className="flex flex-wrap gap-1.5">
                  {PARCELAS_OPTS.map(n => (
                    <button key={n} type="button" onClick={() => setParcelas(n)} className={`h-9 w-9 rounded-lg text-[14px] font-semibold transition-colors ${parcelas === n ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{n}</button>
                  ))}
                </div>
              </div>

              {temAjuste && (
                <label className="block">
                  <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Motivo do {tipoAjuste === 'desconto' ? 'desconto' : 'acréscimo'} (o cliente não vê) *</span>
                  <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} maxLength={200} className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="Por que" />
                </label>
              )}

              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Formas aceitas</span>
                <div className="flex flex-wrap gap-1.5">
                  {(['pix', 'boleto', 'cartao'] as const).map(f => (
                    <button key={f} type="button" onClick={() => toggleForma(f)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${formas.includes(f) ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{FORMAS_LABEL[f]}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Resumo */}
            <div className="rounded-xl bg-[#F5F5F7] p-4">
              <div className="mb-2 flex items-center justify-between text-[14px]">
                <span className="text-[#6E6E73]">{moneyBR(soma)} em aberto</span>
                <span className="font-semibold text-[#1D1D1F] tnum">{moneyBR(total)} no acordo</span>
              </div>
              {parcelaValores.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-[#E5E5EA] bg-white">
                  {parcelaValores.map((v, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 border-b border-[#F0F0F2] px-3 py-1.5 text-[13px] last:border-0">
                      <span className="tnum text-[#6E6E73]">Parcela {i + 1}</span>
                      <span className="tnum text-[#6E6E73]">{dateBR(addMonthsISO(primeira, i))}</span>
                      <span className="tnum font-medium text-[#1D1D1F]">{moneyBR(v)}</span>
                    </div>
                  ))}
                </div>
              )}
              {parcelaBaixa && <p className="mt-2 text-[13px] text-[#FF3B30]">Parcela abaixo de R$ 5,00. Aumente o valor ou reduza as parcelas.</p>}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <input type="checkbox" checked={informar} onChange={e => setInformar(e.target.checked)} className="h-4 w-4 accent-[#1D1D1F]" />
              <span className="text-[14px] text-[#1D1D1F]">Informar o cliente agora: e-mail para quem recebe faturas e aviso no sino</span>
            </label>

            {erroLocal && <p role="alert" className="text-[14px] text-[#FF3B30]">{erroLocal}</p>}

            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
              <button onClick={() => setConfirma(true)} disabled={!podeLancar} className="flex h-10 items-center gap-2 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">Lançar acordo</button>
            </div>
          </div>
        )}

        {confirma && (
          <ConfirmaAcao
            aberto
            titulo="Lançar acordo"
            texto={
              <div className="space-y-1.5">
                <p>Lançar o acordo de <strong>{moneyBR(total)}</strong> em {parcelas} parcela(s) para a <strong>{empresaNome}</strong>?</p>
                <p>As faturas de {mesesSel.join(', ')} ficam "Em acordo", a empresa é liberada enquanto as parcelas estiverem em dia{informar ? ' e o e-mail com as parcelas sai para quem recebe faturas.' : '.'}</p>
              </div>
            }
            botao={`Lançar acordo de ${moneyBR(total)}`}
            loading={busy}
            onConfirm={confirmar}
            onClose={() => setConfirma(false)}
          />
        )}
      </div>
    </div>
  );
}

/** Etiqueta com cadeado para quem não pode lançar acordo. */
export function AcordoBloqueado() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> Só Master e Administrativo lançam acordo</span>
  );
}
