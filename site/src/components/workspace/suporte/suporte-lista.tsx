import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { MOTIVOS_CHAMADO } from '@/lib/empresa-helpers';
import { WorkspaceHeading } from '@/components/workspace/workspace-shell';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

const CAMPOS = 'id,protocolo,assunto,motivo,prioridade,situacao,responsavel_nome,ultima_de,ultima_em,visto_cliente_em,criado_em,prazo_resposta';

/** Chamado com resposta da equipe que o cliente ainda não viu (só se não resolvido). */
function novaResposta(r: Row): boolean {
  if (r.situacao === 'resolvido') return false;
  if (r.ultima_de !== 'equipe') return false;
  if (!r.ultima_em) return false;
  if (!r.visto_cliente_em) return true;
  return new Date(String(r.visto_cliente_em)).getTime() < new Date(String(r.ultima_em)).getTime();
}

/** Situação do chamado para o cliente (nunca em vermelho, mesmo atrasada). */
function sitInfo(r: Row): { label: string; cor: string; bg: string } {
  const s = String(r.situacao ?? 'aberto');
  if (s === 'resolvido') return { label: 'Resolvido', cor: '#248A3D', bg: '#E8F8EC' };
  if (s === 'aguardando_cliente') return { label: 'Aguardando você', cor: '#9a631b', bg: '#FFF3E8' };
  if (s === 'em_atendimento') {
    return r.responsavel_nome
      ? { label: `Em atendimento · ${r.responsavel_nome}`, cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' }
      : { label: 'Em atendimento', cor: '#0A60D0', bg: 'rgba(10,96,208,.1)' };
  }
  return { label: 'Aberto', cor: '#6E6E73', bg: '#F5F5F7' };
}

/** prazo_resposta em "hoje 17:00", "amanhã 11:00" ou "seg 09:00"; vazio → "—". */
function prazoBR(v: unknown): string {
  if (!v) return '—';
  try {
    const target = new Date(String(v));
    if (isNaN(target.getTime())) return '—';
    const fmtDate = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const fmtTime = (d: Date) =>
      new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
    const now = new Date();
    const todayStr = fmtDate(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = fmtDate(tomorrow);
    const targetStr = fmtDate(target);
    const time = fmtTime(target);
    if (targetStr === todayStr) return `hoje ${time}`;
    if (targetStr === tomorrowStr) return `amanhã ${time}`;
    const wd = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(target).replace('.', '');
    return `${wd} ${time}`;
  } catch { return '—'; }
}

/** Ordem: 0 = Aguardando você, 1 = abertos, 2 = resolvidos. */
function rank(s: string): number {
  if (s === 'aguardando_cliente') return 0;
  if (s === 'resolvido') return 2;
  return 1;
}

export function SuporteListaPage() {
  const { empresa } = useMotorAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true); setError('');
    const { data, error } = await supabase.from('chamados').select(CAMPOS).eq('empresa_id', empresa.id);
    if (error) { setError(friendlyError(error)); setRows([]); }
    else setRows(data ?? []);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id]);

  // Atualiza ao voltar de uma conversa (resposta marcada como vista).
  useEffect(() => {
    function onVisto() { void reload(); }
    window.addEventListener('mc:suporte-visto', onVisto);
    return () => window.removeEventListener('mc:suporte-visto', onVisto);
  }, []);

  const ordenados = [...rows].sort((a, b) => {
    const ra = rank(String(a.situacao)), rb = rank(String(b.situacao));
    if (ra !== rb) return ra - rb;
    const da = new Date(String(a.ultima_em ?? a.criado_em)).getTime();
    const db = new Date(String(b.ultima_em ?? b.criado_em)).getTime();
    return db - da;
  });

  if (!empresa) return <div className="mx-auto max-w-[960px] px-4 py-10"><div className="rounded-2xl bg-white p-10 text-center text-[#6E6E73]" style={{ boxShadow: cardShadow }}>Escolha a empresa no topo.</div></div>;

  return (
    <div className="mx-auto max-w-[960px] px-4 py-8">
      <WorkspaceHeading title="Suporte" description="Resposta em até 1 dia útil · prioridade alta em até 4 horas úteis" actions={<Link to="/suporte/novo" className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Abrir chamado</Link>} />
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}
      <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          ordenados.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhum chamado por aqui. Precisa de ajuda? Abra um chamado.</p> :
          <div className="mc-tabela-container">
            {/* Desktop: tabela */}
            <table className="mc-tabela-desktop w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E5EA] text-[12px] text-[#8E8E93]">
                  <th className="pb-3 font-medium">Chamado</th>
                  <th className="pb-3 font-medium">Motivo</th>
                  <th className="pb-3 font-medium">Situação</th>
                  <th className="pb-3 font-medium">Resposta até</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {ordenados.map(r => {
                  const sit = sitInfo(r);
                  const motivo = MOTIVOS_CHAMADO.find(m => m.id === r.motivo)?.label ?? r.motivo;
                  const nova = novaResposta(r);
                  return (
                    <tr key={r.id} className="group">
                      <td className="py-3 pr-3">
                        <Link to={`/suporte/${r.id}`} className="block rounded-lg -mx-1 px-1 py-0.5 hover:bg-[#F5F5F7]">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-[#8E8E93] tnum">{r.protocolo}</span>
                            {nova && <span className="rounded-full bg-[#FF3B30] px-2 py-0.5 text-[11px] font-semibold text-white">Nova resposta</span>}
                          </div>
                          <p className={`mt-0.5 truncate text-[15px] text-[#1D1D1F] ${nova ? 'font-bold' : 'font-semibold'}`}>{r.assunto ?? '—'}</p>
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-[14px] text-[#6E6E73]">{motivo}</td>
                      <td className="py-3 pr-3">
                        <Link to={`/suporte/${r.id}`} className="inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold hover:opacity-80" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</Link>
                      </td>
                      <td className="py-3 text-[14px] text-[#6E6E73] tnum">{prazoBR(r.prazo_resposta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Celular: cartão por chamado */}
            <div className="mc-tabela-cards space-y-3">
              {ordenados.map(r => {
                const sit = sitInfo(r);
                const motivo = MOTIVOS_CHAMADO.find(m => m.id === r.motivo)?.label ?? r.motivo;
                const nova = novaResposta(r);
                return (
                  <Link key={r.id} to={`/suporte/${r.id}`} className="block rounded-xl border border-[#E5E5EA] bg-white p-4 hover:bg-[#F5F5F7]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-[#8E8E93] tnum">{r.protocolo}</span>
                      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <p className={`flex-1 truncate text-[15px] text-[#1D1D1F] ${nova ? 'font-bold' : 'font-semibold'}`}>{r.assunto ?? '—'}</p>
                      {nova && <span className="shrink-0 rounded-full bg-[#FF3B30] px-2 py-0.5 text-[11px] font-semibold text-white">Nova</span>}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[13px] text-[#6E6E73]">
                      <span className="truncate">{motivo}</span>
                      <span className="shrink-0 tnum">{prazoBR(r.prazo_resposta)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>}
      </section>
    </div>
  );
}
