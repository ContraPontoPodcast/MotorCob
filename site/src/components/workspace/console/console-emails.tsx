import { useEffect, useMemo, useState } from 'react';
import { Loader2, Mail, Send, ShieldCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms } from './console-perms';
import { PainelEdicao } from '@/components/comuns/painel-edicao';
import { TabelaResponsiva, type LinhaTabela } from '@/components/comuns/tabela-responsiva';

// Nomes amigáveis dos tipos de e-mail. Os assuntos do sino vêm da tabela
// notificacao_assuntos (chave → nome); o que não estiver aqui cai nela ou no raw.
const TIPO_LABEL: Record<string, string> = {
  fatura: 'Fatura emitida',
  lembrete_fatura: 'Lembrete de fatura',
  acordo: 'Acordo registrado',
  lembrete_parcela: 'Lembrete de parcela',
  relatorio: 'Relatório agendado',
  teste: 'Teste',
};

const PERIODOS = [7, 30, 90] as const;

type VerifStatus = 'ok' | 'ausente' | 'duplicado' | 'sem_seletor' | string;

function verifPill(status: VerifStatus): { cor: string; bg: string; nota: string } {
  if (status === 'ok') return { cor: '#248A3D', bg: '#E8F8EC', nota: 'ok' };
  if (status === 'ausente') return { cor: '#FF3B30', bg: '#FFE8E6', nota: 'ausente' };
  if (status === 'duplicado') return { cor: '#9a631b', bg: '#FFF3E8', nota: 'dois registros SPF: junte em um' };
  if (status === 'sem_seletor') return { cor: '#8E8E93', bg: '#F5F5F7', nota: 'preencha o seletor DKIM' };
  return { cor: '#8E8E93', bg: '#F5F5F7', nota: status || '—' };
}

function statusVerif(v: unknown): VerifStatus {
  if (v == null) return 'ausente';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const s = (v as Row).status ?? (v as Row).situacao ?? (v as Row).resultado;
    return typeof s === 'string' ? s : 'ausente';
  }
  return 'ausente';
}

/** Mascara um endereço de e-mail: c***@alfa… */
function mascararEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '—';
  return `${local[0] ?? '•'}***@${domain.slice(0, 4)}…`;
}

export function ConsoleEmailsPage() {
  const { isMaster } = useConsolePerms();
  const [dias, setDias] = useState<number>(30);
  const [dados, setDados] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [assuntosMap, setAssuntosMap] = useState<Record<string, string>>({});

  // Mapa chave → nome dos assuntos do sino (notificacao_assuntos).
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    (async () => {
      const { data } = await supabase.from('notificacao_assuntos').select('assunto,nome');
      if (!active || !data) return;
      const m: Record<string, string> = {};
      (data as Row[]).forEach(r => { if (r.assunto) m[String(r.assunto)] = String(r.nome ?? r.assunto); });
      setAssuntosMap(m);
    })();
    return () => { active = false; };
  }, []);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.rpc('emails_console', { dias });
      if (error) throw error;
      const row = Array.isArray(data) ? (data[0] ?? null) : (data as Row | null);
      setDados(row);
    } catch (e) {
      setErro(friendlyError(e));
      setDados(null);
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [dias]);

  const enviados = Number(dados?.enviados ?? 0);
  const voltDef = Number(dados?.voltaram_definitivo ?? 0);
  const voltTemp = Number(dados?.voltaram_temporario ?? 0);
  const spam = Number(dados?.spam ?? 0);
  const naoSairam = Number(dados?.nao_sairam ?? 0);
  const entregues = enviados > 0 ? Math.max(0, enviados - voltDef - voltTemp - spam) : 0;
  const entreguesPct = enviados > 0 ? (entregues / enviados) * 100 : 0;
  const spamPct = enviados > 0 ? (spam / enviados) * 100 : 0;

  const porTipo: Row[] = Array.isArray(dados?.por_tipo) ? (dados!.por_tipo as Row[]) : [];
  const voltaram: Row[] = Array.isArray(dados?.voltaram) ? (dados!.voltaram as Row[]) : [];
  const dominio: Row | null = (dados?.dominio as Row | null) ?? null;
  const verif: Row = (dominio?.verificacao as Row | null) ?? {};
  const temEndereco = voltaram.some(r => !!r.endereco);

  function tipoLabel(tipo: string): string {
    return TIPO_LABEL[tipo] ?? assuntosMap[tipo] ?? tipo ?? '—';
  }

  return (
    <ConsoleShell>
      {erro && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{erro}</div>}

      {/* Período */}
      <div className="mb-5 flex items-center gap-2">
        <span className="text-[14px] font-semibold text-[#1D1D1F]">Período</span>
        <div className="flex items-center gap-1 rounded-[12px] bg-[#F5F5F7] p-1">
          {PERIODOS.map(p => (
            <button key={p} onClick={() => setDias(p)} className={`rounded-[9px] px-4 py-1.5 text-[14px] font-medium transition-colors ${dias === p ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{p} dias</button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
      ) : (
        <div className="space-y-6">
          {/* Cartões */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi titulo="Enviados" valor={enviados.toLocaleString('pt-BR')} />
            <Kpi titulo="Entregues" valor={`${entreguesPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} sub={`${entregues.toLocaleString('pt-BR')} de ${enviados.toLocaleString('pt-BR')}`} />
            <Kpi titulo="Voltaram" valor={`${voltDef} definitivos · ${voltTemp} temporários`} valorCor={(voltDef + voltTemp) > 0 ? '#FF3B30' : undefined} />
            <Kpi titulo="Marcados como spam" valor={spam.toLocaleString('pt-BR')} sub={`meta: abaixo de 0,1%${enviados > 0 ? ` (${spamPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)` : ''}`} valorCor={spamPct > 0.1 ? '#FF3B30' : undefined} />
          </div>
          {naoSairam > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span><strong>{naoSairam.toLocaleString('pt-BR')}</strong> não saíram — a conta de envio recusou; veja o motivo abaixo.</span>
            </div>
          )}

          {/* Por tipo */}
          <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
            <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Por tipo</h2>
            {porTipo.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Nenhum envio no período.</p> : (
              <TabelaPorTipo rows={porTipo} tipoLabel={tipoLabel} />
            )}
          </section>

          {/* Remetentes e domínio */}
          <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
            <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">Remetentes e domínio</h2>
            <div className="flex flex-wrap items-center gap-2">
              <VerifPill label="SPF" status={statusVerif(verif.spf)} />
              <VerifPill label="DKIM" status={statusVerif(verif.dkim)} />
              <VerifPill label="DMARC" status={statusVerif(verif.dmarc)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-[#6E6E73]">
              <span>política DMARC: <strong className="text-[#1D1D1F]">{dominio?.politica_dmarc ? String(dominio.politica_dmarc) : '—'}</strong></span>
              <span>conferido em <strong className="text-[#1D1D1F]">{dominio?.verificado_em ? dateTimeBR(dominio.verificado_em) : '—'}</strong></span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[#8E8E93]">A conta de envio do sistema é separada da conta da Mensageria.</p>
          </section>

          {/* O que voltou */}
          <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
            <h2 className="mb-4 text-[17px] font-semibold text-[#1D1D1F]">O que voltou</h2>
            {voltaram.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Nada voltou no período.</p> : (
              <TabelaVoltaram rows={voltaram} temEndereco={temEndereco} />
            )}
          </section>

          {/* Configurações */}
          <ConfigEmails isMaster={isMaster} />

          {/* Enviar teste */}
          {isMaster && <EnviarTeste />}
        </div>
      )}
    </ConsoleShell>
  );
}

// ----------------------------- Subcomponentes -----------------------------

function Kpi({ titulo, valor, sub, valorCor }: { titulo: string; valor: string; sub?: string; valorCor?: string }) {
  return (
    <div className="rounded-2xl bg-[#F5F5F7] p-5">
      <p className="text-[13px] text-[#6E6E73]">{titulo}</p>
      <p className="mt-1 text-[20px] font-bold tracking-tight tnum" style={{ color: valorCor ?? 'var(--base-texto)' }}>{valor}</p>
      {sub && <p className="mt-0.5 text-[12px] text-[#8E8E93] tnum">{sub}</p>}
    </div>
  );
}

function VerifPill({ label, status }: { label: string; status: VerifStatus }) {
  const p = verifPill(status);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold" style={{ backgroundColor: p.bg, color: p.cor }}>
      <ShieldCheck size={13} /> {label}
      <span className="font-normal opacity-80">· {p.nota}</span>
    </span>
  );
}

function TabelaPorTipo({ rows, tipoLabel }: { rows: Row[]; tipoLabel: (t: string) => string }) {
  const linhas: LinhaTabela[] = rows.map(r => {
    const celulas: React.ReactNode[] = [];
    celulas.push(<span className="font-medium text-[#1D1D1F]">{tipoLabel(String(r.tipo ?? ''))}</span>);
    celulas.push(<span className="text-[#6E6E73] tnum">{r.remetente ? `${r.remetente}@${r.dominio ?? ''}` : '—'}</span>);
    celulas.push(<span className="tnum text-[#1D1D1F]">{Number(r.enviados ?? 0).toLocaleString('pt-BR')}</span>);
    celulas.push(<span className="tnum" style={{ color: Number(r.voltaram ?? 0) > 0 ? '#FF3B30' : '#6E6E73' }}>{Number(r.voltaram ?? 0).toLocaleString('pt-BR')}</span>);
    celulas.push(<span className="tnum" style={{ color: Number(r.nao_sairam ?? 0) > 0 ? '#FF3B30' : '#6E6E73' }}>{Number(r.nao_sairam ?? 0).toLocaleString('pt-BR')}</span>);
    return { celulas };
  });
  return <TabelaResponsiva cabecalho={['Tipo', 'Remetente', 'Enviados', 'Voltaram', 'Não saíram']} linhas={linhas} destaque={[0, 2, 3]} />;
}

function sitVoltouLabel(s: string): { label: string; cor: string } {
  if (s === 'voltou_definitivo') return { label: 'definitivo', cor: '#FF3B30' };
  if (s === 'voltou_temporario') return { label: 'temporário', cor: '#9a631b' };
  if (s === 'spam') return { label: 'spam', cor: '#9a631b' };
  if (s === 'erro' || s === 'nao_saiu') return { label: 'não saiu', cor: '#FF3B30' };
  return { label: s || '—', cor: '#8E8E93' };
}

function TabelaVoltaram({ rows, temEndereco }: { rows: Row[]; temEndereco: boolean }) {
  const cabecalho = temEndereco
    ? ['Quando', 'Empresa', 'E-mail', 'Situação', 'Endereço', 'Motivo']
    : ['Quando', 'Empresa', 'E-mail', 'Situação', 'Motivo'];
  const linhas: LinhaTabela[] = rows.map(r => {
    const sit = sitVoltouLabel(String(r.situacao ?? ''));
    const celulas: React.ReactNode[] = [];
    celulas.push(<span className="tnum text-[#6E6E73] whitespace-nowrap">{r.quando ? dateTimeBR(r.quando) : '—'}</span>);
    celulas.push(<span className="text-[#1D1D1F]">{String(r.empresa ?? '—')}</span>);
    celulas.push(<span className="text-[#1D1D1F]">{String(r.titulo ?? r.tipo ?? '—')}</span>);
    celulas.push(<span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F5F5F7', color: sit.cor }}>{sit.label}</span>);
    if (temEndereco) celulas.push(<span className="tnum text-[#6E6E73]">{r.endereco ? mascararEmail(String(r.endereco)) : '—'}</span>);
    celulas.push(<span className="text-[#6E6E73]">{String(r.motivo ?? '—')}</span>);
    return { celulas };
  });
  const destaque = temEndereco ? [1, 2, 3] : [1, 2, 3];
  return <TabelaResponsiva cabecalho={cabecalho} linhas={linhas} destaque={destaque} />;
}

// ----------------------------- Configurações -----------------------------

const CAMPOS_CFG: { key: string; label: string; tipo?: 'email' }[] = [
  { key: 'dominio', label: 'Domínio dos remetentes' },
  { key: 'razao_social', label: 'Razão social (rodapé)' },
  { key: 'cnpj', label: 'CNPJ (rodapé)' },
  { key: 'endereco', label: 'Endereço (rodapé)' },
  { key: 'email_suporte', label: 'E-mail da equipe · Suporte (chamados)', tipo: 'email' },
  { key: 'email_comercial', label: 'E-mail da equipe · Comercial (contato do site)', tipo: 'email' },
  { key: 'email_financeiro', label: 'E-mail da equipe · Financeiro (empresa sem contato de fatura)', tipo: 'email' },
  { key: 'seletor_dkim', label: 'Seletor DKIM' },
];

function ConfigEmails({ isMaster }: { isMaster: boolean }) {
  const [cfg, setCfg] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [resetSignal, setResetSignal] = useState(0);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setErro('');
    try {
      const { data, error } = await supabase.from('email_config').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      setCfg((data as Row) ?? null);
      const f: Record<string, string> = {};
      CAMPOS_CFG.forEach(c => { f[c.key] = String((data as Row | null)?.[c.key] ?? ''); });
      setForm(f);
    } catch (e) {
      setErro(friendlyError(e));
    } finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  const mudancas = useMemo(() => {
    const out: Record<string, string> = {};
    CAMPOS_CFG.forEach(c => {
      const orig = String(cfg?.[c.key] ?? '');
      if (form[c.key] !== orig) out[c.key] = form[c.key];
    });
    return out;
  }, [cfg, form]);

  const podeSalvar = Object.keys(mudancas).length > 0;
  const rodapeCompleto = !!cfg?.rodape_completo;
  const equipeCompleta = !!cfg?.equipe_completa;

  async function salvar() {
    if (!supabase || !podeSalvar) return;
    setBusy(true); setErro(''); setSucesso('');
    try {
      const { error } = await supabase.rpc('salvar_email_config', { dados: mudancas });
      if (error) throw error;
      setSucesso('Configuração salva.');
      setResetSignal(s => s + 1);
      void reload();
    } catch (e) {
      setErro(friendlyError(e));
    } finally { setBusy(false); }
  }

  if (loading) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;
  if (!cfg) return <p className="py-8 text-center text-[14px] text-[#8E8E93]">Sem configuração de e-mail.</p>;

  const resumo = (
    <div className="space-y-3">
      {!rodapeCompleto && (
        <div className="flex items-start gap-2 rounded-xl bg-[#FFF3E8] px-4 py-3 text-[13px] text-[#9a631b]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Os e-mails saem sem razão social, CNPJ e endereço.
        </div>
      )}
      {!equipeCompleta && (
        <div className="flex items-start gap-2 rounded-xl bg-[#FFF3E8] px-4 py-3 text-[13px] text-[#9a631b]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Chamados e contatos do site não chegam por e-mail.
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {CAMPOS_CFG.map(c => (
          <div key={c.key} className="rounded-lg border border-[#E5E5EA] px-3 py-2">
            <p className="text-[12px] text-[#6E6E73]">{c.label}</p>
            <p className="text-[14px] font-medium text-[#1D1D1F]">{String(cfg[c.key] ?? '—') || '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );

  const formEl = (
    <div className="grid gap-3 sm:grid-cols-2">
      {CAMPOS_CFG.map(c => (
        <label key={c.key} className="block">
          <span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">{c.label}</span>
          <input
            value={form[c.key] ?? ''}
            onChange={e => setForm(prev => ({ ...prev, [c.key]: e.target.value }))}
            type={c.tipo === 'email' ? 'email' : 'text'}
            disabled={!isMaster}
            className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F] disabled:bg-[#F5F5F7]"
          />
        </label>
      ))}
    </div>
  );

  const revisao = (
    <div className="space-y-2">
      {Object.keys(mudancas).length === 0 ? (
        <p className="text-[14px] text-[#8E8E93]">Nenhuma alteração.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E5E5EA]">
          {Object.entries(mudancas).map(([k, v]) => {
            const label = CAMPOS_CFG.find(c => c.key === k)?.label ?? k;
            return (
              <div key={k} className="grid grid-cols-[1fr_1fr] gap-3 border-b border-[#F0F0F2] px-3 py-2 text-[13px] last:border-0">
                <span className="text-[#6E6E73]">{label}</span>
                <span className="font-medium text-[#1D1D1F]">{v || '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <PainelEdicao
      titulo="Configurações"
      podeEditar={isMaster}
      motivoBloqueio="Só o Master edita a configuração"
      resumo={resumo}
      form={formEl}
      revisao={revisao}
      podeRevisar={podeSalvar}
      podeSalvar={podeSalvar}
      salvando={busy}
      erro={erro}
      sucesso={sucesso}
      onSalvar={salvar}
      resetSignal={resetSignal}
    />
  );
}

// ----------------------------- Enviar teste -----------------------------

const TESTES: { tipo: 'aviso_obrigatorio' | 'aviso_opcional' | 'relatorio' | 'fatura'; label: string }[] = [
  { tipo: 'aviso_obrigatorio', label: 'Aviso obrigatório' },
  { tipo: 'aviso_opcional', label: 'Aviso opcional' },
  { tipo: 'relatorio', label: 'Relatório' },
  { tipo: 'fatura', label: 'Fatura' },
];

function EnviarTeste() {
  const [enviando, setEnviando] = useState<string | null>(null);

  async function enviar(tipo: string) {
    if (!supabase) return;
    setEnviando(tipo);
    try {
      const { error } = await supabase.functions.invoke('emails', { body: { acao: 'teste', tipo } });
      if (error) throw error;
      toast.success('Enviado para o seu e-mail, com dados fictícios.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : friendlyError(e));
    } finally { setEnviando(null); }
  }

  return (
    <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
      <div className="mb-1 flex items-center gap-2">
        <Mail size={16} className="text-[#1D1D1F]" />
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Enviar teste para mim</h2>
      </div>
      <p className="mb-4 text-[13px] text-[#6E6E73]">Receba um e-mail de exemplo no seu endereço, com dados fictícios.</p>
      <div className="flex flex-wrap gap-2">
        {TESTES.map(t => (
          <button
            key={t.tipo}
            onClick={() => enviar(t.tipo)}
            disabled={enviando !== null}
            className="flex h-9 items-center gap-2 rounded-lg border border-[#D2D2D7] bg-white px-4 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50"
          >
            {enviando === t.tipo ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />} {t.label}
          </button>
        ))}
      </div>
    </section>
  );
}
