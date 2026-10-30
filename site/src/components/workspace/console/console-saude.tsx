import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, moneyBR, type Row } from '@/lib/supabase';
import { SITUACOES, haQuanto } from '@/lib/empresa-helpers';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms } from './console-perms';

type Nivel = 'critico' | 'atencao' | 'ok';

const DOT: Record<string, string> = { critico: '#FF3B30', atencao: '#FF9500', ok: '#34C759' };
const STATUS_ROTINA: Record<string, string> = { ok: 'Concluída', erro: 'Com erro', rodando: 'Em andamento' };

function num(r: Row | undefined, k: string): number {
  if (!r) return 0;
  const v = r[k];
  return typeof v === 'number' ? v : Number(v ?? 0);
}
function str(r: Row | undefined, k: string): string {
  if (!r) return '';
  const v = r[k];
  return v == null ? '' : String(v);
}

export function ConsoleSaudePage() {
  const { selectEmpresa } = useMotorAuth();
  const { eu, can } = useConsolePerms();
  const navigate = useNavigate();
  const [empresas, setEmpresas] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qualAlertas, setQualAlertas] = useState<Row[]>([]);
  const [qualLoading, setQualLoading] = useState(false);

  async function reload() {
    if (!supabase) return;
    const { data, error: rpcError } = await supabase.rpc('saude_empresas');
    if (rpcError) { setError(friendlyError(rpcError)); setLoading(false); return; }
    setError('');
    setEmpresas((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => {
    void reload();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Alertas de qualidade (SMS + RCS) — só quem tem ver_qualidade vê.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setQualLoading(true);
    (async () => {
      const [s, r] = await Promise.all([
        supabase.rpc('alertas_qualidade', { canal: 'sms' }),
        supabase.rpc('alertas_qualidade', { canal: 'rcs' }),
      ]);
      if (!active) return;
      setQualAlertas([...((s.data ?? []) as Row[]), ...((r.data ?? []) as Row[])]);
      setQualLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const criticas = empresas.filter(e => str(e, 'nivel') === 'critico').length;
  const atencao = empresas.filter(e => str(e, 'nivel') === 'atencao').length;
  const ok = empresas.filter(e => str(e, 'nivel') === 'ok').length;
  const vencido = empresas.reduce((s, e) => s + num(e, 'valor_vencido'), 0);

  async function ir(empresaId: string, path: string) {
    await selectEmpresa(empresaId);
    navigate(path);
  }

  return (
    <ConsoleShell>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi titulo="Críticas" valor={String(criticas)} cor="#D70015" />
        <Kpi titulo="Pedem atenção" valor={String(atencao)} cor="#B25000" />
        <Kpi titulo="Em dia" valor={String(ok)} cor="#248A3D" />
        <Kpi titulo="Faturas vencidas" valor={moneyBR(vencido)} cor="#1D1D1F" />
      </div>

      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

      <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          empresas.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">{eu?.alcance === 'carteira' ? 'Nenhuma empresa na sua carteira ainda. Peça ao Master para te colocar como Vendedor ou Gerente de uma conta.' : 'Nenhuma empresa ativa ainda.'}</p> :
            <div className="space-y-3">
              {empresas.map(e => <EmpresaSaude key={(e.empresa_id ?? e.id) as string} e={e} onIr={ir} />)}
            </div>}
      </section>

      {can('ver_qualidade') && (
        <section className="mt-4 rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
          <h2 className="mb-3 text-[17px] font-semibold text-[#1D1D1F]">Alertas de qualidade</h2>
          {qualLoading ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
           qualAlertas.length === 0 ? <p className="rounded-xl bg-[#F5F5F7] px-4 py-6 text-center text-[14px] text-[#8E8E93]">Nenhum alerta de qualidade aberto.</p> :
           <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
             {qualAlertas.map((a, i) => {
               const nivel = String(a.nivel ?? 'atencao');
               const critico = nivel === 'critico';
               return (
                 <div key={i} className="rounded-xl border p-4" style={{ borderColor: critico ? '#FF3B30' : '#FF9500', backgroundColor: critico ? '#FFE8E6' : '#FFF7E8' }}>
                   <div className="mb-1 flex items-center gap-2">
                     <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: critico ? '#FF3B30' : '#FF9500' }}>{critico ? 'Crítico' : 'Atenção'}</span>
                     <span className="text-[13px] font-semibold text-[#1D1D1F]">{String(a.fornecedor ?? '—')}</span>
                   </div>
                   {a.operadora ? <p className="text-[12px] text-[#6E6E73]">Operadora: {String(a.operadora)}</p> : null}
                   <p className="mt-1 text-[13px] text-[#1D1D1F]">{String(a.motivo ?? '')}</p>
                 </div>
               );
             })}
           </div>}
        </section>
      )}
    </ConsoleShell>
  );
}

function Kpi({ titulo, valor, cor }: { titulo: string; valor: string; cor: string }) {
  return <div className="rounded-2xl bg-[#F5F5F7] p-5"><p className="text-[13px] text-[#6E6E73]">{titulo}</p><p className="mt-1 text-[22px] font-bold tracking-tight tnum" style={{ color: cor }}>{valor}</p></div>;
}

function Pill({ cor, bg, children, onClick }: { cor: string; bg: string; children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-1" style={{ backgroundColor: bg, color: cor }}>{children}</button>;
}

function EmpresaSaude({ e, onIr }: { e: Row; onIr: (id: string, path: string) => void }) {
  const id = (e.empresa_id ?? e.id) as string;
  const nivel = (str(e, 'nivel') || 'ok') as Nivel;
  const sit = SITUACOES[str(e, 'situacao')] ?? SITUACOES.ativa;
  const rotinaStatus = STATUS_ROTINA[str(e, 'ultima_rotina_status')] ?? 'ok';
  const rotinaErro = str(e, 'ultima_rotina_erro');
  const rotinaHoje = e.rotina_hoje;
  const cargasErro = num(e, 'cargas_erro_7d');
  const cargasAguardando = num(e, 'cargas_aguardando');
  const lotesParados = num(e, 'lotes_parados');
  const lotesAguardando = num(e, 'lotes_aguardando');
  const chamadosAtrasados = num(e, 'chamados_atrasados');
  const faturasVencidas = num(e, 'faturas_vencidas');
  const valorVencido = num(e, 'valor_vencido');

  const temAlerta = rotinaErro || (rotinaHoje === false && nivel === 'critico') || cargasErro || cargasAguardando || lotesParados || lotesAguardando || chamadosAtrasados || faturasVencidas;

  return (
    <div className="rounded-xl border border-[#F0F0F2] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: DOT[nivel] }} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold text-[#1D1D1F]">{str(e, 'nome') || '—'}</p>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>
            </div>
            <p className="mt-0.5 text-[13px] text-[#6E6E73]">Última rotina {haQuanto(str(e, 'ultima_rotina_em')) || '—'} · {rotinaStatus}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {rotinaErro && <Pill cor="#FF3B30" bg="#FFE8E6" onClick={() => onIr(id, '/empresa')}>Rotina com erro: {rotinaErro}</Pill>}
          {rotinaHoje === false && nivel === 'critico' && <Pill cor="#FF3B30" bg="#FFE8E6" onClick={() => onIr(id, '/orquestracao')}>Rotina de hoje não rodou</Pill>}
          {cargasErro > 0 && <Pill cor="#9a631b" bg="#FFF3E8" onClick={() => onIr(id, '/envios')}>{cargasErro} carga{cargasErro === 1 ? '' : 's'} com erro</Pill>}
          {cargasAguardando > 0 && <Pill cor="#9a631b" bg="#FFF3E8" onClick={() => onIr(id, '/credores')}>{cargasAguardando} carga{cargasAguardando === 1 ? '' : 's'} aguardando mapeamento</Pill>}
          {lotesParados > 0 && <Pill cor="#9a631b" bg="#FFF3E8" onClick={() => onIr(id, '/canais')}>{lotesParados} lote{lotesParados === 1 ? '' : 's'} parado{lotesParados === 1 ? '' : 's'}</Pill>}
          {lotesAguardando > 0 && <Pill cor="#9a631b" bg="#FFF3E8" onClick={() => onIr(id, '/canais')}>{lotesAguardando} lote{lotesAguardando === 1 ? '' : 's'} aguardando aprovação</Pill>}
          {chamadosAtrasados > 0 && <Pill cor="#FF3B30" bg="#FFE8E6" onClick={() => onIr(id, `/console/atendimento?empresa=${id}`)}>{chamadosAtrasados} chamado{chamadosAtrasados === 1 ? '' : 's'} atrasado{chamadosAtrasados === 1 ? '' : 's'}</Pill>}
          {faturasVencidas > 0 && <Pill cor="#FF3B30" bg="#FFE8E6" onClick={() => onIr(id, '/console/faturamento')}>{faturasVencidas} fatura{faturasVencidas === 1 ? '' : 's'} vencida{faturasVencidas === 1 ? '' : 's'} · R$ {moneyBR(valorVencido)}</Pill>}
          {!temAlerta && <span className="text-[13px] font-semibold" style={{ color: '#248A3D' }}>Tudo em dia</span>}
        </div>
      </div>
    </div>
  );
}
