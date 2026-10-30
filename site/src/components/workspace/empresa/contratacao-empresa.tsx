import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { X, Plus, Trash2, ChevronDown, Info } from 'lucide-react';
import { supabase, moneyBR, dateBR, today, friendlyError, type Row } from '@/lib/supabase';
import { SEGMENTOS, formatCNPJ, validarCNPJ, slugEmpresa, mesExtenso, dataLocal } from '@/lib/empresa-helpers';
import { FRENTES, type FrenteId } from '@/lib/frentes';
import { Chave } from '@/components/workspace/console/chave';
import { useConsolePerms } from '@/components/workspace/console/console-perms';
import { ErrorDetail } from '@/components/error-detail';
import { PainelEdicao } from '@/components/comuns/painel-edicao';

// ---------- helpers ----------

type Modelo = 'flat' | 'faixa' | 'progressivo' | 'mensalidade';
type Faixa = { ate: string; preco: string };
type PrecoEdit = { modelo: Modelo; preco: string; minimo: string; faixas: Faixa[]; motivo: string };
type Periodicidade = 'mensal' | 'semanal' | 'quinzenal' | 'outro';
type ModeloPag = 'pos' | 'pre';
type ModulosState = { orquestracao: boolean; jornada: boolean; mensageria: boolean; api: boolean; enriquecimento: boolean };

const MODELO_LABEL: Record<Modelo, string> = {
  flat: 'Preço único',
  faixa: 'Preço por faixa',
  progressivo: 'Progressivo por faixa',
  mensalidade: 'Mensalidade',
};

const MODELO_AJUDA: Record<Modelo, string> = {
  flat: 'Um preço único por unidade. Simples de prever e cobrar.',
  faixa: 'O volume do ciclo escolhe a faixa e esse preço vale para todas as unidades.',
  progressivo: 'Cada faixa cobra o seu preço só nas unidades dentro dela.',
  mensalidade: 'Valor fixo por ciclo, independente do volume.',
};

const UNIDADE_LABEL: Record<string, string> = {
  contratos: 'contrato no ciclo',
  jornada_clientes: 'cliente acionado no ciclo',
  sms: 'mensagem',
  email: 'mensagem',
  rcs_basic: 'mensagem',
  rcs_single: 'mensagem',
  rcs_conversacional: 'sessão',
  whatsapp_marketing: 'conversa',
  whatsapp_utilidade: 'conversa',
  whatsapp_servico: 'conversa',
};

const MOTOR_CODES = ['contratos', 'jornada_clientes'];

const FORMAS_PAG: { id: string; nome: string; curto: string }[] = [
  { id: 'boleto', nome: 'Boleto', curto: 'boleto' },
  { id: 'pix', nome: 'Pix', curto: 'Pix' },
  { id: 'cartao', nome: 'Cartão de crédito', curto: 'cartão' },
];

function preco5BR(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 5 });
}
/** Preço unitário com 4 casas (produtos de mensageria). */
function preco4BR(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function numberBR(v: unknown) { return Number(v ?? 0).toLocaleString('pt-BR'); }

/** Preço unitário abaixo de R$ 0,10 aparece por mil (visão do cliente). */
function precoCliente(v: number, unidade: string): string {
  if (v > 0 && v < 0.10) return `${moneyBR(v * 1000)} por mil ${unidade}`;
  return `${preco5BR(v)} por ${unidade}`;
}

/** Preço resumido para a tabela (Item · Tipo · Preço · Desde). */
function precoTabela(vigente: Row, unidade: string): string {
  const modelo = String(vigente.modelo ?? '');
  if (modelo === 'mensalidade') return `${moneyBR(vigente.preco)}/ciclo`;
  if (modelo === 'flat') return precoCliente(Number(vigente.preco ?? 0), unidade);
  const faixas: Row[] = Array.isArray(vigente.precos_faixas) ? (vigente.precos_faixas as Row[]) : [];
  if (faixas.length === 0) return '—';
  return precoCliente(Number(faixas[0].preco ?? 0), unidade);
}

/** Regra BR: tira espaços; se houver vírgula, remove os pontos e troca vírgula por ponto;
 *  se não houver vírgula, usa como está. Vazio/inválido = 0. */
function parseNum(v: string): number {
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/** Diz se um preço editado tem dados válidos (para validação de "Falta preço"). */
function precoEditValido(ed: PrecoEdit): boolean {
  if (ed.modelo === 'flat' || ed.modelo === 'mensalidade') return parseNum(ed.preco) > 0;
  if (ed.faixas.length < 2) return false;
  return ed.faixas.every(f => parseNum(f.preco) >= 0) && ed.faixas.slice(0, -1).every(f => parseNum(f.ate) > 0);
}

function precoVigente(itemPrecos: Row[], competencia: string): Row | null {
  if (itemPrecos.length === 0) return null;
  const agora = competencia.slice(0, 7);
  const comData = itemPrecos.map(p => ({ p, mes: String(p.vigente_desde ?? '').slice(0, 7) }));
  const passados = comData.filter(d => d.mes <= agora).sort((a, b) => b.mes.localeCompare(a.mes));
  if (passados.length > 0) return passados[0].p;
  return comData.sort((a, b) => a.mes.localeCompare(b.mes))[0].p;
}

function resumoPreco(vigente: Row, unidade: string): string {
  const modelo = String(vigente.modelo ?? '');
  if (modelo === 'flat') return `${preco5BR(vigente.preco)} por ${unidade || 'unidade'}`;
  if (modelo === 'mensalidade') return `${moneyBR(vigente.preco)}/ciclo`;
  const faixas: Row[] = Array.isArray(vigente.precos_faixas) ? (vigente.precos_faixas as Row[]) : [];
  if (faixas.length === 0) return '—';
  const sorted = [...faixas].sort((a, b) => {
    const aa = a.ate == null ? Infinity : Number(a.ate);
    const bb = b.ate == null ? Infinity : Number(b.ate);
    return aa - bb;
  });
  return sorted.map(f => f.ate == null ? `acima: ${preco5BR(f.preco)}` : `até ${numberBR(f.ate)}: ${preco5BR(f.preco)}`).join(' · ');
}

function simular(modelo: Modelo, preco: string, minimo: string, faixas: Faixa[], volume: string): number {
  const v = Number(volume || 0);
  let val = 0;
  if (modelo === 'flat') val = v * parseNum(preco);
  else if (modelo === 'mensalidade') val = parseNum(preco);
  else {
    const sorted = faixas.map(f => ({ ate: f.ate === '' ? null : Number(f.ate), preco: parseNum(f.preco) })).sort((a, b) => {
      if (a.ate == null) return 1; if (b.ate == null) return -1; return a.ate - b.ate;
    });
    if (modelo === 'faixa') {
      let p = sorted[0]?.preco ?? 0;
      for (const f of sorted) { if (f.ate == null || v <= f.ate) { p = f.preco; break; } }
      val = v * p;
    } else {
      let prev = 0;
      for (const f of sorted) {
        const limite = f.ate == null ? Infinity : f.ate;
        const unidades = Math.max(0, Math.min(v, limite) - prev);
        val += unidades * f.preco;
        prev = limite;
        if (v <= limite) break;
      }
    }
  }
  if (modelo !== 'mensalidade' && parseNum(minimo) > 0 && val < parseNum(minimo)) val = parseNum(minimo);
  return val;
}

/** Códigos de itens contratados a partir dos módulos e canais. */
function contractedCodes(modulos: ModulosState, canais: string[]): string[] {
  const c: string[] = [];
  if (modulos.orquestracao) c.push('contratos');
  if (modulos.jornada) c.push('jornada_clientes');
  if (canais.includes('sms')) c.push('sms');
  if (canais.includes('email')) c.push('email');
  if (canais.includes('rcs')) c.push('rcs_basic', 'rcs_single', 'rcs_conversacional');
  if (canais.includes('whatsapp')) c.push('whatsapp_marketing', 'whatsapp_utilidade', 'whatsapp_servico');
  return c;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Calcula o ciclo localmente (modo nova, sem empresa ainda).
 *  - Mensal: do dia de corte até a véspera do corte no mês seguinte; competência = mês do fim.
 *  - Dias (semanal/quinzenal/outro): ciclo de N dias a partir de inicio; competência = 1º dia do ciclo.
 *  Pós-pago: fecha no dia seguinte ao fim e vence prazo_dias depois. Pré-pago: sem fatura/vencimento. */
function cicloLocal(periodicidade: Periodicidade, diaCorte: number, cicloDias: number, inicio: string, modeloPag: ModeloPag, prazoDias: number): Row {
  const hoje = new Date();
  if (periodicidade === 'mensal') {
    let inicioY = hoje.getFullYear();
    let inicioM = hoje.getMonth();
    if (hoje.getDate() < diaCorte) {
      inicioM -= 1;
      if (inicioM < 0) { inicioM = 11; inicioY -= 1; }
    }
    const cinicio = new Date(inicioY, inicioM, diaCorte);
    let fim: Date;
    if (diaCorte === 1) {
      fim = new Date(cinicio.getFullYear(), cinicio.getMonth() + 1, 0);
    } else {
      fim = new Date(cinicio.getFullYear(), cinicio.getMonth() + 1, diaCorte - 1);
    }
    const competencia = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}`;
    const out: Row = { competencia, inicio: iso(cinicio), fim: iso(fim) };
    if (modeloPag === 'pos') {
      const fecha = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1);
      const vence = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + prazoDias);
      out.fecha_em = iso(fecha);
      out.vence_em = iso(vence);
    }
    return out;
  }
  const N = periodicidade === 'semanal' ? 7 : periodicidade === 'quinzenal' ? 15 : Math.max(1, cicloDias);
  const ini = dataLocal(inicio || today());
  const k = Math.floor((hoje.getTime() - ini.getTime()) / (N * 86400000));
  const start = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + k * N);
  const fim = new Date(start.getFullYear(), start.getMonth(), start.getDate() + N - 1);
  const out: Row = { competencia: iso(start), inicio: iso(start), fim: iso(fim) };
  if (modeloPag === 'pos') {
    const fecha = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1);
    const vence = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + prazoDias);
    out.fecha_em = iso(fecha);
    out.vence_em = iso(vence);
  }
  return out;
}

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as Record<string, unknown>).message === 'string') {
    return String((err as Record<string, unknown>).message);
  }
  return fallback;
}

// ---------- componente principal ----------

export function ContratacaoEmpresa({
  mode,
  empresaId,
  onConcluido,
  soPrecos = false,
}: {
  mode: 'nova' | 'editar';
  empresaId?: string;
  onConcluido?: (id: string) => void;
  soPrecos?: boolean;
}) {
  const isNova = mode === 'nova';
  const { can } = useConsolePerms();

  // Empresa (nova)
  const [emp, setEmp] = useState({ nome: '', razao_social: '', cnpj: '', segmento: '', admin_nome: '', admin_email: '' });

  // Frentes
  const [frentes, setFrentes] = useState<FrenteId[]>(['motorcob']);

  // Módulos — nada vem ligado sozinho
  const [modulos, setModulos] = useState<ModulosState>({ orquestracao: false, jornada: false, mensageria: false, api: false, enriquecimento: false });
  const [canais, setCanais] = useState<string[]>([]);

  // Preços
  const [itens, setItens] = useState<Row[]>([]);
  const [precosEmpresa, setPrecosEmpresa] = useState<Row[]>([]);
  const [alterados, setAlterados] = useState<Record<string, PrecoEdit>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [historicoItem, setHistoricoItem] = useState<Row | null>(null);

  // Ciclo
  const [periodicidade, setPeriodicidade] = useState<Periodicidade>('mensal');
  const [diaCorte, setDiaCorte] = useState(1);
  const [cicloDias, setCicloDias] = useState(7);
  const [inicio, setInicio] = useState<string>(today());
  const [cicloAtual, setCicloAtual] = useState<Row | null>(null);

  // Cobrança
  const [modeloPag, setModeloPag] = useState<ModeloPag>('pos');
  const [emissao, setEmissao] = useState<'revisar' | 'automatica'>('revisar');
  const [formas, setFormas] = useState<string[]>([]);
  const [prazoDias, setPrazoDias] = useState(10);
  const [recargaMinima, setRecargaMinima] = useState('');
  const [avisoSaldo, setAvisoSaldo] = useState('');
  const [aoZerar, setAoZerar] = useState<'pausar' | 'continuar'>('pausar');
  const [recargaAutomatica, setRecargaAutomatica] = useState(false);

  const [loading, setLoading] = useState(!isNova);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Vigência de preços e status por cartão (modo editar)
  const [vigencia, setVigencia] = useState<'proximo' | 'atual'>('proximo');
  const [motivoVigencia, setMotivoVigencia] = useState('');
  const [proximoCiclo, setProximoCiclo] = useState('');
  const [inicioCiclo, setInicioCiclo] = useState('');
  const [cardBusy, setCardBusy] = useState('');
  const [cardStatus, setCardStatus] = useState<{ card: string; error?: string; success?: string } | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const competencia = today();

  // Próximo ciclo e início do ciclo atual (vigência de preços, modo editar)
  useEffect(() => {
    if (!supabase || isNova || !empresaId) return;
    let active = true;
    (async () => {
      try {
        const [pc, ci] = await Promise.all([
          supabase.rpc('proximo_ciclo_mes', { empresa: empresaId }),
          supabase.rpc('ciclo_atual', { empresa: empresaId }),
        ]);
        if (!active) return;
        if (pc.data) setProximoCiclo(String(pc.data));
        const ciRow = (ci.data as Row[])?.[0];
        if (ciRow?.inicio) setInicioCiclo(String(ciRow.inicio));
      } catch { /* rpc indisponível */ }
    })();
    return () => { active = false; };
  }, [empresaId, isNova]);

  // Carrega dados
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    (async () => {
      try {
        const [it] = await Promise.all([
          supabase.from('cobranca_itens').select('*').is('preco_de', null).eq('ativo', true).order('ordem'),
        ]);
        if (!active) return;
        setItens((it.data ?? []) as Row[]);
        if (isNova) return;
        if (!empresaId) return;
        setLoading(true);
        const [fr, mo, pr, ci] = await Promise.all([
          supabase.from('empresa_frentes').select('frente').eq('empresa_id', empresaId),
          supabase.from('empresa_modulos').select('modulo,ativo,canais').eq('empresa_id', empresaId),
          supabase.from('precos_empresa').select('*, precos_faixas(*)').eq('empresa_id', empresaId).order('vigente_desde', { ascending: false }),
          supabase.from('ciclo_empresa').select('*').eq('empresa_id', empresaId).maybeSingle(),
        ]);
        if (!active) return;
        const frList = ((fr.data ?? []) as Row[]).map(r => r.frente as FrenteId).filter(f => f === 'motorcob' || f === 'motorcli');
        setFrentes(frList.length ? frList : []);
        const moMap: Record<string, boolean> = {};
        let canaisAtivos: string[] = [];
        (mo.data ?? []).forEach((r: Row) => {
          moMap[r.modulo] = !!r.ativo;
          if (r.modulo === 'mensageria' && Array.isArray(r.canais)) canaisAtivos = r.canais as string[];
        });
        setModulos({
          orquestracao: !!moMap.orquestracao,
          jornada: !!moMap.jornada,
          mensageria: !!moMap.mensageria,
          api: !!moMap.api,
          enriquecimento: !!moMap.enriquecimento,
        });
        setCanais(canaisAtivos);
        setPrecosEmpresa((pr.data ?? []) as Row[]);
        if (ci.data) {
          const r = ci.data as Row;
          setPeriodicidade((r.periodicidade as Periodicidade) ?? 'mensal');
          setDiaCorte(Number(r.dia_corte ?? 1) || 1);
          setCicloDias(Number(r.ciclo_dias ?? 7) || 7);
          setInicio(String(r.inicio ?? today()));
          setModeloPag((r.modelo_pagamento as ModeloPag) ?? 'pos');
          setEmissao((r.emissao as 'revisar' | 'automatica') ?? 'revisar');
          setFormas(Array.isArray(r.formas) ? (r.formas as string[]) : []);
          setPrazoDias(Number(r.prazo_dias ?? 10) || 10);
          setRecargaMinima(r.recarga_minima != null ? String(r.recarga_minima) : '');
          setAvisoSaldo(r.aviso_saldo != null ? String(r.aviso_saldo) : '');
          setAoZerar((r.ao_zerar as 'pausar' | 'continuar') ?? 'pausar');
          setRecargaAutomatica(!!r.recarga_automatica);
        }
        try {
          const { data } = await supabase.rpc('ciclo_atual', { empresa: empresaId });
          if (active) setCicloAtual((data as Row[])?.[0] ?? null);
        } catch { /* RPC indisponível */ }
      } catch (err) {
        if (active) setError(errMsg(err, 'Não foi possível carregar a contratação.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [empresaId, isNova]);

  const contracted = contractedCodes(modulos, canais);
  const itensContratados = itens.filter(it => contracted.includes(String(it.codigo)));
  const itensSemPreco = itensContratados.filter(it => {
    const codigo = String(it.codigo);
    const alterado = alterados[codigo];
    if (alterado && precoEditValido(alterado)) return false;
    const itemPrecos = precosEmpresa.filter(p => String(p.item ?? '') === codigo);
    return !precoVigente(itemPrecos, competencia);
  });

  const ciclo = isNova
    ? cicloLocal(periodicidade, diaCorte, cicloDias, inicio, modeloPag, prazoDias)
    : (cicloAtual ?? cicloLocal(periodicidade, diaCorte, cicloDias, inicio, modeloPag, prazoDias));

  function toggleFrente(id: FrenteId) {
    setFrentes(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }
  function toggleCanal(c: string) {
    setCanais(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }
  function toggleForma(f: string) {
    setFormas(prev => {
      const next = prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f];
      if (f === 'cartao' && !next.includes('cartao')) setRecargaAutomatica(false);
      return next;
    });
  }

  /** Validações de módulo, cobrança e preços. Retorna mensagem de erro ou ''. */
  function validar(): string {
    if (frentes.length === 0) return 'A empresa precisa de pelo menos um motor.';
    const faltam: string[] = [];
    if (frentes.includes('motorcob') && !modulos.orquestracao) faltam.push('Orquestração');
    if (frentes.includes('motorcli') && !modulos.jornada) faltam.push('Jornada');
    if (faltam.length) return `Marque o módulo do motor contratado: ${faltam.join(' e ')}.`;
    if (formas.length === 0) return 'Escolha pelo menos uma forma de pagamento.';
    if (modeloPag === 'pre' && parseNum(recargaMinima) <= 0) return 'Informe a recarga mínima.';
    if (recargaAutomatica && !formas.includes('cartao')) return 'Recarga automática precisa do cartão de crédito nas formas aceitas.';
    if (itensSemPreco.length > 0) return `Falta preço em: ${itensSemPreco.map(i => i.nome).join(', ')}.`;
    return '';
  }

  /** Salva preços alterados (vigente_desde = competencia_de). */
  async function salvarPrecos(empresaSalvaId: string) {
    let vigenteDesde = competencia;
    try { const { data } = await supabase.rpc('competencia_de', { empresa: empresaSalvaId, dia: competencia }); if (data) vigenteDesde = String(data); } catch { /* usa hoje */ }
    for (const [codigo, ed] of Object.entries(alterados)) {
      const itemNome = itens.find(it => String(it.codigo) === codigo)?.nome ?? codigo;
      const payload: Record<string, unknown> = { empresa: empresaSalvaId, item: codigo, modelo: ed.modelo, vigente_desde: vigenteDesde };
      if (ed.modelo === 'flat' || ed.modelo === 'mensalidade') {
        payload.preco = parseNum(ed.preco);
        payload.minimo = ed.modelo === 'mensalidade' ? 0 : parseNum(ed.minimo);
        payload.faixas = null;
      } else {
        payload.preco = null;
        payload.minimo = parseNum(ed.minimo);
        payload.faixas = ed.faixas.map((f, i, arr) => ({ ate: i === arr.length - 1 ? null : Number(f.ate), preco: parseNum(f.preco) }));
      }
      const { error: ePr } = await supabase.rpc('salvar_preco', payload);
      if (ePr) throw new Error(`Falha ao salvar o preço do ${itemNome}: ${ePr.message}`);
    }
  }

  /** Salva frentes, módulos, ciclo e cobrança (ordem: frentes → módulos → ciclo_empresa). */
  async function salvarTudo(empresaSalvaId: string) {
    if (!supabase) return;
    // 1. frentes
    const { error: eFr } = await supabase.rpc('salvar_frentes', { empresa: empresaSalvaId, frentes });
    if (eFr) throw new Error(`Falha ao salvar frentes: ${eFr.message}`);
    // 2. módulos (orquestracao, jornada, mensageria, api, enriquecimento)
    const modRows: Record<string, unknown>[] = [
      { empresa_id: empresaSalvaId, modulo: 'orquestracao', ativo: !!modulos.orquestracao, canais: [] },
      { empresa_id: empresaSalvaId, modulo: 'jornada', ativo: !!modulos.jornada, canais: [] },
      { empresa_id: empresaSalvaId, modulo: 'mensageria', ativo: !!modulos.mensageria, canais },
      { empresa_id: empresaSalvaId, modulo: 'api', ativo: !!modulos.api, canais: [] },
      { empresa_id: empresaSalvaId, modulo: 'enriquecimento', ativo: !!modulos.enriquecimento, canais: [] },
    ];
    const { error: eMo } = await supabase.from('empresa_modulos').upsert(modRows, { onConflict: 'empresa_id,modulo' });
    if (eMo) throw new Error(`Falha ao salvar módulos: ${eMo.message}`);
    // 3. ciclo + cobrança num único upsert em ciclo_empresa
    const cicloPayload: Record<string, unknown> = { empresa_id: empresaSalvaId };
    if (periodicidade === 'mensal') {
      cicloPayload.periodicidade = 'mensal';
      cicloPayload.dia_corte = diaCorte;
      cicloPayload.ciclo_dias = null;
      cicloPayload.inicio = null;
    } else {
      cicloPayload.periodicidade = 'dias';
      cicloPayload.dia_corte = null;
      cicloPayload.ciclo_dias = periodicidade === 'semanal' ? 7 : periodicidade === 'quinzenal' ? 15 : Math.max(1, cicloDias);
      cicloPayload.inicio = inicio;
    }
    cicloPayload.modelo_pagamento = modeloPag;
    cicloPayload.emissao = emissao;
    cicloPayload.formas = formas;
    cicloPayload.prazo_dias = modeloPag === 'pos' ? prazoDias : null;
    if (modeloPag === 'pre') {
      cicloPayload.recarga_minima = parseNum(recargaMinima);
      cicloPayload.aviso_saldo = parseNum(avisoSaldo) || null;
      cicloPayload.ao_zerar = aoZerar;
      cicloPayload.recarga_automatica = recargaAutomatica && formas.includes('cartao');
    } else {
      cicloPayload.recarga_minima = null;
      cicloPayload.aviso_saldo = null;
      cicloPayload.ao_zerar = null;
      cicloPayload.recarga_automatica = false;
    }
    const { error: eCi } = await supabase.from('ciclo_empresa').upsert(cicloPayload, { onConflict: 'empresa_id' });
    if (eCi) throw new Error(`Falha ao salvar o ciclo: ${eCi.message}`);
    // 4. preços alterados
    await salvarPrecos(empresaSalvaId);
  }

  async function criar() {
    if (!supabase) return;
    setError(''); setSuccess('');
    if (!emp.nome.trim()) { setError('Informe o nome fantasia.'); return; }
    if (!emp.razao_social.trim()) { setError('Informe a razão social.'); return; }
    const cnpj = emp.cnpj.replace(/\D/g, '');
    if (cnpj && !validarCNPJ(cnpj)) { setError('CNPJ inválido.'); return; }
    if (!emp.admin_email.trim()) { setError('Informe o e-mail do Admin.'); return; }
    if (!emp.admin_nome.trim()) { setError('Informe o nome do Admin.'); return; }
    const v = validar();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      // slug único
      let slug = slugEmpresa(emp.nome);
      const { data: existente } = await supabase.from('empresas').select('slug').eq('slug', slug).maybeSingle();
      if (existente) { let n = 2; while (true) { const s = `${slug}-${n}`; const { data } = await supabase.from('empresas').select('slug').eq('slug', s).maybeSingle(); if (!data) { slug = s; break; } n++; } }
      const { data: empRow, error: e1 } = await supabase.from('empresas').insert({
        slug, nome: emp.nome.trim(), razao_social: emp.razao_social.trim(), cnpj: cnpj || null,
        segmento: emp.segmento || null, situacao: 'implantacao', ativa: true,
        cliente_desde: new Date().toISOString().slice(0, 10),
      }).select('id').single();
      if (e1 || !empRow) { setError(`Falha ao criar empresa: ${errMsg(e1, 'tente novamente')}`); setBusy(false); return; }
      const empresaSalvaId = (empRow as Row).id as string;
      await salvarTudo(empresaSalvaId);
      // convidar Admin
      const { error: eAdmin } = await supabase.functions.invoke('admin-usuarios', { body: { acao: 'convidar', email: emp.admin_email.trim(), nome: emp.admin_nome.trim(), papel: 'admin', empresa_id: empresaSalvaId } });
      if (eAdmin) { setError(`Empresa criada, mas falha ao convidar Admin: ${errMsg(eAdmin, 'tente novamente')}`); setBusy(false); return; }
      setSuccess('Empresa criada. Convite enviado ao Admin da empresa.');
      setBusy(false);
      setTimeout(() => onConcluido?.(empresaSalvaId), 1200);
    } catch (err) {
      setError(errMsg(err, 'Não foi possível criar a empresa.'));
      setBusy(false);
    }
  }

  async function salvar() {
    if (!supabase || !empresaId) return;
    setError(''); setSuccess('');
    if (!soPrecos) {
      const v = validar();
      if (v) { setError(v); return; }
    } else if (itensSemPreco.length > 0) {
      setError(`Falta preço em: ${itensSemPreco.map(i => i.nome).join(', ')}.`);
      return;
    }
    setBusy(true);
    try {
      if (soPrecos) {
        await salvarPrecos(empresaId);
      } else {
        await salvarTudo(empresaId);
      }
      setSuccess('Contratação salva.');
      setBusy(false);
      setTimeout(() => onConcluido?.(empresaId), 1200);
    } catch (err) {
      setError(errMsg(err, 'Não foi possível salvar a contratação.'));
      setBusy(false);
    }
  }

  // ---- Salvamento por cartão (modo editar) ----

  async function salvarMotorModulos() {
    if (!supabase || !empresaId) return;
    setCardBusy('motor'); setCardStatus({ card: 'motor' });
    try {
      const { error: eFr } = await supabase.rpc('salvar_frentes', { empresa: empresaId, frentes });
      if (eFr) throw new Error(`Falha ao salvar frentes: ${eFr.message}`);
      const modRows: Record<string, unknown>[] = [
        { empresa_id: empresaId, modulo: 'orquestracao', ativo: !!modulos.orquestracao, canais: [] },
        { empresa_id: empresaId, modulo: 'jornada', ativo: !!modulos.jornada, canais: [] },
        { empresa_id: empresaId, modulo: 'mensageria', ativo: !!modulos.mensageria, canais },
        { empresa_id: empresaId, modulo: 'api', ativo: !!modulos.api, canais: [] },
        { empresa_id: empresaId, modulo: 'enriquecimento', ativo: !!modulos.enriquecimento, canais: [] },
      ];
      const { error: eMo } = await supabase.from('empresa_modulos').upsert(modRows, { onConflict: 'empresa_id,modulo' });
      if (eMo) throw new Error(`Falha ao salvar módulos: ${eMo.message}`);
      setCardStatus({ card: 'motor', success: 'Motor e módulos salvos.' });
      setResetSignal(s => s + 1);
    } catch (err) {
      setCardStatus({ card: 'motor', error: errMsg(err, 'Não foi possível salvar.') });
    } finally { setCardBusy(''); }
  }

  async function salvarCicloCobranca() {
    if (!supabase || !empresaId) return;
    setCardBusy('ciclo'); setCardStatus({ card: 'ciclo' });
    try {
      const cicloPayload: Record<string, unknown> = { empresa_id: empresaId };
      if (periodicidade === 'mensal') {
        cicloPayload.periodicidade = 'mensal'; cicloPayload.dia_corte = diaCorte; cicloPayload.ciclo_dias = null; cicloPayload.inicio = null;
      } else {
        cicloPayload.periodicidade = 'dias'; cicloPayload.dia_corte = null;
        cicloPayload.ciclo_dias = periodicidade === 'semanal' ? 7 : periodicidade === 'quinzenal' ? 15 : Math.max(1, cicloDias);
        cicloPayload.inicio = inicio;
      }
      cicloPayload.modelo_pagamento = modeloPag; cicloPayload.emissao = emissao; cicloPayload.formas = formas;
      cicloPayload.prazo_dias = modeloPag === 'pos' ? prazoDias : null;
      if (modeloPag === 'pre') {
        cicloPayload.recarga_minima = parseNum(recargaMinima);
        cicloPayload.aviso_saldo = parseNum(avisoSaldo) || null;
        cicloPayload.ao_zerar = aoZerar;
        cicloPayload.recarga_automatica = recargaAutomatica && formas.includes('cartao');
      } else {
        cicloPayload.recarga_minima = null; cicloPayload.aviso_saldo = null; cicloPayload.ao_zerar = null; cicloPayload.recarga_automatica = false;
      }
      const { error: eCi } = await supabase.from('ciclo_empresa').upsert(cicloPayload, { onConflict: 'empresa_id' });
      if (eCi) throw new Error(`Falha ao salvar o ciclo: ${eCi.message}`);
      setCardStatus({ card: 'ciclo', success: 'Ciclo e cobrança salvos.' });
      setResetSignal(s => s + 1);
    } catch (err) {
      setCardStatus({ card: 'ciclo', error: errMsg(err, 'Não foi possível salvar.') });
    } finally { setCardBusy(''); }
  }

  async function salvarPrecosVigencia() {
    if (!supabase || !empresaId) return;
    setCardBusy('precos'); setCardStatus({ card: 'precos' });
    try {
      const vig = vigencia === 'atual' ? 'atual' : 'proximo';
      if (vig === 'atual' && motivoVigencia.trim().length < 5) throw new Error('Informe o motivo da vigência neste ciclo (5 a 200 caracteres).');
      let valeDesde = '';
      for (const [codigo, ed] of Object.entries(alterados)) {
        const itemNome = itens.find(it => String(it.codigo) === codigo)?.nome ?? codigo;
        const min = Number(itens.find(it => String(it.codigo) === codigo)?.preco_minimo ?? 0);
        const abaixo = (ed.modelo === 'flat' || ed.modelo === 'mensalidade') && parseNum(ed.preco) > 0 && parseNum(ed.preco) < min;
        const payload: Record<string, unknown> = { empresa: empresaId, item: codigo, modelo: ed.modelo, vigencia: vig };
        if (ed.modelo === 'flat' || ed.modelo === 'mensalidade') {
          payload.preco = parseNum(ed.preco);
          payload.minimo = ed.modelo === 'mensalidade' ? 0 : parseNum(ed.minimo);
          payload.faixas = null;
        } else {
          payload.preco = null;
          payload.minimo = parseNum(ed.minimo);
          payload.faixas = ed.faixas.map((f, i, arr) => ({ ate: i === arr.length - 1 ? null : Number(f.ate), preco: parseNum(f.preco) }));
        }
        payload.motivo_abaixo_do_minimo = abaixo ? (ed.motivo ?? '').trim() || null : null;
        payload.motivo_vigencia = vig === 'atual' ? motivoVigencia.trim() : null;
        const { error: ePr, data } = await supabase.rpc('salvar_preco_vigencia', payload);
        if (ePr) throw new Error(`Falha ao salvar o preço do ${itemNome}: ${ePr.message}`);
        if (!valeDesde && (data as Row)?.vale_desde) valeDesde = String((data as Row).vale_desde);
      }
      const { data: pr } = await supabase.from('precos_empresa').select('*, precos_faixas(*)').eq('empresa_id', empresaId).order('vigente_desde', { ascending: false });
      setPrecosEmpresa((pr ?? []) as Row[]);
      setAlterados({});
      setMotivoVigencia('');
      setVigencia('proximo');
      setCardStatus({ card: 'precos', success: `Preço salvo. Vale a partir de ${valeDesde ? mesExtenso(valeDesde) : 'próximo ciclo'} e ficou na Auditoria.` });
      setResetSignal(s => s + 1);
    } catch (err) {
      setCardStatus({ card: 'precos', error: errMsg(err, 'Não foi possível salvar os preços.') });
    } finally { setCardBusy(''); }
  }

  if (loading) {
    return <p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p>;
  }

  // ---- Modo editar: três cartões (Motor e módulos · Ciclo e cobrança · Preços) ----
  if (!isNova) {
    const podeMotorCiclo = can('editar_contratacao');
    const podePrecos = can('editar_precos');
    const modsList = [
      modulos.orquestracao && 'Orquestração',
      modulos.jornada && 'Jornada',
      modulos.mensageria && 'Mensageria',
      modulos.api && 'API',
      modulos.enriquecimento && 'Enriquecimento',
    ].filter(Boolean) as string[];
    const cicloLabel = periodicidade === 'mensal' ? `Mensal · dia ${diaCorte}` : periodicidade === 'semanal' ? 'Semanal' : periodicidade === 'quinzenal' ? 'Quinzenal' : `A cada ${cicloDias} dias`;
    const formasLabel = formas.map(f => FORMAS_PAG.find(x => x.id === f)?.curto ?? f).join(', ');
    const precosAlterados = Object.keys(alterados).length > 0;
    const podeSalvarPrecos = precosAlterados && (vigencia !== 'atual' || motivoVigencia.trim().length >= 5);

    return (
      <div className="space-y-5">
        <PainelEdicao
          titulo="Motor e módulos"
          podeEditar={podeMotorCiclo}
          motivoBloqueio="Só Master altera módulos e ciclo"
          resetSignal={resetSignal}
          salvando={cardBusy === 'motor'}
          erro={cardStatus?.card === 'motor' ? cardStatus.error : undefined}
          sucesso={cardStatus?.card === 'motor' ? cardStatus.success : undefined}
          podeRevisar={frentes.length > 0}
          podeSalvar={frentes.length > 0}
          onSalvar={salvarMotorModulos}
          resumo={(
            <div className="space-y-3">
              <div><p className="text-[12px] font-semibold text-[#8E8E93]">MOTOR</p><p className="text-[15px] text-[#1D1D1F]">{frentes.length ? frentes.map(f => FRENTES[f].nome).join(' + ') : '—'}</p></div>
              <div><p className="text-[12px] font-semibold text-[#8E8E93]">MÓDULOS</p><p className="text-[15px] text-[#1D1D1F]">{modsList.length ? modsList.join(', ') : '—'}</p></div>
              {modulos.mensageria && canais.length > 0 && <div><p className="text-[12px] font-semibold text-[#8E8E93]">CANAIS</p><p className="text-[15px] text-[#1D1D1F]">{canais.map(c => c.toUpperCase()).join(', ')}</p></div>}
            </div>
          )}
          form={(
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Motor contratado</p>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.values(FRENTES) as { id: FrenteId; nome: string; area: string; cor: string; sigla: string }[]).map(f => {
                    const on = frentes.includes(f.id);
                    return (
                      <button key={f.id} type="button" onClick={() => toggleFrente(f.id)} className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors ${on ? 'border-transparent' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`} style={on ? { backgroundColor: f.cor } : undefined}>
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: on ? 'rgba(255,255,255,.25)' : f.cor }}>{f.sigla}</span>
                        <span className="min-w-0"><span className="block text-[15px] font-semibold" style={{ color: on ? '#fff' : '#1D1D1F' }}>{f.nome}</span><span className="block text-[13px]" style={{ color: on ? 'rgba(255,255,255,.85)' : '#6E6E73' }}>{f.area}</span></span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="divide-y divide-[#F0F0F2]">
                {frentes.includes('motorcob') && <SwitchLinha label="Orquestração" desc="MotorCX: Lista do dia, réguas, personas e telefone Hot." checked={modulos.orquestracao} on={v => setModulos(p => ({ ...p, orquestracao: v }))} />}
                {frentes.includes('motorcli') && <SwitchLinha label="Jornada" desc="Jornada do Cliente: Momentos da jornada e lista do dia." checked={modulos.jornada} on={v => setModulos(p => ({ ...p, jornada: v }))} />}
                <SwitchLinha label="Mensageria" desc="SMS, e-mail, RCS e WhatsApp" checked={modulos.mensageria} on={v => setModulos(p => ({ ...p, mensageria: v }))} />
                {modulos.mensageria && (
                  <div className="py-3 pl-1"><div className="flex flex-wrap gap-2">{[{ id: 'sms', nome: 'SMS' }, { id: 'email', nome: 'E-mail' }, { id: 'rcs', nome: 'RCS' }, { id: 'whatsapp', nome: 'WhatsApp' }].map(c => { const on = canais.includes(c.id); return <button key={c.id} type="button" onClick={() => toggleCanal(c.id)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${on ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{c.nome}</button>; })}</div></div>
                )}
                <SwitchLinha label="API" desc="Cargas e Lista do dia pelo seu sistema" checked={modulos.api} on={v => setModulos(p => ({ ...p, api: v }))} />
                <SwitchLinha label="Enriquecimento" desc="Contatos novos para quem está sem canal" checked={modulos.enriquecimento} on={v => setModulos(p => ({ ...p, enriquecimento: v }))} />
              </div>
            </div>
          )}
          revisao={(
            <div className="space-y-2 text-[14px]">
              <div className="flex justify-between"><span className="text-[#6E6E73]">Motor</span><span className="font-medium text-[#1D1D1F]">{frentes.length ? frentes.map(f => FRENTES[f].nome).join(' + ') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6E6E73]">Módulos</span><span className="font-medium text-[#1D1D1F]">{modsList.length ? modsList.join(', ') : '—'}</span></div>
              {modulos.mensageria && <div className="flex justify-between"><span className="text-[#6E6E73]">Canais</span><span className="font-medium text-[#1D1D1F]">{canais.map(c => c.toUpperCase()).join(', ') || '—'}</span></div>}
            </div>
          )}
        />

        <PainelEdicao
          titulo="Ciclo e cobrança"
          podeEditar={podeMotorCiclo}
          motivoBloqueio="Só Master altera módulos e ciclo"
          resetSignal={resetSignal}
          salvando={cardBusy === 'ciclo'}
          erro={cardStatus?.card === 'ciclo' ? cardStatus.error : undefined}
          sucesso={cardStatus?.card === 'ciclo' ? cardStatus.success : undefined}
          podeRevisar={formas.length > 0}
          podeSalvar={formas.length > 0 && (modeloPag !== 'pre' || parseNum(recargaMinima) > 0)}
          onSalvar={salvarCicloCobranca}
          resumo={(
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-[14px] text-[#6E6E73]">Ciclo</span><span className="text-[14px] font-medium text-[#1D1D1F]">{cicloLabel}</span></div>
              <div className="flex justify-between"><span className="text-[14px] text-[#6E6E73]">Cobrança</span><span className="text-[14px] font-medium text-[#1D1D1F]">{modeloPag === 'pre' ? 'Pré-pago' : 'Pós-pago'}</span></div>
              <div className="flex justify-between"><span className="text-[14px] text-[#6E6E73]">Formas</span><span className="text-[14px] font-medium text-[#1D1D1F]">{formasLabel || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[14px] text-[#6E6E73]">Emissão</span><span className="text-[14px] font-medium text-[#1D1D1F]">{emissao === 'automatica' ? 'Automática' : 'Revisar antes'}</span></div>
              {modeloPag === 'pos' && <div className="flex justify-between"><span className="text-[14px] text-[#6E6E73]">Vencimento</span><span className="text-[14px] font-medium text-[#1D1D1F]">{prazoDias} dias após o fechamento</span></div>}
            </div>
          )}
          form={(
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Ciclo de uso</p>
                <Segmented value={periodicidade} on={setPeriodicidade} options={[{ id: 'semanal', label: 'Semanal' }, { id: 'quinzenal', label: 'Quinzenal' }, { id: 'mensal', label: 'Mensal' }, { id: 'outro', label: 'Outro' }]} />
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {periodicidade === 'mensal' ? <SelNum label="Dia de fechamento" value={diaCorte} on={setDiaCorte} /> : (<>{periodicidade === 'outro' && <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Duração do ciclo (dias)</span><input type="number" min={1} max={90} value={cicloDias} onChange={e => setCicloDias(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label>}<label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Início do primeiro ciclo</span><input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label></>)}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Cobrança</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => setModeloPag('pos')} className={`rounded-2xl border-2 p-4 text-left transition-colors ${modeloPag === 'pos' ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}><p className="text-[15px] font-semibold text-[#1D1D1F]">Pós-pago</p><p className="mt-0.5 text-[13px] text-[#6E6E73]">Usa no ciclo e paga a fatura depois.</p></button>
                  <button type="button" onClick={() => setModeloPag('pre')} className={`rounded-2xl border-2 p-4 text-left transition-colors ${modeloPag === 'pre' ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}><p className="text-[15px] font-semibold text-[#1D1D1F]">Pré-pago</p><p className="mt-0.5 text-[13px] text-[#6E6E73]">Recarrega um saldo e o uso desconta dele.</p></button>
                </div>
                <div className="mt-3">
                  <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Formas de pagamento aceitas</p>
                  <div className="flex flex-wrap gap-2">{FORMAS_PAG.map(f => { const on = formas.includes(f.id); return <button key={f.id} type="button" onClick={() => toggleForma(f.id)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${on ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{f.nome}</button>; })}</div>
                </div>
                {modeloPag === 'pos' && (
                  <div className="mt-3 space-y-3">
                    <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Prazo para pagar a fatura</span><select value={prazoDias} onChange={e => setPrazoDias(Number(e.target.value))} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">{[5, 10, 15, 30].map(d => <option key={d} value={d}>{d} dias após o fechamento</option>)}</select></label>
                    <div><span className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Emissão da fatura</span><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setEmissao('revisar')} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${emissao === 'revisar' ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Revisar antes (a equipe emite)</button><button type="button" onClick={() => setEmissao('automatica')} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${emissao === 'automatica' ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Automática no fim do ciclo</button></div><p className="mt-1.5 text-[12px] text-[#6E6E73]">{emissao === 'automatica' ? 'A fatura sai sozinha no fim do ciclo; a equipe só revisa se quiser.' : 'A equipe revisa o rascunho e emite pelo Console › Faturamento.'}</p></div>
                  </div>
                )}
                {modeloPag === 'pre' && (
                  <div className="mt-3 space-y-3">
                    <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Recarga mínima (R$)*</span><input value={recargaMinima} onChange={e => setRecargaMinima(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
                    <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Avisar quando o saldo ficar abaixo de (R$)</span><input value={avisoSaldo} onChange={e => setAvisoSaldo(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
                    <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Quando o saldo acabar</span><select value={aoZerar} onChange={e => setAoZerar(e.target.value as 'pausar' | 'continuar')} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]"><option value="pausar">Pausar os envios da Mensageria até a próxima recarga</option><option value="continuar">Continuar e descontar da próxima recarga</option></select></label>
                    {formas.includes('cartao') && <SwitchLinha label="Recarga automática no cartão" desc="Recarrega sozinho quando o saldo fica baixo." checked={recargaAutomatica} on={setRecargaAutomatica} />}
                  </div>
                )}
              </div>
            </div>
          )}
          revisao={(
            <div className="space-y-2 text-[14px]">
              <div className="flex justify-between"><span className="text-[#6E6E73]">Ciclo</span><span className="font-medium text-[#1D1D1F]">{cicloLabel}</span></div>
              <div className="flex justify-between"><span className="text-[#6E6E73]">Cobrança</span><span className="font-medium text-[#1D1D1F]">{modeloPag === 'pre' ? 'Pré-pago' : 'Pós-pago'}</span></div>
              <div className="flex justify-between"><span className="text-[#6E6E73]">Formas</span><span className="font-medium text-[#1D1D1F]">{formasLabel || '—'}</span></div>
              <div className="flex justify-between"><span className="text-[#6E6E73]">Emissão</span><span className="font-medium text-[#1D1D1F]">{emissao === 'automatica' ? 'Automática' : 'Revisar antes'}</span></div>
            </div>
          )}
        />

        <PainelEdicao
          titulo="Preços"
          podeEditar={podePrecos}
          motivoBloqueio="Só Master e Administrativo alteram preços"
          resetSignal={resetSignal}
          salvando={cardBusy === 'precos'}
          erro={cardStatus?.card === 'precos' ? cardStatus.error : undefined}
          sucesso={cardStatus?.card === 'precos' ? cardStatus.success : undefined}
          podeRevisar={precosAlterados}
          podeSalvar={podeSalvarPrecos}
          onSalvar={salvarPrecosVigencia}
          resumo={(
            <div className="overflow-hidden rounded-lg border border-[#E5E5EA]">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 bg-[#F5F5F7] px-3 py-2 text-[12px] font-semibold text-[#6E6E73]"><span>Item</span><span>Tipo</span><span className="text-right">Preço</span><span className="text-right">Desde</span></div>
              {itensContratados.filter(it => MOTOR_CODES.includes(String(it.codigo))).length === 0 ? <p className="px-3 py-4 text-center text-[13px] text-[#8E8E93]">Selecione um motor para ver os itens.</p> : itensContratados.filter(it => MOTOR_CODES.includes(String(it.codigo))).map(item => {
                const id = String(item.codigo);
                const itemPrecos = precosEmpresa.filter(p => String(p.item ?? '') === id);
                const vigente = precoVigente(itemPrecos, competencia);
                const unidade = UNIDADE_LABEL[id] ?? String(item.unidade ?? 'unidade');
                return (
                  <div key={id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-t border-[#F0F0F2] px-3 py-2 text-[13px] text-[#1D1D1F]">
                    <span>{item.nome}</span>
                    <span className="text-[#6E6E73]">{vigente ? MODELO_LABEL[String(vigente.modelo) as Modelo] : '—'}</span>
                    <span className="text-right tnum">{vigente ? precoTabela(vigente, unidade) : <span className="text-[#FF3B30]">Sem preço</span>}</span>
                    <span className="text-right tnum text-[#6E6E73]">{vigente?.vigente_desde ? mesExtenso(vigente.vigente_desde) : '—'}</span>
                  </div>
                );
              })}
            </div>
          )}
          form={(
            <div className="space-y-4">
              {itensContratados.filter(it => MOTOR_CODES.includes(String(it.codigo))).length === 0 ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Selecione um motor para ver os itens de cobrança.</p> : (
                <GrupoPreco titulo="MOTOR" itens={itensContratados.filter(it => MOTOR_CODES.includes(String(it.codigo)))} precosEmpresa={precosEmpresa} competencia={competencia} alterados={alterados} editando={editando} onEditar={setEditando} onAltera={(id, ed) => setAlterados(p => ({ ...p, [id]: ed }))} onHistorico={setHistoricoItem} />
              )}
            </div>
          )}
          revisao={(
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-[#1D1D1F]">Mudanças</p>
              {Object.entries(alterados).map(([codigo, ed]) => {
                const item = itens.find(it => String(it.codigo) === codigo);
                const itemPrecos = precosEmpresa.filter(p => String(p.item ?? '') === codigo);
                const vigente = precoVigente(itemPrecos, competencia);
                const unidade = UNIDADE_LABEL[codigo] ?? 'unidade';
                const oldStr = vigente ? precoTabela(vigente, unidade) : 'Sem preço';
                const newStr = ed.modelo === 'mensalidade' ? `${moneyBR(parseNum(ed.preco))}/ciclo` : ed.modelo === 'flat' ? precoCliente(parseNum(ed.preco), unidade) : 'Por faixa';
                return <div key={codigo} className="flex items-center justify-between gap-2 text-[13px]"><span className="text-[#1D1D1F]">{item?.nome ?? codigo}</span><span className="tnum"><span className="text-[#8E8E93] line-through">{oldStr}</span> → <span className="font-medium text-[#1D1D1F]">{newStr}</span></span></div>;
              })}
              {Object.keys(alterados).length === 0 && <p className="text-[13px] text-[#8E8E93]">Nenhuma mudança. Abra um item para alterar o preço.</p>}
              <div className="border-t border-[#F0F0F2] pt-3">
                <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">A partir de quando</p>
                <label className="flex items-start gap-2"><input type="radio" checked={vigencia === 'proximo'} onChange={() => setVigencia('proximo')} className="mt-1" /><span><span className="text-[14px] text-[#1D1D1F]">Próximo ciclo · {proximoCiclo ? mesExtenso(proximoCiclo) : '—'}</span><span className="block text-[12px] text-[#6E6E73]">A fatura atual continua com o preço atual.</span></span></label>
                <label className="mt-2 flex items-start gap-2"><input type="radio" checked={vigencia === 'atual'} onChange={() => setVigencia('atual')} className="mt-1" /><span><span className="text-[14px] text-[#1D1D1F]">Neste ciclo · desde {inicioCiclo ? dateBR(inicioCiclo) : '—'}</span><span className="block text-[12px] text-[#6E6E73]">Recalcula a prévia; o cliente vê o valor mudar.</span></span></label>
                {vigencia === 'atual' && <label className="mt-2 block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Motivo (o cliente não vê) *</span><input value={motivoVigencia} onChange={e => setMotivoVigencia(e.target.value)} className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Por que mudar neste ciclo" /></label>}
              </div>
            </div>
          )}
        />

        {canais.length > 0 && <MensageriaSection numero={3} empresaId={empresaId!} canais={canais} competencia={competencia} soPrecos={soPrecos} />}
        <ScoreSection numero={4} empresaId={empresaId!} competencia={competencia} />

        {historicoItem && <HistoricoModal item={historicoItem} precos={precosEmpresa.filter(p => String(p.item ?? '') === String(historicoItem.codigo))} onClose={() => setHistoricoItem(null)} />}
      </div>
    );
  }

  let secaoNum = 0;
  const num = () => ++secaoNum;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Coluna de seções */}
      <div className="space-y-5">
        {isNova && !soPrecos && (
          <Secao numero={num()} titulo="Empresa">
            <div className="grid gap-4 sm:grid-cols-2">
              <In label="Nome fantasia*" v={emp.nome} on={v => setEmp(p => ({ ...p, nome: v }))} />
              <In label="Razão social*" v={emp.razao_social} on={v => setEmp(p => ({ ...p, razao_social: v }))} />
              <In label="CNPJ" v={emp.cnpj ? formatCNPJ(emp.cnpj) : ''} on={v => setEmp(p => ({ ...p, cnpj: formatCNPJ(v) }))} />
              <Sel label="Segmento" v={emp.segmento} on={v => setEmp(p => ({ ...p, segmento: v }))} opts={SEGMENTOS} />
              <In label="Nome do Admin*" v={emp.admin_nome} on={v => setEmp(p => ({ ...p, admin_nome: v }))} />
              <In label="E-mail do Admin*" v={emp.admin_email} on={v => setEmp(p => ({ ...p, admin_email: v }))} />
            </div>
          </Secao>
        )}

        {/* 2. Motor contratado */}
        {!soPrecos && <Secao numero={num()} titulo="Motor contratado">
          <div className="grid grid-cols-2 gap-3">
            {(Object.values(FRENTES) as { id: FrenteId; nome: string; area: string; cor: string; sigla: string }[]).map(f => {
              const on = frentes.includes(f.id);
              return (
                <button key={f.id} type="button" onClick={() => toggleFrente(f.id)} className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-colors ${on ? 'border-transparent' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`} style={on ? { backgroundColor: f.cor } : undefined}>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[14px] font-bold text-white" style={{ backgroundColor: on ? 'rgba(255,255,255,.25)' : f.cor }}>{f.sigla}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold" style={{ color: on ? '#fff' : '#1D1D1F' }}>{f.nome}</span>
                    <span className="block text-[13px]" style={{ color: on ? 'rgba(255,255,255,.85)' : '#6E6E73' }}>{f.area}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-[#6E6E73]">
            {frentes.length === 2 ? 'No login, os usuários escolhem entre Cobrança e Jornada do Cliente.'
              : frentes[0] === 'motorcob' ? 'No login, todos entram direto no Cobrança. A Jornada do Cliente fica fechada para esta empresa.'
              : frentes[0] === 'motorcli' ? 'No login, todos entram direto na Jornada do Cliente. O Cobrança fica fechado para esta empresa.'
              : 'A empresa precisa de pelo menos um motor.'}
          </p>
        </Secao>}

        {/* 3. Módulos */}
        {!soPrecos && <Secao numero={num()} titulo="Módulos">
          <p className="mb-4 text-[13px] text-[#6E6E73]">Marque o que foi contratado. Orquestração e Jornada são módulos do motor: só ficam liberados se marcados.</p>
          <div className="divide-y divide-[#F0F0F2]">
            {frentes.includes('motorcob') && (
              <SwitchLinha label="Orquestração" desc="MotorCX: Lista do dia, réguas, personas e telefone Hot." checked={modulos.orquestracao} on={v => setModulos(p => ({ ...p, orquestracao: v }))} />
            )}
            {frentes.includes('motorcli') && (
              <SwitchLinha label="Jornada" desc="Jornada do Cliente: Momentos da jornada e lista do dia." checked={modulos.jornada} on={v => setModulos(p => ({ ...p, jornada: v }))} />
            )}
            <SwitchLinha label="Mensageria" desc="SMS, e-mail, RCS e WhatsApp" checked={modulos.mensageria} on={v => setModulos(p => ({ ...p, mensageria: v }))} />
            {modulos.mensageria && (
              <div className="py-3 pl-1">
                <div className="flex flex-wrap gap-2">
                  {[{ id: 'sms', nome: 'SMS' }, { id: 'email', nome: 'E-mail' }, { id: 'rcs', nome: 'RCS' }, { id: 'whatsapp', nome: 'WhatsApp' }].map(c => {
                    const on = canais.includes(c.id);
                    return (
                      <button key={c.id} type="button" onClick={() => toggleCanal(c.id)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${on ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{c.nome}</button>
                    );
                  })}
                </div>
              </div>
            )}
            <SwitchLinha label="API" desc="Cargas e Lista do dia pelo seu sistema" checked={modulos.api} on={v => setModulos(p => ({ ...p, api: v }))} />
            <SwitchLinha label="Enriquecimento" desc="Contatos novos para quem está sem canal" checked={modulos.enriquecimento} on={v => setModulos(p => ({ ...p, enriquecimento: v }))} />
          </div>
        </Secao>}

        {!isNova && canais.length > 0 && (
          <MensageriaSection numero={num()} empresaId={empresaId!} canais={canais} competencia={competencia} soPrecos={soPrecos} />
        )}

        {/* 4. Preços */}
        <Secao numero={num()} titulo="Preços">
          {itensContratados.length === 0 ? (
            <p className="py-4 text-center text-[14px] text-[#8E8E93]">Selecione um motor ou canal para ver os itens de cobrança.</p>
          ) : (
            <div className="space-y-4">
              <GrupoPreco titulo="MOTOR" itens={itensContratados.filter(it => MOTOR_CODES.includes(String(it.codigo)))} precosEmpresa={precosEmpresa} competencia={competencia} alterados={alterados} editando={editando} onEditar={setEditando} onAltera={(id, ed) => setAlterados(p => ({ ...p, [id]: ed }))} onHistorico={setHistoricoItem} />
              {isNova && <GrupoPreco titulo="MENSAGERIA" itens={itensContratados.filter(it => !MOTOR_CODES.includes(String(it.codigo)))} precosEmpresa={precosEmpresa} competencia={competencia} alterados={alterados} editando={editando} onEditar={setEditando} onAltera={(id, ed) => setAlterados(p => ({ ...p, [id]: ed }))} onHistorico={setHistoricoItem} />}
            </div>
          )}
        </Secao>

        {/* Score de Entrega */}
        {!isNova && <ScoreSection numero={num()} empresaId={empresaId!} competencia={competencia} />}

        {/* 5. Ciclo de uso */}
        {!soPrecos && <Secao numero={num()} titulo="Ciclo de uso">
          <Segmented value={periodicidade} on={setPeriodicidade} options={[
            { id: 'semanal', label: 'Semanal' }, { id: 'quinzenal', label: 'Quinzenal' }, { id: 'mensal', label: 'Mensal' }, { id: 'outro', label: 'Outro' },
          ]} />
          <p className="mt-3 text-[13px] text-[#6E6E73]">De quanto em quanto tempo o uso é fechado. O volume do escalonado e o mínimo valem por ciclo.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {periodicidade === 'mensal' ? (
              <SelNum label="Dia de fechamento" value={diaCorte} on={setDiaCorte} />
            ) : (
              <>
                {periodicidade === 'outro' && (
                  <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Duração do ciclo (dias)</span><input type="number" min={1} max={90} value={cicloDias} onChange={e => setCicloDias(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label>
                )}
                <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Início do primeiro ciclo</span><input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label>
              </>
            )}
          </div>
        </Secao>}

        {/* 6. Cobrança */}
        {!soPrecos && <Secao numero={num()} titulo="Cobrança">
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setModeloPag('pos')} className={`rounded-2xl border-2 p-4 text-left transition-colors ${modeloPag === 'pos' ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
              <p className="text-[15px] font-semibold text-[#1D1D1F]">Pós-pago</p>
              <p className="mt-0.5 text-[13px] text-[#6E6E73]">Usa no ciclo e paga a fatura depois.</p>
            </button>
            <button type="button" onClick={() => setModeloPag('pre')} className={`rounded-2xl border-2 p-4 text-left transition-colors ${modeloPag === 'pre' ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
              <p className="text-[15px] font-semibold text-[#1D1D1F]">Pré-pago</p>
              <p className="mt-0.5 text-[13px] text-[#6E6E73]">Recarrega um saldo e o uso desconta dele.</p>
            </button>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[13px] font-semibold text-[#1D1D1F]">Formas de pagamento aceitas</p>
            <div className="flex flex-wrap gap-2">
              {FORMAS_PAG.map(f => {
                const on = formas.includes(f.id);
                return <button key={f.id} type="button" onClick={() => toggleForma(f.id)} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${on ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{f.nome}</button>;
              })}
            </div>
          </div>

          {modeloPag === 'pos' && (
            <div className="mt-4 space-y-4">
              <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Prazo para pagar a fatura</span><select value={prazoDias} onChange={e => setPrazoDias(Number(e.target.value))} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">{[5, 10, 15, 30].map(d => <option key={d} value={d}>{d} dias após o fechamento</option>)}</select></label>
              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Emissão da fatura</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEmissao('revisar')} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${emissao === 'revisar' ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Revisar antes (a equipe emite)</button>
                  <button type="button" onClick={() => setEmissao('automatica')} className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${emissao === 'automatica' ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>Automática no fim do ciclo</button>
                </div>
                <p className="mt-1.5 text-[12px] text-[#6E6E73]">{emissao === 'automatica' ? 'A fatura sai sozinha no fim do ciclo; a equipe só revisa se quiser.' : 'A equipe revisa o rascunho e emite pelo Console › Faturamento.'}</p>
              </div>
            </div>
          )}

          {modeloPag === 'pre' && (
            <div className="mt-4 space-y-3">
              <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Recarga mínima (R$)*</span><input value={recargaMinima} onChange={e => setRecargaMinima(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
              <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Avisar quando o saldo ficar abaixo de (R$)</span><input value={avisoSaldo} onChange={e => setAvisoSaldo(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
              <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Quando o saldo acabar</span><select value={aoZerar} onChange={e => setAoZerar(e.target.value as 'pausar' | 'continuar')} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[15px] outline-none focus:border-[#1D1D1F]"><option value="pausar">Pausar os envios da Mensageria até a próxima recarga</option><option value="continuar">Continuar e descontar da próxima recarga</option></select></label>
              {formas.includes('cartao') && (
                <SwitchLinha label="Recarga automática no cartão" desc="Recarrega sozinho quando o saldo fica baixo." checked={recargaAutomatica} on={setRecargaAutomatica} />
              )}
            </div>
          )}
        </Secao>}
      </div>

      {/* Coluna lateral */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {!soPrecos && <CicloCard ciclo={ciclo} />}
        {!soPrecos && <ResumoCard frentes={frentes} modulos={modulos} canais={canais} itensContratados={itensContratados} itensSemPreco={itensSemPreco} modeloPag={modeloPag} formas={formas} />}
        {error && <p role="alert" className="rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</p>}
        {success && <p role="status" className="rounded-xl bg-[#E8F8EC] px-4 py-3 text-[14px] text-[#248A3D]">{success}</p>}
        <button onClick={isNova ? criar : salvar} disabled={busy} className="h-11 w-full rounded-xl bg-[#1D1D1F] text-[15px] font-semibold text-white hover:opacity-85 disabled:opacity-50">
          {busy ? 'Salvando...' : isNova ? 'Criar empresa' : 'Salvar'}
        </button>
      </div>

      {historicoItem && (
        <HistoricoModal
          item={historicoItem}
          precos={precosEmpresa.filter(p => String(p.item ?? '') === String(historicoItem.codigo))}
          onClose={() => setHistoricoItem(null)}
        />
      )}
    </div>
  );
}

// ---------- subcomponentes ----------

function Secao({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1D1D1F] text-[12px] font-bold text-white">{numero}</span>
        <h2 className="text-[16px] font-semibold text-[#1D1D1F]">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, on, options }: { value: T; on: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex rounded-[12px] bg-[#EEEEF0] p-1">
      {options.map(o => (
        <button key={o.id} type="button" onClick={() => on(o.id)} className={`flex-1 rounded-[9px] px-2 py-1.5 text-[13px] font-medium transition-colors ${value === o.id ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{o.label}</button>
      ))}
    </div>
  );
}

function In({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">{label}</span><input value={v} onChange={e => on(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" /></label>;
}
function Sel({ label, v, on, opts }: { label: string; v: string; on: (v: string) => void; opts: Record<string, string> }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">{label}</span><select value={v} onChange={e => on(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]"><option value="">—</option>{Object.entries(opts).map(([k, val]) => <option key={k} value={k}>{val}</option>)}</select></label>;
}
function SelNum({ label, value, on }: { label: string; value: number; on: (v: number) => void }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">{label}</span><select value={value} onChange={e => on(Number(e.target.value))} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">{Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d === 1 ? 'Dia 1 (mês fechado)' : `Dia ${d}`}</option>)}</select></label>;
}

function SwitchLinha({ label, desc, checked, on }: { label: string; desc: string; checked: boolean; on: (v: boolean) => void }) {
  return (
    <Chave
      className="py-3"
      label={<span className="text-[15px] font-medium text-[#1D1D1F]">{label}</span>}
      desc={desc}
      checked={checked}
      on={on}
    />
  );
}

function GrupoPreco({ titulo, itens, precosEmpresa, competencia, alterados, editando, onEditar, onAltera, onHistorico }: {
  titulo: string; itens: Row[]; precosEmpresa: Row[]; competencia: string; alterados: Record<string, PrecoEdit>;
  editando: string | null; onEditar: (id: string | null) => void; onAltera: (id: string, ed: PrecoEdit) => void; onHistorico: (item: Row) => void;
}) {
  if (itens.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold tracking-wide text-[#8E8E93]">{titulo}</p>
      <div className="divide-y divide-[#F0F0F2]">
        {itens.map(item => {
          const id = String(item.codigo);
          const itemPrecos = precosEmpresa.filter(p => String(p.item ?? '') === id);
          const alterado = alterados[id];
          const alteradoValido = alterado ? precoEditValido(alterado) : false;
          const vigente = alterado ? null : precoVigente(itemPrecos, competencia);
          const unidade = UNIDADE_LABEL[id] ?? String(item.unidade ?? 'unidade');
          const temPreco = alteradoValido || !!vigente;
          const aberto = editando === id;
          return (
            <div key={id}>
              <button type="button" onClick={() => onEditar(aberto ? null : id)} className="flex w-full items-center justify-between gap-3 py-3 text-left">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[#1D1D1F]">{item.nome}</p>
                  <p className="text-[13px] text-[#6E6E73]">por {unidade}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {temPreco ? (
                    <span className="text-right text-[13px] text-[#1D1D1F]">
                      {alterado ? <span className="text-[#0A60D0]">editado</span> : <>{MODELO_LABEL[String(vigente!.modelo) as Modelo]} · {resumoPreco(vigente!, unidade)}</>}
                    </span>
                  ) : <span className="text-[13px] font-medium text-[#FF3B30]">Sem preço</span>}
                  <button type="button" onClick={(e) => { e.stopPropagation(); onHistorico(item); }} className="text-[12px] font-semibold text-[#0A60D0] hover:underline">Histórico</button>
                  <ChevronDown size={16} className={`text-[#8E8E93] transition ${aberto ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {aberto && (
                <PrecoEditor
                  item={item}
                  precosEmpresa={itemPrecos}
                  competencia={competencia}
                  edit={alterado}
                  onChange={ed => onAltera(id, ed)}
                  onClose={() => onEditar(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PrecoEditor({ item, precosEmpresa, competencia, edit, onChange, onClose }: {
  item: Row; precosEmpresa: Row[]; competencia: string; edit: PrecoEdit | undefined;
  onChange: (ed: PrecoEdit) => void; onClose: () => void;
}) {
  const id = String(item.codigo);
  const isMotor = MOTOR_CODES.includes(id);
  const vigente = precoVigente(precosEmpresa, competencia);
  const unidade = UNIDADE_LABEL[id] ?? String(item.unidade ?? 'unidade');

  const [modelo, setModelo] = useState<Modelo>(edit?.modelo ?? String(vigente?.modelo ?? 'flat') as Modelo);
  const [preco, setPreco] = useState(edit?.preco ?? String(vigente?.preco ?? ''));
  const [minimo, setMinimo] = useState(edit?.minimo ?? String(vigente?.minimo ?? ''));
  const [faixas, setFaixas] = useState<Faixa[]>(() => {
    if (edit?.faixas) return edit.faixas;
    const fs: Row[] = Array.isArray(vigente?.precos_faixas) ? (vigente!.precos_faixas as Row[]) : [];
    if (fs.length > 0) return fs.map(f => ({ ate: f.ate == null ? '' : String(f.ate), preco: String(f.preco ?? '') }));
    return [{ ate: '', preco: '' }, { ate: '', preco: '' }];
  });
  const [volume, setVolume] = useState('');
  const [motivo, setMotivo] = useState(edit?.motivo ?? '');
  const { can } = useConsolePerms();

  const min = Number(item.preco_minimo ?? 0);
  const abaixoMin = (modelo === 'flat' || modelo === 'mensalidade') && parseNum(preco) > 0 && parseNum(preco) < min;
  const podeAbaixo = can('preco_abaixo_minimo');

  // sincroniza mudanças para o pai
  useEffect(() => {
    onChange({ modelo, preco, minimo, faixas, motivo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, preco, minimo, faixas, motivo]);

  const modelos: Modelo[] = isMotor ? ['flat', 'faixa', 'progressivo', 'mensalidade'] : ['flat', 'faixa', 'progressivo'];
  const mostraMinimo = modelo !== 'mensalidade';
  const mostraFaixas = modelo === 'faixa' || modelo === 'progressivo';
  const valorSim = simular(modelo, preco, minimo, faixas, volume);

  function addFaixa() { setFaixas(prev => [...prev.slice(0, -1), { ate: '', preco: '' }, prev[prev.length - 1]]); }
  function removeFaixa(i: number) { setFaixas(prev => prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)); }
  function setFaixa(i: number, campo: 'ate' | 'preco', val: string) { setFaixas(prev => prev.map((f, idx) => idx === i ? { ...f, [campo]: val } : f)); }

  return (
    <div className="rounded-xl border border-[#E5E5EA] bg-[#FAFAFB] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[14px] font-semibold text-[#1D1D1F]">{item.nome}</p>
        <button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={18} /></button>
      </div>
      <div className="mb-3 flex rounded-[12px] bg-[#EEEEF0] p-1">
        {modelos.map(m => (
          <button key={m} type="button" onClick={() => setModelo(m)} className={`flex-1 rounded-[9px] px-2 py-1.5 text-[12px] font-medium transition-colors ${modelo === m ? 'bg-white text-[#1D1D1F] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#1D1D1F] hover:bg-[#E8E8ED]'}`}>{MODELO_LABEL[m]}</button>
        ))}
      </div>
      <p className="mb-3 text-[12px] text-[#6E6E73]">{MODELO_AJUDA[modelo]}</p>

      <div className="space-y-3">
        {modelo === 'flat' && (
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Preço por {unidade} (R$)</span><input value={preco} onChange={e => setPreco(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00000" /></label>
        )}
        {modelo === 'mensalidade' && (
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Valor por ciclo (R$)</span><input value={preco} onChange={e => setPreco(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
        )}
        {abaixoMin && (
          <div className="rounded-lg bg-[#FFE8E6] px-3 py-2">
            <p className="text-[12px] font-medium text-[#FF3B30]">Preço abaixo do mínimo ({preco4BR(min)}).</p>
            {podeAbaixo ? (
              <label className="mt-1.5 block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Motivo (vai para a Auditoria) *</span><input value={motivo} onChange={e => setMotivo(e.target.value)} className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Por que abaixo do mínimo" /></label>
            ) : <p className="mt-1 text-[12px] text-[#FF3B30]">Abaixo do mínimo só com o Administrativo.</p>}
          </div>
        )}

        {mostraFaixas && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#1D1D1F]">Faixas</span>
              <button type="button" onClick={addFaixa} className="flex h-7 items-center gap-1 rounded-lg border border-[#D2D2D7] px-2.5 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Plus size={13} /> Faixa</button>
            </div>
            <div className="overflow-hidden rounded-lg border border-[#E5E5EA] bg-white">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 bg-[#F5F5F7] px-3 py-2 text-[12px] font-semibold text-[#6E6E73]"><span>Até (quantidade)</span><span>Preço (R$)</span><span /></div>
              {faixas.map((f, i) => {
                const ultima = i === faixas.length - 1;
                const limiteAnterior = i > 0 ? faixas[i - 1].ate : '';
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-t border-[#F0F0F2] px-3 py-2">
                    {ultima ? <span className="text-[14px] text-[#1D1D1F]">Acima de {numberBR(limiteAnterior)}</span>
                      : <input value={f.ate} onChange={e => setFaixa(i, 'ate', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="0" />}
                    <input value={f.preco} onChange={e => setFaixa(i, 'preco', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-lg border border-[#D2D2D7] px-2 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="0,00000" />
                    <button type="button" onClick={() => removeFaixa(i)} disabled={ultima || faixas.length <= 2} aria-label="Remover faixa" className="grid h-9 w-9 place-items-center rounded-lg text-[#8E8E93] hover:bg-[#F5F5F7] disabled:opacity-30"><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {mostraMinimo && (
          <label className="block"><span className="mb-1 block text-[13px] font-semibold text-[#1D1D1F]">Mínimo por ciclo (R$)</span><input value={minimo} onChange={e => setMinimo(e.target.value)} inputMode="decimal" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[15px] outline-none focus:border-[#1D1D1F]" placeholder="0,00" /></label>
        )}

        {modelo !== 'mensalidade' && (
          <div className="rounded-lg bg-white p-3">
            <label className="block"><span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Simular volume no ciclo</span><input value={volume} onChange={e => setVolume(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="0" /></label>
            <p className="mt-2 text-[14px] text-[#1D1D1F]">{moneyBR(valorSim)} total{Number(volume || 0) > 0 ? ` · média ${preco5BR(valorSim / Number(volume))}` : ''}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CicloCard({ ciclo }: { ciclo: Row }) {
  const inicioStr = String(ciclo.inicio ?? ciclo.uso_inicio ?? '');
  const fimStr = String(ciclo.fim ?? ciclo.uso_fim ?? '');
  const rows: [string, string][] = [['Mês de referência', mesExtenso(ciclo.competencia)]];
  if (inicioStr && fimStr) rows.push(['Uso', `${dateBR(inicioStr)} a ${dateBR(fimStr)}`]);
  if (ciclo.fecha_em) rows.push(['Fatura fecha', dateBR(ciclo.fecha_em)]);
  if (ciclo.vence_em) rows.push(['Vence', dateBR(ciclo.vence_em)]);
  return (
    <div className="rounded-2xl bg-[#F5F5F7] p-5">
      <h3 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">Ciclo atual</h3>
      <dl className="space-y-2">
        {rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-2 text-[13px]"><dt className="text-[#6E6E73]">{k}</dt><dd className="font-medium text-[#1D1D1F] tnum">{v}</dd></div>)}
      </dl>
    </div>
  );
}

function ResumoCard({ frentes, modulos, canais, itensContratados, itensSemPreco, modeloPag, formas }: {
  frentes: FrenteId[]; modulos: ModulosState; canais: string[];
  itensContratados: Row[]; itensSemPreco: Row[]; modeloPag: ModeloPag; formas: string[];
}) {
  const bits: string[] = [];
  if (frentes.length) bits.push(frentes.map(f => FRENTES[f].nome).join(' + '));
  const mods: string[] = [];
  if (modulos.orquestracao) mods.push('Orquestração');
  if (modulos.jornada) mods.push('Jornada');
  if (modulos.mensageria) mods.push('Mensageria');
  if (modulos.api) mods.push('API');
  if (modulos.enriquecimento) mods.push('Enriquecimento');
  if (mods.length) bits.push(mods.join(', '));
  if (modulos.mensageria && canais.length) bits.push(canais.join(', ').toUpperCase());
  bits.push(`${itensContratados.length} itens de cobrança`);
  const formasLabel = formas.map(f => FORMAS_PAG.find(x => x.id === f)?.curto ?? f).join(', ');
  bits.push(`Cobrança: ${modeloPag === 'pre' ? 'Pré-pago' : 'Pós-pago'}${formasLabel ? ' · ' + formasLabel : ''}`);
  return (
    <div className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
      <h3 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">Resumo</h3>
      <ul className="space-y-1.5 text-[13px] text-[#1D1D1F]">
        {bits.map((b, i) => <li key={i} className="flex gap-2"><span className="text-[#34C759]">✓</span><span>{b}</span></li>)}
      </ul>
      {itensSemPreco.length > 0 && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[#FF9500]"><Info size={13} /> Falta preço em {itensSemPreco.map(i => i.nome).join(', ')}</p>}
    </div>
  );
}

export function HistoricoModal({ item, precos, onClose }: { item: Row; precos: Row[]; onClose: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const ordenados = [...precos].sort((a, b) => String(b.vigente_desde ?? '').localeCompare(String(a.vigente_desde ?? '')));
  const unidade = UNIDADE_LABEL[String(item.codigo)] ?? String(item.unidade ?? 'unidade');
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-[440px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold text-[#1D1D1F]">Histórico · {item.nome}</h2><button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button></div>
        {ordenados.length === 0 ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Sem vigências registradas.</p> :
          <div className="divide-y divide-[#F0F0F2]">{ordenados.map((p, i) => (
            <div key={i} className="py-3">
              <p className="text-[14px] font-medium text-[#1D1D1F]">{MODELO_LABEL[String(p.modelo) as Modelo] ?? p.modelo} · desde {mesExtenso(p.vigente_desde)}</p>
              <p className="mt-0.5 text-[13px] text-[#6E6E73]">{resumoPreco(p, unidade)}</p>
              {Number(p.minimo ?? 0) > 0 && <p className="mt-0.5 text-[13px] text-[#6E6E73]">mínimo {moneyBR(p.minimo)}</p>}
            </div>
          ))}</div>}
        <div className="mt-5 flex justify-end"><button onClick={onClose} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Fechar</button></div>
      </div>
    </div>
  );
}

// ---------- Seção Mensageria (Contratação, modo editar) ----------

type ProdutoMsg = {
	codigo: string;
	canal: string;
	nome: string;
	preco_minimo: number;
	preco_tabela: number;
	rota_completa: boolean;
	problemas: string[] | null;
};

function normalizarProdutoMsg(r: Row): ProdutoMsg {
	return {
		codigo: String(r.codigo ?? ''),
		canal: String(r.canal ?? ''),
		nome: String(r.nome ?? ''),
		preco_minimo: Number(r.preco_minimo ?? 0),
		preco_tabela: Number(r.preco_tabela ?? 0),
		rota_completa: !!r.rota_completa,
		problemas: Array.isArray(r.problemas) ? (r.problemas as string[]) : null,
	};
}

function MensageriaSection({ numero, empresaId, canais, competencia, soPrecos }: {
	numero: number; empresaId: string; canais: string[]; competencia: string; soPrecos: boolean;
}) {
	const { can, isMaster } = useConsolePerms();
	const podeAbaixo = isMaster || can('preco_abaixo_minimo');
	const [produtos, setProdutos] = useState<ProdutoMsg[]>([]);
	const [empProdutos, setEmpProdutos] = useState<Record<string, boolean>>({});
	const [precos, setPrecos] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const [pc, ep, pr] = await Promise.all([
			supabase.rpc('produtos_catalogo'),
			supabase.from('empresa_produtos').select('item,ativo').eq('empresa_id', empresaId),
			supabase.from('precos_empresa').select('*, precos_faixas(*)').eq('empresa_id', empresaId),
		]);
		if (pc.error) { setError(friendlyError(pc.error)); setLoading(false); return; }
		setProdutos(((pc.data ?? []) as Row[]).map(normalizarProdutoMsg).filter(p => canais.includes(p.canal)));
		const epMap: Record<string, boolean> = {};
		((ep.data ?? []) as Row[]).forEach(r => { epMap[String(r.item)] = !!r.ativo; });
		setEmpProdutos(epMap);
		setPrecos((pr.data ?? []) as Row[]);
		setLoading(false);
	}
	useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [empresaId]);

	async function toggleProduto(p: ProdutoMsg, on: boolean) {
		if (!supabase || soPrecos) return;
		if (on) {
			const temPreco = precoVigente(precos.filter(x => String(x.item ?? '') === p.codigo), competencia);
			if (!temPreco) return; // não liga sem preço — o campo de preço já está visível
		}
		const { error: e } = await supabase.from('empresa_produtos').upsert({ empresa_id: empresaId, item: p.codigo, ativo: on }, { onConflict: 'empresa_id,item' });
		if (e) { setError(friendlyError(e)); return; }
		setEmpProdutos(prev => ({ ...prev, [p.codigo]: on }));
	}

	return (
		<Secao numero={numero} titulo="Mensageria">
			<p className="mb-4 text-[13px] text-[#6E6E73]">Ligue os produtos contratados e negocie o preço entre o mínimo e a tabela. Abaixo do mínimo só o Administrativo.</p>
			{error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
			{loading ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Carregando produtos...</p> : (
				<div className="divide-y divide-[#F0F0F2]">
					{produtos.length === 0 ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Nenhum produto para os canais contratados.</p> :
						produtos.map(p => (
							<ProdutoMensageriaLinha
								key={p.codigo}
								produto={p}
								ativo={!!empProdutos[p.codigo]}
								precos={precos.filter(x => String(x.item ?? '') === p.codigo)}
								competencia={competencia}
								empresaId={empresaId}
								soPrecos={soPrecos}
								podeAbaixo={podeAbaixo}
								onToggle={on => toggleProduto(p, on)}
								onSalvo={() => void reload()}
							/>
						))}
				</div>
			)}
		</Secao>
	);
}

function ProdutoMensageriaLinha({ produto, ativo, precos, competencia, empresaId, soPrecos, podeAbaixo, onToggle, onSalvo }: {
	produto: ProdutoMsg; ativo: boolean; precos: Row[]; competencia: string; empresaId: string;
	soPrecos: boolean; podeAbaixo: boolean; onToggle: (on: boolean) => void; onSalvo: () => void;
}) {
	const vigente = precoVigente(precos, competencia);
	const [preco, setPreco] = useState(vigente?.preco != null ? String(vigente.preco) : '');
	const [motivo, setMotivo] = useState('');
	const [busy, setBusy] = useState(false);
	const [erro, setErro] = useState('');
	const [salvo, setSalvo] = useState(false);

	// sincroniza quando a vigência muda (após recarregar)
	useEffect(() => { setPreco(vigente?.preco != null ? String(vigente.preco) : ''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vigente?.preco]);

	const min = produto.preco_minimo;
	const tab = produto.preco_tabela;
	const val = parseNum(preco);
	const abaixoMin = val > 0 && val < min;
	const semPreco = !vigente;
	const rotaOk = produto.rota_completa;
	const ligadoDisabled = soPrecos || !rotaOk;
	const podeSalvar = val > 0 && (!abaixoMin || (podeAbaixo && motivo.trim().length >= 3)) && !busy;

	async function salvar() {
		if (!supabase) return;
		setErro(''); setSalvo(false);
		if (val <= 0) { setErro('Informe o preço.'); return; }
		setBusy(true);
		const { error: e } = await supabase.rpc('salvar_preco', {
			empresa: empresaId, item: produto.codigo, modelo: 'flat',
			preco: val, minimo: min, faixas: null, vigente_desde: competencia,
			motivo: abaixoMin && podeAbaixo ? motivo.trim() : null,
		});
		setBusy(false);
		if (e) { setErro('Não conseguimos salvar o preço. Tente de novo; se repetir, abra um chamado.'); return; }
		setSalvo(true);
		onSalvo();
	}

	return (
		<div className="py-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-[15px] font-medium text-[#1D1D1F]">
						{produto.nome} <span className="ml-1 font-mono text-[11px] text-[#8E8E93]">{produto.codigo}</span>
					</p>
					<p className="mt-0.5 text-[12px] text-[#6E6E73]">Mínimo {preco4BR(min)} · Tabela {preco4BR(tab)}</p>
					{!rotaOk && <p className="mt-0.5 text-[12px] text-[#9a631b]">Rota incompleta: <Link to="/console/produtos" className="font-medium text-[#0A60D0] hover:underline">monte a rota antes</Link></p>}
					{semPreco && rotaOk && <p className="mt-0.5 text-[12px] text-[#9a631b]">Sem preço — defina antes de ligar.</p>}
				</div>
				<div className="flex flex-col items-end gap-1">
					<Chave checked={ativo} disabled={ligadoDisabled} on={onToggle} />
					{soPrecos && <span className="text-[10px] text-[#8E8E93]">só preço</span>}
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-end gap-3">
				<label className="block">
					<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Preço (R$)</span>
					<input
						value={preco} onChange={e => { setPreco(e.target.value); setSalvo(false); }} inputMode="decimal"
						className={`h-9 w-[140px] rounded-lg border px-3 text-[14px] tnum outline-none focus:border-[#1D1D1F] ${abaixoMin ? 'border-[#FF3B30] text-[#FF3B30]' : 'border-[#D2D2D7] text-[#1D1D1F]'}`}
						placeholder="0,0000"
					/>
				</label>
				{abaixoMin && podeAbaixo && (
					<label className="block flex-1 min-w-[180px]">
						<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Motivo (vai para a Auditoria) *</span>
						<input value={motivo} onChange={e => setMotivo(e.target.value)} className="h-9 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] outline-none focus:border-[#1D1D1F]" placeholder="Por que abaixo do mínimo" />
					</label>
				)}
				<button onClick={salvar} disabled={!podeSalvar} className="h-9 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar preço'}</button>
			</div>

			{abaixoMin && !podeAbaixo && <p className="mt-2 text-[12px] font-medium text-[#FF3B30]">Abaixo do mínimo só com o Administrativo.</p>}
			{salvo && !abaixoMin && <p className="mt-2 text-[12px] text-[#248A3D]">Preço salvo.</p>}
			{erro && (
				<div className="mt-2 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">
					{erro}
					<ErrorDetail />
				</div>
			)}
		</div>
	);
}

// ---------- Seção Score de Entrega (Contratação, modo editar) ----------

type CobrancaScore = 'analisado' | 'represado';
const SCORE_ITENS: { codigo: string; cobranca: CobrancaScore; nome: string; desc: string }[] = [
	{ codigo: 'score_analisado', cobranca: 'analisado', nome: 'Por número analisado', desc: 'Cobre toda a lista enviada ao filtro.' },
	{ codigo: 'score_represado', cobranca: 'represado', nome: 'Só pelos represados', desc: 'Cobra só os números que o filtro segurou.' },
];

function ScoreSection({ numero, empresaId, competencia }: { numero: number; empresaId: string; competencia: string }) {
	const { can } = useConsolePerms();
	const pode = can('contratar_score');
	const [ativo, setAtivo] = useState(false);
	const [cobranca, setCobranca] = useState<CobrancaScore>('analisado');
	const [itens, setItens] = useState<Row[]>([]);
	const [precos, setPrecos] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [busyCfg, setBusyCfg] = useState(false);
	const [busyPreco, setBusyPreco] = useState<string | null>(null);
	const [error, setError] = useState('');
	const [successCfg, setSuccessCfg] = useState('');
	const [successPreco, setSuccessPreco] = useState<string | null>(null);

	async function reload() {
		if (!supabase) return;
		setLoading(true); setError('');
		const [sc, it, pr] = await Promise.all([
			supabase.from('empresa_score').select('*').eq('empresa_id', empresaId).maybeSingle(),
			supabase.from('cobranca_itens').select('*').in('codigo', ['score_analisado', 'score_represado']),
			supabase.from('precos_empresa').select('*').eq('empresa_id', empresaId).in('item', ['score_analisado', 'score_represado']),
		]);
		const scRow = sc.data as Row | null;
		setAtivo(!!scRow?.ativo);
		setCobranca((scRow?.cobranca as CobrancaScore) ?? 'analisado');
		setItens((it.data ?? []) as Row[]);
		const prMap: Record<string, string> = {};
		((pr.data ?? []) as Row[]).forEach(p => {
			const codigo = String(p.item ?? '');
			const arr = (pr.data as Row[]).filter(x => String(x.item ?? '') === codigo);
			const vig = precoVigente(arr, competencia);
			prMap[codigo] = vig?.preco != null ? String(vig.preco) : '';
		});
		setPrecos(prMap);
		setLoading(false);
	}
	useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [empresaId]);

	async function salvarConfig(novoAtivo: boolean, novaCobranca: CobrancaScore) {
		if (!supabase || !pode) return;
		setBusyCfg(true); setError(''); setSuccessCfg('');
		const { error: e } = await supabase.from('empresa_score').upsert(
			{ empresa_id: empresaId, ativo: novoAtivo, cobranca: novaCobranca },
			{ onConflict: 'empresa_id' },
		);
		setBusyCfg(false);
		if (e) { setError(friendlyError(e)); return; }
		setAtivo(novoAtivo); setCobranca(novaCobranca);
		setSuccessCfg('Configuração do Score salva.');
	}

	async function salvarPreco(codigo: string) {
		if (!supabase || !pode) return;
		const val = parseNum(precos[codigo] ?? '');
		const item = itens.find(i => String(i.codigo) === codigo);
		const min = Number(item?.preco_minimo ?? 0);
		setError(''); setSuccessPreco(null);
		if (val <= 0) { setError('Informe o preço.'); return; }
		if (val < min) { setError(`O preço não pode ficar abaixo do mínimo (${preco4BR(min)}).`); return; }
		setBusyPreco(codigo);
		let vigenteDesde = competencia;
		try { const { data } = await supabase.rpc('competencia_de', { empresa: empresaId, dia: competencia }); if (data) vigenteDesde = String(data); } catch { /* usa hoje */ }
		const { error: e } = await supabase.rpc('salvar_preco', {
			empresa: empresaId, item: codigo, modelo: 'flat', preco: val, minimo: min, faixas: null, vigente_desde: vigenteDesde, motivo: null,
		});
		setBusyPreco(null);
		if (e) { setError('Não conseguimos salvar o preço. Tente de novo; se repetir, abra um chamado.'); return; }
		setSuccessPreco(codigo);
		void reload();
	}

	if (!pode) return null;

	return (
		<Secao numero={numero} titulo="Score de Entrega">
			{loading ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : (
				<div className="space-y-4">
					<Chave
						label={<span className="text-[15px] font-medium text-[#1D1D1F]">Score de Entrega</span>}
						desc="Filtra números por probabilidade de entrega antes do envio do SMS."
						checked={ativo}
						disabled={busyCfg}
						on={v => salvarConfig(v, cobranca)}
					/>

					{ativo && (
						<>
							<div>
								<span className="mb-2 block text-[13px] font-semibold text-[#1D1D1F]">Forma de cobrança</span>
								<div className="grid gap-3 sm:grid-cols-2">
									{SCORE_ITENS.map(s => {
										const on = cobranca === s.cobranca;
										return (
											<button key={s.codigo} type="button" onClick={() => salvarConfig(ativo, s.cobranca)} disabled={busyCfg} className={`rounded-2xl border-2 p-4 text-left transition-colors ${on ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
												<p className="text-[15px] font-semibold text-[#1D1D1F]">{s.nome}</p>
												<p className="mt-0.5 text-[13px] text-[#6E6E73]">{s.desc}</p>
											</button>
										);
									})}
								</div>
							</div>

							<div className="rounded-xl border border-[#F0F0F2] p-4">
								<p className="mb-3 text-[13px] font-semibold text-[#1D1D1F]">Preço do Score</p>
								<p className="mb-3 text-[12px] text-[#6E6E73]">O SMS segue com o preço padrão do contrato; o Score é cobrado à parte.</p>
								<div className="space-y-4">
									{SCORE_ITENS.map(s => {
										const item = itens.find(i => String(i.codigo) === s.codigo);
										const min = Number(item?.preco_minimo ?? 0);
										const tab = Number(item?.preco_tabela ?? 0);
										const sel = cobranca === s.cobranca;
										return (
											<div key={s.codigo} className={`rounded-lg border p-3 ${sel ? 'border-[#1D1D1F]' : 'border-[#E5E5EA]'}`}>
												<div className="flex items-center justify-between gap-2">
													<p className="text-[14px] font-medium text-[#1D1D1F]">{s.nome}</p>
													{sel && <span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[10px] font-semibold text-[#248A3D]">selecionado</span>}
												</div>
												<p className="mt-0.5 text-[12px] text-[#6E6E73]">Mínimo {preco4BR(min)} · Tabela {preco4BR(tab)}</p>
												<div className="mt-2 flex flex-wrap items-end gap-3">
													<label className="block">
														<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Preço (R$)</span>
														<input
															value={precos[s.codigo] ?? ''}
															onChange={e => setPrecos(prev => ({ ...prev, [s.codigo]: e.target.value }))}
															inputMode="decimal"
															className="h-9 w-[140px] rounded-lg border border-[#D2D2D7] px-3 text-[14px] tnum outline-none focus:border-[#1D1D1F]"
															placeholder="0,0000"
														/>
													</label>
													<button onClick={() => salvarPreco(s.codigo)} disabled={busyPreco === s.codigo} className="h-9 rounded-lg bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busyPreco === s.codigo ? 'Salvando...' : 'Salvar preço'}</button>
													{successPreco === s.codigo && <span className="text-[12px] text-[#248A3D]">Preço salvo.</span>}
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</>
					)}

					{error && <div className="rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">{error}<ErrorDetail /></div>}
					{successCfg && <p className="text-[13px] text-[#248A3D]">{successCfg}</p>}
				</div>
			)}
		</Secao>
	);
}
