import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { ConsoleShell, cardShadow } from './console-shell';
import { useConsolePerms, type EquipeMembro } from './console-perms';
import { useFrentesMap } from './console-perms';
import { FrenteBadges } from './frente-badge';

type RespMap = Record<string, { vendedor: string | null; gerente: string | null }>;

export function ConsoleCarteirasPage() {
  const { selectEmpresa } = useMotorAuth();
  const navigate = useNavigate();
  const { membros } = useConsolePerms();
  const frentesMap = useFrentesMap();
  const [empresas, setEmpresas] = useState<Row[]>([]);
  const [resp, setResp] = useState<RespMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<string>('todas'); // 'todas' | 'sem' | <uuid>
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    if (!supabase) return;
    setLoading(true); setError('');
    const [em, rs] = await Promise.all([
      supabase.from('empresas').select('id,nome,razao_social,situacao,slug,ativa').order('nome'),
      supabase.from('empresa_responsaveis').select('empresa_id,vendedor,gerente'),
    ]);
    if (em.error) { setError(friendlyError(em.error)); setLoading(false); return; }
    setEmpresas(em.data ?? []);
    const map: RespMap = {};
    ((rs.data ?? []) as Row[]).forEach(r => {
      map[String(r.empresa_id)] = { vendedor: (r.vendedor as string | null) ?? null, gerente: (r.gerente as string | null) ?? null };
    });
    setResp(map);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  // Pessoas que podem ser vendedor/gerente (não-Master, ou todos). Master não é carteira.
  const pessoas = membros.filter(m => m.funcao !== 'master' && m.ativo);

  const filtradas = empresas.filter(e => {
    const r = resp[e.id];
    if (filtro === 'todas') return true;
    if (filtro === 'sem') return !r?.vendedor && !r?.gerente;
    return r?.vendedor === filtro || r?.gerente === filtro;
  });

  async function definir(empresaId: string, campo: 'vendedor' | 'gerente', valor: string | null) {
    if (!supabase) return;
    setBusyId(empresaId); setError('');
    const atual = resp[empresaId] ?? { vendedor: null, gerente: null };
    const payload = { empresa: empresaId, vendedor: campo === 'vendedor' ? valor : atual.vendedor, gerente: campo === 'gerente' ? valor : atual.gerente };
    const { error } = await supabase.rpc('definir_responsaveis', payload);
    setBusyId(null);
    if (error) { setError(friendlyError(error)); return; }
    setResp(prev => ({ ...prev, [empresaId]: { vendedor: payload.vendedor, gerente: payload.gerente } }));
  }

  async function abrirEmpresa(e: Row) {
    await selectEmpresa(e.id);
    navigate('/empresa');
  }

  return (
    <ConsoleShell>
      {error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="text-[14px] font-semibold text-[#1D1D1F]">Filtro</label>
        <select value={filtro} onChange={e => setFiltro(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">
          <option value="todas">Todas</option>
          <option value="sem">Sem responsável</option>
          {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </div>

      <section className="rounded-2xl bg-white p-6" style={{ boxShadow: cardShadow }}>
        {loading ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          filtradas.length === 0 ? <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhuma empresa.</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Empresa</th><th className="pb-3 font-medium">Frentes</th><th className="pb-3 font-medium">Vendedor</th><th className="pb-3 font-medium">Gerente da conta</th></tr></thead>
              <tbody className="divide-y divide-[#F0F0F2]">{filtradas.map(e => {
                const r = resp[e.id] ?? { vendedor: null, gerente: null };
                return (
                  <tr key={e.id} className="align-middle hover:bg-[#F5F5F7]">
                    <td className="py-3"><button onClick={() => void abrirEmpresa(e)} className="text-left"><p className="font-semibold text-[#1D1D1F] hover:underline">{e.nome}</p><p className="text-[12px] text-[#8E8E93]">{e.razao_social}</p></button></td>
                    <td className="py-3"><FrenteBadges frentes={frentesMap[e.id]} /></td>
                    <td className="py-3"><RespSelect value={r.vendedor} pessoas={pessoas} disabled={busyId === e.id} onChange={v => definir(e.id, 'vendedor', v)} /></td>
                    <td className="py-3"><RespSelect value={r.gerente} pessoas={pessoas} disabled={busyId === e.id} onChange={v => definir(e.id, 'gerente', v)} /></td>
                  </tr>
                );
              })}</tbody>
            </table></div>}
        <p className="mt-3 text-[12px] text-[#8E8E93]">Empresa criada por um Comercial já entra na carteira dele como Vendedor.</p>
      </section>
    </ConsoleShell>
  );
}

function RespSelect({ value, pessoas, disabled, onChange }: { value: string | null; pessoas: EquipeMembro[]; disabled: boolean; onChange: (v: string | null) => void }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value || null)} className="h-9 w-full max-w-[200px] rounded-lg border border-[#D2D2D7] bg-white px-2 text-[13px] outline-none focus:border-[#1D1D1F] disabled:opacity-50">
      <option value="">Sem responsável</option>
      {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
    </select>
  );
}
