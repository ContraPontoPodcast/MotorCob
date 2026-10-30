// Helpers compartilhados pelas páginas de Empresa, Console e Faturamento.

export const SEGMENTOS: Record<string, string> = {
  assessoria: 'Assessoria de cobrança',
  banco: 'Banco',
  financeira: 'Financeira',
  fintech: 'Fintech',
  varejo: 'Varejo',
  securitizadora: 'Securitizadora / FIDC',
  utilities_telecom: 'Utilities e telecom',
  educacao: 'Educação',
  outro: 'Outro',
};

export const SITUACOES: Record<string, { label: string; cor: string; bg: string }> = {
  implantacao: { label: 'Em implantação', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' },
  ativa: { label: 'Ativa', cor: '#248A3D', bg: '#E8F8EC' },
  suspensa: { label: 'Suspensa', cor: '#9a631b', bg: '#FFF3E8' },
  encerrada: { label: 'Encerrada', cor: '#8E8E93', bg: '#F5F5F7' },
  inadimplente: { label: 'Inadimplente', cor: '#FF3B30', bg: '#FFE8E6' },
  liberada: { label: 'Liberada', cor: '#9a631b', bg: '#FFF3E8' },
};

export const PAPEL_CONTATO: Record<string, string> = {
  operacional: 'Operacional',
  financeiro: 'Financeiro',
  legal: 'Jurídico',
  tecnico: 'Técnico',
};

export const MODULOS_INFO: { id: string; nome: string; desc: string; canais?: boolean; fixo?: boolean }[] = [
  { id: 'orquestracao', nome: 'Orquestração', desc: 'Lista do dia, réguas e personas' },
  { id: 'mensageria', nome: 'Mensageria', desc: 'SMS, e-mail, RCS e WhatsApp', canais: true },
  { id: 'enriquecimento', nome: 'Enriquecimento', desc: 'Contatos novos para quem está sem canal' },
  { id: 'api', nome: 'API', desc: 'Cargas e Lista do dia pelo seu sistema' },
];

export const CANAIS_MSG: { id: string; nome: string; cor: string }[] = [
  { id: 'sms', nome: 'SMS', cor: '#7A4FB0' },
  { id: 'email', nome: 'E-mail', cor: '#A2552B' },
  { id: 'rcs', nome: 'RCS', cor: '#3B5BA9' },
  { id: 'whatsapp', nome: 'WhatsApp', cor: '#1F8A4C' },
];

export const SIT_FATURA: Record<string, { label: string; cor: string; bg: string }> = {
  aberta: { label: 'Em aberto', cor: '#9a631b', bg: '#FFF3E8' },
  paga: { label: 'Paga', cor: '#248A3D', bg: '#E8F8EC' },
  vencida: { label: 'Vencida', cor: '#FF3B30', bg: '#FFE8E6' },
  cancelada: { label: 'Cancelada', cor: '#8E8E93', bg: '#F5F5F7' },
};

export const SIT_CHAMADO: Record<string, { label: string; cor: string; bg: string }> = {
  aberto: { label: 'Aberto', cor: '#6E6E73', bg: '#F5F5F7' },
  em_atendimento: { label: 'Em atendimento', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' },
  aguardando_cliente: { label: 'Aguardando você', cor: '#9a631b', bg: '#FFF3E8' },
  resolvido: { label: 'Resolvido', cor: '#248A3D', bg: '#E8F8EC' },
};

/** Rótulo de situação do chamado; inclui "· com {responsavel_nome}" quando em atendimento. */
export function sitChamadoLabel(situacao: string, responsavelNome?: string | null): { label: string; cor: string; bg: string } {
  const base = SIT_CHAMADO[situacao] ?? SIT_CHAMADO.aberto;
  if (situacao === 'em_atendimento' && responsavelNome) {
    return { ...base, label: `Em atendimento · com ${responsavelNome}` };
  }
  return base;
}

export const MOTIVOS_CHAMADO: { id: string; label: string }[] = [
  { id: 'acesso', label: 'Acesso e login' },
  { id: 'lista_do_dia', label: 'Lista do dia e orquestração' },
  { id: 'arquivos', label: 'Envio de arquivos e cargas' },
  { id: 'mensageria', label: 'Mensageria' },
  { id: 'faturamento', label: 'Faturamento' },
  { id: 'integracao', label: 'Integração e API' },
  { id: 'sugestao', label: 'Sugestão de melhoria' },
  { id: 'outro', label: 'Outro' },
];

/** Itens de consumo_mes → rótulo amigável. */
export const CONSUMO_LABEL: Record<string, string> = {
  contratos: 'Contratos',
  sms: 'SMS',
  email: 'E-mail',
  rcs_basic: 'RCS Basic',
  rcs_single: 'RCS Single',
  rcs_conversacional: 'RCS Conversacional',
  whatsapp: 'WhatsApp',
  sms_resposta: 'SMS · respostas',
};

/** Cor da barra de consumo por item. */
export function consumoCor(item: string): string {
  if (item === 'contratos') return '#1D1D1F';
  if (item.startsWith('whatsapp')) return '#1F8A4C';
  if (item.startsWith('rcs')) return '#3B5BA9';
  if (item === 'email') return '#A2552B';
  if (item === 'sms') return '#7A4FB0';
  return '#8E8E93';
}

/** Formata CNPJ: 00000000000000 → 00.000.000/0000-00. */
export function formatCNPJ(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Formata CEP: 00000000 → 00000-000. */
export function formatCEP(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Formata telefone: (11) 99999-9999. */
export function formatTelefone(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
}

/** Valida CNPJ pelos dígitos verificadores. */
export function validarCNPJ(cnpj: string): boolean {
  const d = (cnpj || '').replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: number) => {
    let s = 0;
    let pos = base - 7;
    for (let i = 0; i < base; i++) {
      s += Number(d[i]) * pos;
      pos = pos === 2 ? 9 : pos - 1;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Slug a partir do nome fantasia. */
export function slugEmpresa(nome: string): string {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Monta uma Date local a partir de "AAAA-MM-DD" sem deslocar o fuso do Brasil. */
export function dataLocal(s: unknown): Date {
  if (!s) return new Date(NaN);
  const str = String(s);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(str);
}

/** Mês por extenso (competência AAAA-MM ou data). */
export function mesExtenso(v: unknown): string {
  if (!v) return '—';
  try {
    const s = String(v);
    const date = s.length === 7 ? dataLocal(`${s}-01`) : dataLocal(s);
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
  } catch { return String(v); }
}

/** Mês curto a partir de uma competência (AAAA-MM ou data ISO): "set/2026". */
export function mesCurto(v: unknown): string {
  if (!v) return '—';
  try {
    const s = String(v);
    const date = s.length === 7 ? dataLocal(`${s}-01`) : dataLocal(s);
    const mes = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '').toLowerCase();
    const ano = new Intl.DateTimeFormat('en-CA', { year: 'numeric' }).format(date);
    return `${mes}/${ano}`;
  } catch { return String(v); }
}

/** "há quanto tempo" a partir de uma data ISO. */
export function haQuanto(v: unknown): string {
  if (!v) return '';
  try {
    const t = new Date(String(v)).getTime();
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `há ${d} d`;
    const me = Math.floor(d / 30);
    if (me < 12) return `há ${me} ${me === 1 ? 'mês' : 'meses'}`;
    const a = Math.floor(me / 12);
    return `há ${a} ${a === 1 ? 'ano' : 'anos'}`;
  } catch { return ''; }
}

/** Primeiro dia do mês atual (ISO). */
export function primeiroDiaMes(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()) + '-01';
}

/** Primeiro dia do mês anterior (ISO). */
export function primeiroDiaMesAnterior(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d) + '-01';
}

/** Lista de meses (competências AAAA-MM) dos últimos n meses, mais recente primeiro. */
export function ultimosMeses(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < n; i++) {
    out.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d) + '-01');
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** Preço unitário com até 3 casas. */
export function precoBR(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Resumo do navegador a partir do userAgent. */
export function resumoNavegador(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const sistemas: [string, string][] = [
    ['Windows', 'Windows'],
    ['Mac', 'Mac'],
    ['Android', 'Android'],
    ['iPhone|iPad|iPod', 'iOS'],
    ['Linux', 'Linux'],
  ];
  const navegadores: [string, string][] = [
    ['Edg', 'Edge'],
    ['Chrome', 'Chrome'],
    ['Firefox', 'Firefox'],
    ['Safari', 'Safari'],
  ];
  let sis = '';
  for (const [k, v] of sistemas) { if (new RegExp(k).test(ua)) { sis = v; break; } }
  let nav = '';
  for (const [k, v] of navegadores) { if (ua.includes(k)) { nav = v; break; } }
  return [sis, nav].filter(Boolean).join(' · ');
}
