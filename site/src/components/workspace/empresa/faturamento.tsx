import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { X, FileText, ExternalLink, Plus, CreditCard, Copy, Check, Loader2, Lock } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, moneyBR, dateBR, dateTimeBR, today, type Row } from '@/lib/supabase';
import { SIT_FATURA, mesExtenso, mesCurto } from '@/lib/empresa-helpers';
import { EmpresaShell, cardShadow } from './empresa-shell';
import { AgenteVozFaturamento } from './faturamento-voz';

// ---------- contrato da Edge Function "cobranca" ----------
//
// Toda chamada passa por supabase.functions.invoke('cobranca', { body }).
// A função devolve { erro: string } (já em português) quando algo impede a ação,
// ou o payload descrito abaixo. Erros de rede/HTTP viram mensagem genérica.
//
//   { acao: 'painel' }
//     → { modelo: 'pos'|'pre', ciclo: { inicio, fim, competencia } | null,
//         fatura_aberta: Fatura | null, faturas: Fatura[],
//         saldo: { saldo, recargas_pagas, uso, abaixo_do_aviso, pausar_envios,
//                  recarga_minima } | null,
//         recargas: Recarga[],
//         cartao: { bandeira, final, validade } | null,
//         recarga_automatica: boolean, aviso_saldo: number|null,
//         recarga_minima: number|null,
//         dados: { cnpj: string|null, email_financeiro: string|null, formas: string[] } }
//
//   { acao: 'pagar', fatura?: id, recarga?: id, forma: 'boleto'|'pix'|'cartao' }
//     → { cobranca: { link, pix_copia_cola, boleto_codigo, expira_em } }
//
//   { acao: 'demonstrativo', fatura: id }
//     → { url: string }
//
//   Fatura = { id, numero?, mes?, competencia?, ciclo_inicio, ciclo_fim, valor,
//              vencimento?, situacao: 'aberta'|'vencida'|'paga'|'cancelada',
//              paga_em?, forma?, boleto_pdf?: string|null,
//              nota?: { numero, link_pdf, situacao } | null }
//   Recarga = { id, pedida_em, forma, valor, automatica: boolean,
//               situacao: 'paga'|'aguardando'|'venceu'|'cancelada',
//               nota?: { numero, link_pdf } | null }

const FORMAS_LABEL: Record<string, string> = {
  boleto: 'Boleto',
  pix: 'Pix',
  cartao: 'Cartão de crédito',
};

const FORMAS_DESC: Record<string, string> = {
  boleto: 'Vence junto com a fatura',
  pix: 'QR Code vale 24 horas',
  cartao: 'Página segura do Stripe',
};

const SIT_RECARGA: Record<string, { label: string; cor: string; bg: string }> = {
  paga: { label: 'Paga', cor: '#248A3D', bg: '#E8F8EC' },
  aguardando: { label: 'Aguardando pagamento', cor: '#9a631b', bg: '#FFF3E8' },
  venceu: { label: 'Venceu sem pagamento', cor: '#FF3B30', bg: '#FFE8E6' },
  cancelada: { label: 'Cancelada', cor: '#8E8E93', bg: '#F5F5F7' },
};

/** Nome do mês a partir de uma competência (YYYY-MM ou data ISO) ou string já pronta. */
function mesFatura(f: Row): string {
  if (f.competencia) return mesCurto(f.competencia);
  return '—';
}

/** Número curto da fatura para "nº {id}". */
function numFatura(f: Row): string {
  return f.numero ? String(f.numero) : String(f.id ?? '').slice(0, 8);
}

type Pagamento = {
  chave: string; // `${tipo}:${id}` (fatura ou recarga)
  forma: 'boleto' | 'pix' | 'cartao';
  link?: string | null;
  pix_copia_cola?: string | null;
  boleto_codigo?: string | null;
  expira_em?: string | null;
};

export function FaturamentoPage() {
  const { empresa, perfil, permissoes } = useMotorAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [painel, setPainel] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [pagamento, setPagamento] = useState<Pagamento | null>(null);
  const [pagando, setPagando] = useState<string | null>(null); // chave da fatura/recarga em pagamento
  const [sucessoCartao, setSucessoCartao] = useState(false);
  const [recargaOpen, setRecargaOpen] = useState(false);
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [estimativa, setEstimativa] = useState<Row | null>(null);
  const [duracao, setDuracao] = useState<Row | null>(null);
  const [extrato, setExtrato] = useState<Row[]>([]);
  const [acordos, setAcordos] = useState<Row[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ?fatura=ID (Início › Para hoje, aviso no sino): destaca a fatura e rola até ela.
  const faturaDestaque = searchParams.get('fatura');

  const isPre = painel?.modelo === 'pre';

  /** Chama a Edge Function cobranca. Lança Error com a mensagem a mostrar. */
  const chamar = useCallback(async (body: Record<string, unknown>): Promise<Row> => {
    if (!supabase) throw new Error('Configuração ausente.');
    const { data, error } = await supabase.functions.invoke('cobranca', { body });
    if (error) throw new Error(friendlyError(error));
    if (data && typeof (data as Row).erro === 'string' && (data as Row).erro) {
      throw new Error((data as Row).erro as string);
    }
    return (data ?? {}) as Row;
  }, []);

  const recarregarPainel = useCallback(async (silent = false) => {
    if (!empresa) return;
    if (!silent) setLoading(true);
    try {
      const data = await chamar({ acao: 'painel' });
      setPainel(data);
      setErro('');
    } catch (e) {
      if (!silent) setErro(e instanceof Error ? e.message : 'Não foi possível carregar o faturamento.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [empresa, chamar]);

  useEffect(() => { void recarregarPainel(); }, [recarregarPainel]);

  // Estimativa do ciclo (pós-pago).
  useEffect(() => {
    if (!supabase || !empresa || isPre) { setEstimativa(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('estimativa_ciclo', { empresa_id: empresa.id });
      if (active) setEstimativa((data as Row | null) ?? null);
    })();
    return () => { active = false; };
  }, [empresa?.id, isPre]);

  // Duração do saldo (pré-pago).
  useEffect(() => {
    if (!supabase || !empresa || !isPre) { setDuracao(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('duracao_saldo', { empresa_id: empresa.id });
      if (active) setDuracao((data as Row | null) ?? null);
    })();
    return () => { active = false; };
  }, [empresa?.id, isPre]);

  // Extrato do saldo (pré-pago, últimos 30 dias).
  useEffect(() => {
    if (!supabase || !empresa || !isPre) { setExtrato([]); return; }
    let active = true;
    const ate = today();
    const de = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    (async () => {
      const { data } = await supabase.rpc('extrato_saldo', { empresa_id: empresa.id, de, ate });
      if (active) setExtrato((data as Row[]) ?? []);
    })();
    return () => { active = false; };
  }, [empresa?.id, isPre]);

  // Destinatários das faturas: contatos com "Recebe faturas"; sem nenhum, os de papel Financeiro.
  useEffect(() => {
    if (!supabase || !empresa) { setDestinatarios([]); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.from('empresa_contatos').select('nome,email,papel,recebe_faturas').eq('empresa_id', empresa.id);
      if (!active) return;
      const rows = (data ?? []) as Row[];
      const marcados = rows.filter(r => r.recebe_faturas && r.email).map(r => String(r.email));
      const lista = marcados.length > 0 ? marcados : rows.filter(r => r.papel === 'financeiro' && r.email).map(r => String(r.email));
      setDestinatarios(lista);
    })();
    return () => { active = false; };
  }, [empresa?.id]);

  // Acordos de pagamento da empresa (cartão de acordo + linhas quitadas).
  useEffect(() => {
    if (!supabase || !empresa) { setAcordos([]); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.rpc('acordos', { empresa_id: empresa.id });
      if (!active) return;
      setAcordos((data as Row[]) ?? []);
    })();
    return () => { active = false; };
  }, [empresa?.id]);

  // Retorno do Stripe (cartão): ?pagamento=ok
  useEffect(() => {
    if (!empresa) return;
    if (searchParams.get('pagamento') !== 'ok') return;
    setSucessoCartao(true);
    setSearchParams({}, { replace: true });
    // recarrega a cada 5s por 1 minuto
    let ticks = 0;
    pollRef.current = setInterval(() => {
      void recarregarPainel(true);
      ticks += 1;
      if (ticks >= 12 && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [empresa, searchParams, setSearchParams, recarregarPainel]);

  // Pré-pago: enquanto houver recarga pendente, relê saldo a cada 10s por 3 min (e ao voltar o foco)
  const temRecargaPendente = isPre && Array.isArray(painel?.recargas) &&
    (painel!.recargas as Row[]).some(r => ['aguardando'].includes(String(r.situacao ?? '')));
  useEffect(() => {
    if (!temRecargaPendente) return;
    let ticks = 0;
    const id = setInterval(() => {
      void recarregarPainel(true);
      ticks += 1;
      if (ticks >= 18) clearInterval(id);
    }, 10000);
    const onFocus = () => { void recarregarPainel(true); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [temRecargaPendente, recarregarPainel]);

  async function pagar(tipo: 'fatura' | 'recarga' | 'parcela', id: string, forma: 'boleto' | 'pix' | 'cartao') {
    setErro('');
    const chave = `${tipo}:${id}`;
    setPagando(chave);
    try {
      const body: Record<string, unknown> = { acao: 'pagar', forma };
      body[tipo] = id;
      const data = await chamar(body);
      const c = (data.cobranca as Row) ?? {};
      setPagamento({ chave, forma, link: c.link ?? null, pix_copia_cola: c.pix_copia_cola ?? null, boleto_codigo: c.boleto_codigo ?? null, expira_em: c.expira_em ?? null });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível iniciar o pagamento.');
    } finally {
      setPagando(null);
    }
  }

  async function demonstrativo(faturaId: string) {
    setErro('');
    try {
      const data = await chamar({ acao: 'demonstrativo', fatura: faturaId });
      if (data.url) window.open(String(data.url), '_blank', 'noopener,noreferrer');
      else throw new Error('Demonstrativo indisponível.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir o demonstrativo.');
    }
  }

  if (!permissoes.includes('ver_faturamento')) {
    return <EmpresaShell><div className="rounded-xl bg-[#F5F5F7] px-6 py-10 text-center text-[14px] text-[#6E6E73]">Seu perfil não tem permissão para ver faturamento.</div></EmpresaShell>;
  }

  const dados = (painel?.dados as Row) ?? {};
  const formas: string[] = Array.isArray(dados.formas) ? (dados.formas as string[]) : [];
  const podePagar = permissoes.includes('pagar_faturas');
  // Acordos de pagamento: ativos viram cartão; quitados/cancelados viram linha em Faturas anteriores.
  const acordosAtivos = acordos.filter(a => {
    const s = String(a.situacao ?? '');
    if (s === 'em_dia' || s === 'parcela_vencida') return true;
    if (s === 'quebrado' && Number(a.valor_restante ?? 0) > 0) return true;
    return false;
  });
  const acordosConcluidos = acordos.filter(a => ['quitado', 'cancelado'].includes(String(a.situacao ?? '')));
  // Fatura em acordo sai do cartão "fatura em aberto".
  const faturaAberta = (painel?.fatura_aberta as Row) ?? null;
  const faturaAbertaEmAcordo = !!faturaAberta && (String(faturaAberta.situacao ?? faturaAberta.situacao_atual ?? '') === 'em_acordo' || faturaAberta.acordo_id);

  return (
    <EmpresaShell>
      {destinatarios.length > 0 && (
        <p className="mb-4 text-[13px] text-[#6E6E73]">As faturas são enviadas para: <span className="font-medium text-[#1D1D1F]">{destinatarios.join(', ')}</span> · <Link to="/empresa/contatos" className="font-semibold text-[#0A60D0] hover:underline">Alterar em Contatos</Link></p>
      )}
      {erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}
      {sucessoCartao && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">
          <span>Pagamento recebido. A fatura muda para Paga em instantes.</span>
          <button onClick={() => setSucessoCartao(false)} aria-label="Fechar" className="text-[#248A3D]"><X size={16} /></button>
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
      ) : !painel ? (
        <p className="py-10 text-center text-[14px] text-[#8E8E93]">Sem dados de faturamento.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Coluna principal */}
          <div className="space-y-6">
            {acordosAtivos.map(a => (
              <AcordoCard
                key={String(a.id ?? '')}
                acordo={a}
                pagamento={pagamento}
                pagando={pagando}
                podePagar={podePagar}
                onPagar={(id, forma) => pagar('parcela', id, forma)}
              />
            ))}
            {isPre ? (
              <>
                <SaldoCard saldo={(painel.saldo as Row) ?? null} duracao={duracao} podePagar={podePagar} onRecarregar={() => setRecargaOpen(true)} />
                {pagamento && pagamento.chave.startsWith('recarga:') && (
                  <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
                    <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Pagamento da recarga</h2>
                    <PagamentoResultado pagamento={pagamento} />
                  </section>
                )}
              </>
            ) : (
              <>
                <FaturaAbertaCard
                  destaque={faturaDestaque}
                  fatura={faturaAbertaEmAcordo ? null : faturaAberta}
                  formas={formas}
                  pagamento={pagamento}
                  pagando={pagando}
                  podePagar={podePagar}
                  onPagar={(id, forma) => pagar('fatura', id, forma)}
                  onDemonstrativo={demonstrativo}
                />
                <EstimativaCard estimativa={estimativa} />
                <ItensFatura fatura={faturaAbertaEmAcordo ? null : faturaAberta} />
              </>
            )}

            {isPre ? (
              <>
                <ExtratoSaldo extrato={extrato} />
                <RecargasList recargas={(painel.recargas as Row[]) ?? []} />
              </>
            ) : (
              <FaturasAnteriores
                destaque={faturaDestaque}
                faturas={(painel.faturas as Row[]) ?? []}
                acordosConcluidos={acordosConcluidos}
                onDemonstrativo={demonstrativo}
              />
            )}
          </div>

          {/* Coluna lateral */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            {isPre && painel.recarga_automatica && (
              <RecargaAutomaticaCard
                cartao={(painel.cartao as Row) ?? null}
                avisoSaldo={painel.aviso_saldo != null ? Number(painel.aviso_saldo) : null}
                recargaMinima={painel.recarga_minima != null ? Number(painel.recarga_minima) : null}
              />
            )}
            <DadosCobrancaCard dados={dados} />
          </div>
        </div>
      )}

      {/* Agente virtual (SQL 56): itens que o MotorCX fatura e, à parte, a telefonia paga à operadora. */}
      {!loading && empresa && <div className="mt-8"><AgenteVozFaturamento empresaId={String(empresa.id)} empresaSlug={empresa.slug} /></div>}

      {recargaOpen && isPre && (
        <RecargaModal
          minimo={Number((painel?.saldo as Row)?.recarga_minima ?? painel?.recarga_minima ?? 0)}
          formas={formas}
          onClose={() => setRecargaOpen(false)}
          onPagar={async (valor, forma) => {
            if (!supabase || !empresa) { setErro('Configuração ausente.'); return; }
            setErro('');
            const { data: rid, error } = await supabase.rpc('solicitar_recarga', { empresa: empresa.id, valor, forma });
            if (error || !rid) { setErro(friendlyError(error)); return; }
            const id = typeof rid === 'string' ? rid : String((rid as Row)?.id ?? rid);
            setRecargaOpen(false);
            await pagar('recarga', id, forma);
            void recarregarPainel(true);
          }}
        />
      )}
    </EmpresaShell>
  );
}

// ============================ Fatura em aberto ============================

/** Rola até a fatura do link (?fatura=ID), uma vez, quando ela aparece na tela. */
function useRolarAteFatura(destaque: string | null | undefined, n: number) {
  const feito = useRef(false);
  useEffect(() => {
    if (!destaque || feito.current || n === 0) return;
    const el = document.getElementById(`fatura-${destaque}`);
    if (el) { feito.current = true; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, [destaque, n]);
}

function FaturaAbertaCard({ fatura, formas, pagamento, pagando, podePagar, onPagar, onDemonstrativo, destaque }: {
  destaque?: string | null;
  fatura: Row | null;
  formas: string[];
  pagamento: Pagamento | null;
  pagando: string | null;
  podePagar: boolean;
  onPagar: (id: string, forma: 'boleto' | 'pix' | 'cartao') => void;
  onDemonstrativo: (id: string) => void;
}) {
  useRolarAteFatura(destaque, fatura ? 1 : 0);
  if (!fatura) {
    return (
      <section className="rounded-2xl bg-white p-8 text-center" style={{ boxShadow: cardShadow }}>
        <p className="text-[16px] font-semibold text-[#1D1D1F]">Nenhuma fatura em aberto</p>
        <p className="mt-1 text-[14px] text-[#6E6E73]">Quando uma fatura for gerada, ela aparece aqui.</p>
      </section>
    );
  }

  const situacao = String(fatura.situacao ?? 'aberta');
  const vencida = situacao === 'vencida';
  const sit = vencida
    ? { label: 'Vencida', cor: '#FF3B30', bg: '#FFE8E6' }
    : { label: `Em aberto · vence ${dateBR(fatura.vencimento)}`, cor: '#9a631b', bg: '#FFF3E8' };
  const chave = `fatura:${fatura.id}`;
  const pag = pagamento?.chave === chave ? pagamento : null;
  const ocupado = pagando === chave;

  // formas padrão: boleto e pix sempre disponíveis; cartão só se aceito
  const formasAtivas: string[] = formas.length ? formas : ['boleto', 'pix'];

  const emDestaque = !!destaque && String(fatura.id) === destaque;
  return (
    <section id={`fatura-${fatura.id}`} className="rounded-2xl bg-white p-6" style={{ boxShadow: emDestaque ? '0 0 0 2px #FF9500, 0 2px 12px rgba(0,0,0,.04)' : cardShadow }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-[#6E6E73]">Fatura de {mesFatura(fatura)} · nº {numFatura(fatura)}</p>
          <span className="mt-1.5 inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>
          {fatura.ciclo_inicio && fatura.ciclo_fim && (
            <p className="mt-1.5 text-[13px] text-[#8E8E93]">Ciclo de {dateBR(fatura.ciclo_inicio)} a {dateBR(fatura.ciclo_fim)}</p>
          )}
        </div>
        <p className="text-[32px] font-bold tracking-tight text-[#1D1D1F] tnum">{moneyBR(fatura.valor_total)}</p>
      </div>

      {/* Documentos da fatura em aberto */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => onDemonstrativo(String(fatura.id))} className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><FileText size={13} /> Demonstrativo (PDF)</button>
        {fatura.boleto_pdf && (
          <a href={String(fatura.boleto_pdf)} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><FileText size={13} /> Boleto (PDF)</a>
        )}
        {fatura.nota && (fatura.nota as Row).link_pdf && (
          <a href={String((fatura.nota as Row).link_pdf)} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><ExternalLink size={13} /> NFS-e nº {(fatura.nota as Row).numero}</a>
        )}
      </div>

      {/* Como pagar */}
      {podePagar ? (
        <div className="mt-6">
          <p className="mb-2 text-[14px] font-semibold text-[#1D1D1F]">Como você quer pagar?</p>
          <div className="flex flex-wrap gap-2">
            {(['boleto', 'pix', 'cartao'] as const).map(f => {
              if (!formasAtivas.includes(f)) return null;
              return (
                <button
                  key={f}
                  onClick={() => onPagar(String(fatura.id), f)}
                  disabled={ocupado}
                  className="flex h-10 items-center gap-2 rounded-xl bg-[#1D1D1F] px-4 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50"
                >
                  {ocupado && pagando === chave ? <Loader2 size={16} className="animate-spin" /> : null}
                  {FORMAS_LABEL[f]}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#8E8E93]">
            {formasAtivas.map(f => <span key={f}>{FORMAS_LABEL[f]}: {FORMAS_DESC[f]}</span>)}
          </div>
        </div>
      ) : (
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-[#F5F5F7] px-4 py-3 text-[13px] text-[#6E6E73]">
          <Lock size={15} className="shrink-0" /> Só quem pode pagar faturas paga (Admin, por padrão)
        </div>
      )}

      {/* Resultado do pagamento */}
      {pag && <PagamentoResultado pagamento={pag} />}
    </section>
  );
}

// ============================ Resultado de pagamento ============================

function PagamentoResultado({ pagamento }: { pagamento: Pagamento }) {
  const { forma } = pagamento;

  if (forma === 'boleto') {
    return (
      <div className="mt-4 rounded-xl bg-[#F5F5F7] p-4">
        <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Boleto gerado</p>
        <CopiarLinha label="Código do boleto" valor={pagamento.boleto_codigo} />
        <div className="mt-3">
          <a href={pagamento.link || undefined} target="_blank" rel="noreferrer" className={`flex h-9 w-fit items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 ${pagamento.link ? '' : 'pointer-events-none opacity-40'}`}><FileText size={14} /> Abrir boleto (PDF)</a>
        </div>
      </div>
    );
  }

  if (forma === 'pix') {
    return <PixResultado pagamento={pagamento} />;
  }

  // cartão
  return (
    <div className="mt-4 rounded-xl bg-[#F5F5F7] p-4">
      <p className="text-[14px] text-[#1D1D1F]">Você vai para a página segura do Stripe. O número do cartão não passa pelo MotorCX.</p>
      <div className="mt-3">
        <a href={pagamento.link || undefined} className={`flex h-9 w-fit items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 ${pagamento.link ? '' : 'pointer-events-none opacity-40'}`}><CreditCard size={14} /> Ir para o pagamento</a>
      </div>
    </div>
  );
}

function PixResultado({ pagamento }: { pagamento: Pagamento }) {
  const [qr, setQr] = useState<string | null>(null);
  const copia = pagamento.pix_copia_cola;

  useEffect(() => {
    let active = true;
    if (!copia) { setQr(null); return; }
    import('qrcode').then((QRCode) => QRCode.toDataURL(String(copia), { margin: 1, width: 240 }))
      .then((url) => { if (active) setQr(url); })
      .catch(() => { if (active) setQr(null); });
    return () => { active = false; };
  }, [copia]);

  return (
    <div className="mt-4 rounded-xl bg-[#F5F5F7] p-4">
      <p className="mb-3 text-[13px] font-semibold text-[#1D1D1F]">Pix gerado</p>
      <div className="flex flex-wrap items-start gap-4">
        {qr ? <img src={qr} alt="QR Code Pix" width={160} height={160} className="rounded-lg bg-white p-2" /> : <div className="grid h-[160px] w-[160px] place-items-center rounded-lg bg-white text-[12px] text-[#8E8E93]">Gerando QR Code...</div>}
        <div className="min-w-0 flex-1">
          <CopiarLinha label="Código Pix (copia e cola)" valor={copia} />
          {pagamento.expira_em && <p className="mt-2 text-[12px] text-[#8E8E93]">Vale até {dateBR(pagamento.expira_em)} às {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(String(pagamento.expira_em)))}</p>}
        </div>
      </div>
    </div>
  );
}

// ============================ Copiar ============================

function CopiarLinha({ label, valor }: { label: string; valor: string | null | undefined }) {
  const [copiado, setCopiado] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function copiar() {
    const texto = String(valor ?? '');
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      // fallback: selecionar o texto
      const el = ref.current;
      if (el) { el.focus(); el.select(); document.execCommand?.('copy'); setCopiado(true); }
    }
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div>
      <p className="mb-1 text-[12px] font-semibold text-[#6E6E73]">{label}</p>
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          readOnly
          value={String(valor ?? '')}
          className="h-9 min-w-0 flex-1 rounded-lg border border-[#D2D2D7] bg-white px-2 text-[13px] text-[#1D1D1F] outline-none focus:border-[#1D1D1F] tnum"
        />
        <button onClick={copiar} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#E8E8ED]">
          {copiado ? <Check size={14} className="text-[#248A3D]" /> : <Copy size={14} />}
          {copiado ? 'Copiado' : 'Copiar código'}
        </button>
      </div>
    </div>
  );
}

// ============================ Faturas anteriores ============================

function faturaSitLabel(f: Row): { label: string; cor: string } | null {
  const s = String(f.situacao ?? f.situacao_atual ?? '');
  if (s === 'em_acordo') return { label: 'Em acordo', cor: '#9a631b' };
  return null;
}

function FaturasAnteriores({ faturas, acordosConcluidos, onDemonstrativo, destaque }: { faturas: Row[]; acordosConcluidos: Row[]; onDemonstrativo: (id: string) => void; destaque?: string | null }) {
  useRolarAteFatura(destaque, faturas.length);
  if (faturas.length === 0 && acordosConcluidos.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        <h2 className="mb-2 text-[17px] font-semibold text-[#1D1D1F]">Faturas anteriores</h2>
        <p className="py-4 text-center text-[14px] text-[#8E8E93]">Nenhuma fatura anterior.</p>
      </section>
    );
  }
  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Faturas anteriores</h2>
      {faturas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#E5E5EA] text-[12px] font-semibold text-[#6E6E73]">
                <th className="py-2 pr-3 font-semibold">Ciclo</th>
                <th className="py-2 pr-3 font-semibold">Situação</th>
                <th className="py-2 pr-3 text-right font-semibold">Valor</th>
                <th className="py-2 pr-3 font-semibold">Documentos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0F2]">
              {faturas.map(f => {
                const paga = String(f.situacao ?? '') === 'paga';
                const nota = f.nota as Row | null;
                const fsit = faturaSitLabel(f);
                return (
                  <tr key={f.id} id={`fatura-${f.id}`} className={`text-[14px] ${destaque && String(f.id) === destaque ? 'bg-[#FFF7E8]' : ''}`}>
                    <td className="py-3 pr-3 align-top">
                      <p className="font-medium text-[#1D1D1F]">{mesFatura(f)}</p>
                      {f.ciclo_inicio && f.ciclo_fim && <p className="text-[12px] text-[#8E8E93]">{dateBR(f.ciclo_inicio)} a {dateBR(f.ciclo_fim)}</p>}
                    </td>
                    <td className="py-3 pr-3 align-top">
                      {paga ? (
                        <span className="text-[#248A3D]">{f.via_acordo || f.acordo_id ? 'Paga (via acordo)' : `Paga em ${dateBR(f.paga_em)}${f.forma ? ` · ${FORMAS_LABEL[String(f.forma)] ?? f.forma}` : ''}`}</span>
                      ) : fsit ? (
                        <span style={{ color: fsit.cor }}>{fsit.label}</span>
                      ) : (
                        <span className="text-[#6E6E73]">{(SIT_FATURA[String(f.situacao ?? '')] ?? { label: f.situacao ?? '—' }).label}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(f.valor_total)}</td>
                    <td className="py-3 pr-3 align-top">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => onDemonstrativo(String(f.id))} className="text-[12px] font-semibold text-[#0A60D0] hover:underline">Demonstrativo</button>
                        {f.boleto_pdf && <a href={String(f.boleto_pdf)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[#0A60D0] hover:underline">Boleto</a>}
                        {nota?.link_pdf && <a href={String(nota.link_pdf)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[#0A60D0] hover:underline">NFS-e nº {nota.numero}</a>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {acordosConcluidos.length > 0 && (
        <div className={`space-y-1 ${faturas.length > 0 ? 'mt-3' : ''}`}>
          {acordosConcluidos.map(a => (
            <p key={String(a.id ?? '')} className="text-[13px] text-[#8E8E93]">Acordo nº {String(a.id ?? '').slice(0, 8)} · {String(a.situacao ?? '') === 'quitado' ? 'quitado' : 'cancelado'}</p>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================ Pré-pago: Saldo ============================

function SaldoCard({ saldo, duracao, podePagar, onRecarregar }: { saldo: Row | null; duracao: Row | null; podePagar: boolean; onRecarregar: () => void }) {
  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-[#6E6E73]">Saldo</p>
          <p className="mt-1 text-[32px] font-bold tracking-tight text-[#1D1D1F] tnum">{moneyBR(saldo?.saldo)}</p>
          <p className="mt-0.5 text-[13px] text-[#8E8E93] tnum">Recargas pagas {moneyBR(saldo?.recargas_pagas)} · Uso {moneyBR(saldo?.uso)}</p>
        </div>
        {podePagar ? (
          <button onClick={onRecarregar} className="flex h-10 items-center gap-2 rounded-xl bg-[#1D1D1F] px-4 text-[14px] font-semibold text-white hover:opacity-85"><Plus size={16} /> Recarregar</button>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-xl bg-[#F5F5F7] px-4 py-2.5 text-[13px] text-[#6E6E73]"><Lock size={15} /> Só quem pode pagar recarrega</span>
        )}
      </div>
      {duracao?.dias_restantes != null && Number(duracao.dias_restantes) >= 0 && (
        <p className="mt-3 text-[13px] text-[#6E6E73]">Dura cerca de {duracao.dias_restantes} dias no ritmo dos últimos 7 dias ({moneyBR(duracao.media_dia)} por dia)</p>
      )}
      {saldo?.abaixo_do_aviso && !saldo?.pausar_envios && (
        <div className="mt-4 rounded-xl bg-[#FFF3E8] px-4 py-3 text-[14px] text-[#9a631b]">Saldo baixo. Recarregue para não parar os envios.</div>
      )}
      {saldo?.pausar_envios && (
        <div className="mt-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">Saldo esgotado: a Mensageria está pausada até a próxima recarga.</div>
      )}
    </section>
  );
}

// ============================ Recargas (pré-pago) ============================

function RecargasList({ recargas }: { recargas: Row[] }) {
  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Recargas</h2>
      {recargas.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhuma recarga.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#E5E5EA] text-[12px] font-semibold text-[#6E6E73]">
                <th className="py-2 pr-3 font-semibold">Pedida em</th>
                <th className="py-2 pr-3 font-semibold">Forma</th>
                <th className="py-2 pr-3 text-right font-semibold">Valor</th>
                <th className="py-2 pr-3 font-semibold">Situação</th>
                <th className="py-2 pr-3 font-semibold">NFS-e</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0F2]">
              {recargas.map(r => {
                const sit = SIT_RECARGA[String(r.situacao ?? 'aguardando')] ?? SIT_RECARGA.aguardando;
                const nota = r.nota as Row | null;
                return (
                  <tr key={r.id} className="text-[14px]">
                    <td className="py-3 pr-3 align-top text-[#1D1D1F] tnum">{dateTimeBR(r.pedida_em)}</td>
                    <td className="py-3 pr-3 align-top text-[#1D1D1F]">{FORMAS_LABEL[String(r.forma)] ?? r.forma}{r.automatica ? ' · automática' : ''}</td>
                    <td className="py-3 pr-3 align-top text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(r.valor)}</td>
                    <td className="py-3 pr-3 align-top"><span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span></td>
                    <td className="py-3 pr-3 align-top">{nota?.link_pdf ? <a href={String(nota.link_pdf)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[#0A60D0] hover:underline">NFS-e nº {nota.numero}</a> : <span className="text-[#8E8E93]">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ============================ Estimativa do ciclo (pós-pago) ============================

function EstimativaCard({ estimativa }: { estimativa: Row | null }) {
  if (!estimativa) return null;
  const ateAgora = Number(estimativa.ate_agora ?? 0);
  const dia = Number(estimativa.dia ?? 0);
  const dias = Number(estimativa.dias ?? 0);
  const est = estimativa.estimativa != null ? Number(estimativa.estimativa) : null;
  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-3 text-[17px] font-semibold text-[#1D1D1F]">{mesExtenso(today().slice(0, 7))} até agora</h2>
      <p className="text-[28px] font-bold tracking-tight text-[#1D1D1F] tnum">{moneyBR(ateAgora)}</p>
      {dia > 0 && dias > 0 && <p className="mt-0.5 text-[13px] text-[#8E8E93] tnum">dia {dia} de {dias}</p>}
      {est != null && dia >= 5 && (
        <p className="mt-3 text-[13px] text-[#6E6E73]">Estimativa até o fim do ciclo, no ritmo atual: cerca de {moneyBR(est)}. É só uma conta do ritmo; a fatura usa o consumo real.</p>
      )}
    </section>
  );
}

// ============================ Itens da fatura (pós-pago) ============================

function ItensFatura({ fatura }: { fatura: Row | null }) {
  const itens: Row[] = fatura && Array.isArray(fatura.itens) ? (fatura.itens as Row[]) : [];
  if (itens.length === 0) return null;
  const mes = fatura?.competencia ? mesExtenso(fatura.competencia) : mesExtenso(today().slice(0, 7));
  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Itens de {mes}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#E5E5EA] text-[12px] font-semibold text-[#6E6E73]">
              <th className="py-2 pr-3 font-semibold">Item</th>
              <th className="py-2 pr-3 text-right font-semibold">Qtd.</th>
              <th className="py-2 pr-3 text-right font-semibold">Preço</th>
              <th className="py-2 pr-3 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F0F2]">
            {itens.map((it, i) => {
              const preco = Number(it.preco ?? 0);
              const unidade = String(it.unidade ?? 'unidade');
              const precoStr = preco > 0 && preco < 0.10 ? `${moneyBR(preco * 1000)} por mil ${unidade}` : moneyBR(preco);
              return (
                <tr key={i} className="text-[14px]">
                  <td className="py-3 pr-3 text-[#1D1D1F]">{String(it.nome ?? it.item ?? '—')}</td>
                  <td className="py-3 pr-3 text-right text-[#6E6E73] tnum">{String(it.quantidade ?? '—')}</td>
                  <td className="py-3 pr-3 text-right text-[#6E6E73] tnum">{precoStr}</td>
                  <td className="py-3 pr-3 text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(it.valor)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================ Extrato do saldo (pré-pago) ============================

function ExtratoSaldo({ extrato }: { extrato: Row[] }) {
  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Extrato do saldo</h2>
      {extrato.length === 0 ? (
        <p className="py-6 text-center text-[14px] text-[#8E8E93]">Sem movimentação no período.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#E5E5EA] text-[12px] font-semibold text-[#6E6E73]">
                  <th className="py-2 pr-3 font-semibold">Dia</th>
                  <th className="py-2 pr-3 font-semibold">Descrição</th>
                  <th className="py-2 pr-3 text-right font-semibold">Valor</th>
                  <th className="py-2 pr-3 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {extrato.map((e, i) => {
                  const tipo = String(e.tipo ?? 'consumo');
                  const valor = Number(e.valor ?? 0);
                  const isRecarga = tipo === 'recarga';
                  return (
                    <tr key={i} className="text-[14px]">
                      <td className="py-3 pr-3 text-[#6E6E73] tnum">{dateBR(e.dia)}</td>
                      <td className="py-3 pr-3 text-[#1D1D1F]">{String(e.descricao ?? '—')}</td>
                      <td className={`py-3 pr-3 text-right font-semibold tnum ${isRecarga ? 'text-[#248A3D]' : 'text-[#8E8E93]'}`}>{isRecarga ? '+' : '−'}{moneyBR(Math.abs(valor))}</td>
                      <td className="py-3 pr-3 text-right text-[#1D1D1F] tnum">{moneyBR(e.saldo_depois)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-[#8E8E93]">Consumo do dia pelo preço médio do item no ciclo; o total do ciclo bate com o demonstrativo.</p>
        </>
      )}
    </section>
  );
}

// ============================ Recarga automática (lateral) ============================

function RecargaAutomaticaCard({ cartao, avisoSaldo, recargaMinima }: { cartao: Row | null; avisoSaldo: number | null; recargaMinima: number | null }) {
  return (
    <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
      <h3 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">Recarga automática</h3>
      {cartao ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <CreditCard size={18} className="text-[#6E6E73]" />
            <span className="text-[15px] font-semibold uppercase text-[#1D1D1F]">{String(cartao.bandeira ?? '—')}</span>
          </div>
          <p className="text-[14px] text-[#1D1D1F] tnum">•••• {String(cartao.final ?? '—')}</p>
          {cartao.validade && <p className="text-[13px] text-[#6E6E73] tnum">Validade {dateBR(cartao.validade)}</p>}
          {avisoSaldo != null && recargaMinima != null && (
            <p className="pt-1 text-[13px] text-[#6E6E73]">Quando o saldo chega em {moneyBR(avisoSaldo)}, cobramos {moneyBR(recargaMinima)} neste cartão.</p>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-[#6E6E73]">Faça uma recarga com cartão para guardar o cartão da recarga automática.</p>
      )}
    </div>
  );
}

// ============================ Dados da cobrança (lateral) ============================

function DadosCobrancaCard({ dados }: { dados: Row }) {
  const formas: string[] = Array.isArray(dados.formas) ? (dados.formas as string[]) : [];
  return (
    <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
      <h3 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">Dados da cobrança</h3>
      <dl className="space-y-2 text-[13px]">
        <div className="flex justify-between gap-2"><dt className="text-[#6E6E73]">CNPJ</dt><dd className="text-right font-medium text-[#1D1D1F] tnum">{dados.cnpj ? String(dados.cnpj) : '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-[#6E6E73]">E-mail financeiro</dt><dd className="text-right font-medium text-[#1D1D1F]">{dados.email_financeiro ? String(dados.email_financeiro) : '—'}</dd></div>
        <div className="flex justify-between gap-2"><dt className="text-[#6E6E73]">Formas aceitas</dt><dd className="text-right font-medium text-[#1D1D1F]">{formas.length ? formas.map(f => FORMAS_LABEL[f] ?? f).join(', ') : '—'}</dd></div>
      </dl>
      <Link to="/empresa/contatos" className="mt-3 inline-block text-[12px] font-semibold text-[#0A60D0] hover:underline">Para mudar: Empresa › Cadastro e Contatos.</Link>
    </div>
  );
}

// ============================ Modal de recarga (pré-pago) ============================

function RecargaModal({ minimo, formas, onClose, onPagar }: {
  minimo: number;
  formas: string[];
  onClose: () => void;
  onPagar: (valor: number, forma: 'boleto' | 'pix' | 'cartao') => Promise<void>;
}) {
  const [valor, setValor] = useState(minimo > 0 ? String(minimo) : '');
  const [forma, setForma] = useState<'boleto' | 'pix' | 'cartao'>(formas.includes('pix') ? 'pix' : formas[0] === 'boleto' ? 'boleto' : 'cartao');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);

  function parse(v: string): number {
    let s = String(v).trim();
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }

  async function enviar() {
    setError('');
    const v = parse(valor);
    if (v <= 0) { setError('Informe um valor válido.'); return; }
    if (minimo > 0 && v < minimo) { setError(`O valor mínimo é ${moneyBR(minimo)}.`); return; }
    setBusy(true);
    try { await onPagar(v, forma); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível recarregar.'); }
    finally { setBusy(false); }
  }

  const formasAtivas: string[] = formas.length ? formas : ['boleto', 'pix'];

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[420px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold text-[#1D1D1F]">Recarregar saldo</h2><button onClick={onClose} className="text-[#8E8E93]"><X size={20} /></button></div>
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Valor (R$){minimo > 0 && <span className="font-normal text-[#8E8E93]"> · mínimo {moneyBR(minimo)}</span>}</span><input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
          <div>
            <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Forma de pagamento</span>
            <div className="flex flex-wrap gap-2">
              {(['boleto', 'pix', 'cartao'] as const).map(f => {
                if (!formasAtivas.includes(f)) return null;
                return <button key={f} type="button" onClick={() => setForma(f)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${forma === f ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{FORMAS_LABEL[f]}</button>;
              })}
            </div>
          </div>
          {error && <p role="alert" className="text-[14px] text-[#FF3B30]">{error}</p>}
          <div className="flex justify-end gap-3"><button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button><button onClick={enviar} disabled={busy} className="flex h-10 items-center gap-2 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin" />}{busy ? 'Gerando...' : 'Pagar recarga'}</button></div>
        </div>
      </div>
    </div>
  );
}

// ============================ Cartão de acordo de pagamento ============================

function parcelaSituacao(p: Row): { label: string; cor: string } {
  const s = String(p.situacao ?? '');
  if (s === 'paga') return { label: `Paga${p.paga_em ? ` · paga em ${dateBR(p.paga_em)}` : ''}`, cor: '#248A3D' };
  const venc = p.vencimento ? String(p.vencimento).slice(0, 10) : '';
  const hoje = today();
  if (venc && venc < hoje) {
    const dias = Math.max(1, Math.floor((new Date(hoje).getTime() - new Date(venc).getTime()) / 86400000));
    return { label: `Vencida há ${dias} dia(s)`, cor: '#FF3B30' };
  }
  if (venc && venc > hoje) {
    const dias = Math.floor((new Date(venc).getTime() - new Date(hoje).getTime()) / 86400000);
    return { label: `Vence em ${dias} dia(s)`, cor: '#6E6E73' };
  }
  return { label: 'A vencer', cor: '#6E6E73' };
}

function AcordoCard({ acordo, pagamento, pagando, podePagar, onPagar }: {
  acordo: Row;
  pagamento: Pagamento | null;
  pagando: string | null;
  podePagar: boolean;
  onPagar: (parcelaId: string, forma: 'boleto' | 'pix' | 'cartao') => void;
}) {
  const sit = String(acordo.situacao ?? '');
  const sitInfo = sit === 'em_dia' ? { label: 'Em dia', cor: '#248A3D', bg: '#E8F8EC' }
    : sit === 'parcela_vencida' ? { label: 'Parcela vencida', cor: '#9a631b', bg: '#FFF3E8' }
    : sit === 'quebrado' ? { label: 'Desfeito', cor: '#FF3B30', bg: '#FFE8E6' }
    : sit === 'quitado' ? { label: 'Quitado', cor: '#8E8E93', bg: '#F5F5F7' }
    : { label: sit, cor: '#8E8E93', bg: '#F5F5F7' };
  const faturas: Row[] = Array.isArray(acordo.faturas) ? (acordo.faturas as Row[]) : [];
  const meses = faturas.map(f => f.competencia ? mesCurto(f.competencia) : '—').join(', ');
  const parcelas: Row[] = (Array.isArray(acordo.parcelas_detalhe) ? (acordo.parcelas_detalhe as Row[]) : []).filter(p => String(p.situacao ?? '') !== 'cancelada');
  const formas: string[] = Array.isArray(acordo.formas) ? (acordo.formas as string[]) : [];
  const ajuste = Number(acordo.ajuste ?? 0);
  const totalParcelas = Number(acordo.parcelas ?? 0);
  const valorFaturas = Number(acordo.valor_faturas ?? 0);

  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Acordo de pagamento · faturas de {meses}</h2>
        <span className="inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: sitInfo.bg, color: sitInfo.cor }}>{sitInfo.label}</span>
      </div>
      <div className="mc-tabela-container">
        <div className="mc-tabela-desktop overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#E5E5EA] text-[12px] font-semibold text-[#6E6E73]">
                <th className="py-2 pr-3 font-semibold">Parcela</th>
                <th className="py-2 pr-3 font-semibold">Situação</th>
                <th className="py-2 pr-3 font-semibold">Vencimento</th>
                <th className="py-2 pr-3 text-right font-semibold">Valor</th>
                <th className="py-2 pr-3 text-right font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F0F2]">
              {parcelas.map((p, i) => {
                const tipo = String(p.tipo ?? 'parcela');
                const numero = Number(p.numero ?? i + 1);
                const psit = parcelaSituacao(p);
                const paga = String(p.situacao ?? '') === 'paga';
                const chave = `parcela:${p.id}`;
                const pag = pagamento?.chave === chave ? pagamento : null;
                const ocupado = pagando === chave;
                return (
                  <Fragment key={i}>
                    <tr className="text-[14px]">
                      <td className="py-3 pr-3 align-top text-[#1D1D1F]">{tipo === 'saldo' ? 'Saldo do acordo' : `${numero}ª de ${totalParcelas}`}</td>
                      <td className="py-3 pr-3 align-top"><span className="text-[13px] font-semibold" style={{ color: psit.cor }}>{psit.label}</span></td>
                      <td className="py-3 pr-3 align-top text-[#6E6E73] tnum">{p.vencimento ? dateBR(p.vencimento) : '—'}</td>
                      <td className="py-3 pr-3 align-top text-right font-semibold text-[#1D1D1F] tnum">{moneyBR(p.valor)}</td>
                      <td className="py-3 pr-3 align-top text-right">
                        {paga ? (
                          p.link_nota_fiscal ? <a href={String(p.link_nota_fiscal)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[#0A60D0] hover:underline">Nota fiscal</a> : <span className="text-[#8E8E93]">—</span>
                        ) : podePagar ? (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {(['boleto', 'pix', 'cartao'] as const).map(f => {
                              if (!formas.includes(f)) return null;
                              return <button key={f} onClick={() => onPagar(String(p.id), f)} disabled={ocupado} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{ocupado ? <Loader2 size={13} className="animate-spin" /> : null}{FORMAS_LABEL[f]}</button>;
                            })}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E73]"><Lock size={11} /> Só quem pode pagar faturas paga (Admin, por padrão)</span>
                        )}
                      </td>
                    </tr>
                    {pag && (
                      <tr><td colSpan={5} className="pb-3"><PagamentoResultado pagamento={pag} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mc-tabela-cards space-y-2">
          {parcelas.map((p, i) => {
            const tipo = String(p.tipo ?? 'parcela');
            const numero = Number(p.numero ?? i + 1);
            const psit = parcelaSituacao(p);
            const paga = String(p.situacao ?? '') === 'paga';
            const chave = `parcela:${p.id}`;
            const pag = pagamento?.chave === chave ? pagamento : null;
            const ocupado = pagando === chave;
            return (
              <div key={i} className="rounded-xl border border-[#E5E5EA] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-[#1D1D1F]">{tipo === 'saldo' ? 'Saldo do acordo' : `${numero}ª de ${totalParcelas}`}</span>
                  <span className="text-[14px] font-semibold text-[#1D1D1F] tnum">{moneyBR(p.valor)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold" style={{ color: psit.cor }}>{psit.label}</span>
                  <span className="text-[12px] text-[#8E8E93] tnum">{p.vencimento ? dateBR(p.vencimento) : '—'}</span>
                </div>
                <div className="mt-2">
                  {paga ? (
                    p.link_nota_fiscal ? <a href={String(p.link_nota_fiscal)} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-[#0A60D0] hover:underline">Nota fiscal</a> : null
                  ) : podePagar ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(['boleto', 'pix', 'cartao'] as const).map(f => {
                        if (!formas.includes(f)) return null;
                        return <button key={f} onClick={() => onPagar(String(p.id), f)} disabled={ocupado} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-3 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{ocupado ? <Loader2 size={13} className="animate-spin" /> : null}{FORMAS_LABEL[f]}</button>;
                      })}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E73]"><Lock size={11} /> Só quem pode pagar faturas paga</span>
                  )}
                </div>
                {pag && <div className="mt-2"><PagamentoResultado pagamento={pag} /></div>}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-4 text-[13px] text-[#6E6E73]">{ajuste < 0 ? 'Desconto' : 'Acréscimo'} de {moneyBR(Math.abs(ajuste))} sobre {moneyBR(valorFaturas)}. Se uma parcela ficar 10 dias em atraso, o acordo é desfeito.</p>
    </section>
  );
}
