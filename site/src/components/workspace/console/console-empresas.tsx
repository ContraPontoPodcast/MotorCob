import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Search, X } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, dateBR, numberBR, moneyBR, type Row } from '@/lib/supabase';
import { SEGMENTOS, SITUACOES, formatCNPJ } from '@/lib/empresa-helpers';
import { ConsoleShell, cardShadow } from './console-shell';
import { ContratacaoEmpresa } from '@/components/workspace/empresa/contratacao-empresa';
import { useConsolePerms, useFrentesMap } from './console-perms';
import { FrenteBadges } from './frente-badge';

export function ConsoleEmpresasPage() {
  const { selectEmpresa } = useMotorAuth();
  const navigate = useNavigate();
  const { can } = useConsolePerms();
  const frentesMap = useFrentesMap();
  const [empresas, setEmpresas] = useState<Row[]>([]);
  const [kpi, setKpi] = useState({ ativas: 0, implantacao: 0, chamados: 0, faturas: 0 });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const podeCriar = can('criar_empresa');

  async function reload() {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from('empresas').select('id,nome,razao_social,cnpj,situacao,situacao_motivo,segmento,cliente_desde,slug,ativa').order('nome');
    if (error) { setLoading(false); return; }
    setEmpresas(data ?? []);
    const list = data ?? [];
    const [ch, fa] = await Promise.all([
      supabase.from('chamados').select('id', { count: 'exact', head: true }).neq('situacao', 'resolvido'),
      supabase.from('faturas').select('valor_total').in('situacao', ['aberta', 'vencida']),
    ]);
    setKpi({
      ativas: list.filter(e => e.situacao === 'ativa').length,
      implantacao: list.filter(e => e.situacao === 'implantacao').length,
      chamados: ch.count ?? 0,
      faturas: (fa.data ?? []).reduce((s, r) => s + Number(r.valor_total ?? 0), 0),
    });
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  const filtradas = empresas.filter(e => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return (e.nome ?? '').toLowerCase().includes(t) || (e.razao_social ?? '').toLowerCase().includes(t) || formatCNPJ(e.cnpj).includes(t);
  });

  async function abrirEmpresa(e: Row) {
    await selectEmpresa(e.id);
    navigate('/empresa');
  }

  return (
    <ConsoleShell>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi titulo="Empresas ativas" valor={numberBR(kpi.ativas)} />
        <Kpi titulo="Em implantação" valor={numberBR(kpi.implantacao)} />
        <Kpi titulo="Chamados abertos" valor={numberBR(kpi.chamados)} />
        <Kpi titulo="Faturas em aberto" valor={moneyBR(kpi.faturas)} />
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar empresa" className="h-9 w-[260px] rounded-lg bg-white pl-9 pr-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/30" style={{ boxShadow: cardShadow }} />
        </div>
        {podeCriar && <button onClick={() => setOpen(true)} className="flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[14px] font-medium text-white hover:opacity-85"><Plus size={16} /> Nova empresa</button>}
      </div>

      <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          filtradas.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhuma empresa na sua carteira ainda. Peça ao Master para te colocar como Vendedor ou Gerente de uma conta.</p> :
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Empresa</th><th className="pb-3 font-medium">Frentes</th><th className="pb-3 font-medium">CNPJ</th><th className="pb-3 font-medium">Segmento</th><th className="pb-3 font-medium">Situação</th><th className="pb-3 font-medium">Cliente desde</th></tr></thead>
            <tbody className="divide-y divide-[#F0F0F2]">{filtradas.map(e => { const sit = SITUACOES[e.situacao as string] ?? SITUACOES.ativa; return (
              <tr key={e.id} className="cursor-pointer hover:bg-[#F5F5F7]" onClick={() => abrirEmpresa(e)}>
                <td className="py-3"><p className="font-semibold text-[#1D1D1F]">{e.nome}</p><p className="text-[12px] text-[#8E8E93]">{e.razao_social}</p></td>
                <td className="py-3"><FrenteBadges frentes={frentesMap[e.id]} /></td>
                <td className="py-3 text-[#6E6E73] tnum">{e.cnpj ? formatCNPJ(e.cnpj) : '—'}</td>
                <td className="py-3 text-[#6E6E73]">{SEGMENTOS[e.segmento as string] ?? '—'}</td>
                <td className="py-3"><span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sit.bg, color: sit.cor }}>{sit.label}</span>{e.situacao === 'inadimplente' && e.situacao_motivo && <p className="mt-1 text-[11px] text-[#FF3B30]">{e.situacao_motivo}</p>}</td>
                <td className="py-3 text-[#6E6E73]">{e.cliente_desde ? dateBR(e.cliente_desde) : '—'}</td>
              </tr>); })}</tbody>
          </table></div>}
      </section>

      {open && <NovaEmpresaModal onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void reload(); }} />}
    </ConsoleShell>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: string }) {
  return <div className="rounded-2xl bg-[#F5F5F7] p-5"><p className="text-[13px] text-[#6E6E73]">{titulo}</p><p className="mt-1 text-[22px] font-bold tracking-tight tnum" style={{ color: 'var(--base-texto)' }}>{valor}</p></div>;
}

function NovaEmpresaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="mx-auto w-full max-w-[960px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between"><h2 className="text-[20px] font-semibold text-[#1D1D1F]">Nova empresa</h2><button onClick={onClose} aria-label="Fechar" className="text-[#8E8E93]"><X size={20} /></button></div>
        <ContratacaoEmpresa mode="nova" onConcluido={() => { onClose(); onSaved(); }} />
      </div>
    </div>
  );
}
