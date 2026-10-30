import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, Search } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { friendlyError, supabase } from '@/lib/supabase';
import { Info } from '@/components/glossario/info';

type Row = {
  id?: string;
  quando?: string | null;
  usuario?: string | null;
  tabela?: string | null;
  acao?: string | null;
  registro?: string | null;
  mudou?: Record<string, { antes: unknown; depois: unknown }> | null;
};

const PAGE = 50;
const TABELAS: Record<string, string> = {
  estrategias: 'Estratégia', clusters: 'Segmento', credores: 'Credor', canais_empresa: 'Canal', frases: 'Frase',
  perfis: 'Usuário', permissoes_papel: 'Permissão do perfil', permissoes_usuario: 'Acesso de usuário',
  mapeamento_arquivos: 'Mapeamento', ocorrencia_codigos: 'Código de ocorrência', canal_codigos: 'Retorno de canal',
  segmentos_carteira: 'Segmento × carteira', personas_usuario: 'Persona', sugestoes: 'Sugestão', empresas: 'Empresa',
};
const ACOES: Record<string, string> = { INSERT: 'Criou', UPDATE: 'Alterou', DELETE: 'Excluiu' };

function fmtQuando(v?: string | null): string {
  if (!v) return '—';
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v)); }
  catch { return String(v); }
}
function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function Auditoria() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  // filtros
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [tabela, setTabela] = useState('all');
  const [usuario, setUsuario] = useState('');

  async function reload() {
    if (!supabase) return; setLoading(true); setError('');
    let q = supabase.from('auditoria').select('*', { count: 'exact' }).order('quando', { ascending: false });
    if (de) q = q.gte('quando', `${de}T00:00:00-03:00`);
    if (ate) q = q.lte('quando', `${ate}T23:59:59-03:00`);
    if (tabela !== 'all') q = q.eq('tabela', tabela);
    if (usuario.trim()) q = q.ilike('usuario', `%${usuario.trim()}%`);
    q = q.range(page * PAGE, page * PAGE + PAGE - 1);
    const { data, error: qErr } = await q;
    if (qErr) { setError(friendlyError(qErr)); setRows([]); setLoading(false); return; }
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page]);

  function aplicar(e: React.FormEvent) { e.preventDefault(); setPage(0); void reload(); }

  const tabelasUsadas = useMemo(() => Object.keys(TABELAS), []);

  function exportarCSV() {
    const head = ['Quando', 'Quem', 'O quê', 'Ação', 'Registro'];
    const lines = rows.map(r => [fmtQuando(r.quando), r.usuario ?? 'usuário removido', TABELAS[r.tabela ?? ''] ?? r.tabela ?? '—', ACOES[r.acao ?? ''] ?? r.acao ?? '—', fmtVal(r.registro)].map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const csv = [head.join(','), ...lines].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  return <>
    <PageHeading title="Auditoria" description="Histórico de alterações no MotorCX." titleExtra={<Info slug="auditoria" />} actions={
      <button onClick={exportarCSV} disabled={!rows.length} className="flex h-10 items-center gap-2 rounded-lg bg-[#1D1D1F] px-4 text-sm font-semibold text-white hover:bg-[#3a3a3c] disabled:opacity-40"><Download size={16}/> Exportar CSV</button>
    }/>
    <form onSubmit={aplicar} className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-[#E5E5EA] bg-white p-4">
      <label className="text-xs"><span className="mb-1 block font-semibold text-[#6E6E73]">De</span><input type="date" value={de} onChange={e => setDe(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] px-2 text-sm outline-none focus:border-[#1D1D1F]"/></label>
      <label className="text-xs"><span className="mb-1 block font-semibold text-[#6E6E73]">Até</span><input type="date" value={ate} onChange={e => setAte(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] px-2 text-sm outline-none focus:border-[#1D1D1F]"/></label>
      <label className="text-xs"><span className="mb-1 block font-semibold text-[#6E6E73]">Tabela</span>
        <select value={tabela} onChange={e => setTabela(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-2 text-sm outline-none focus:border-[#1D1D1F]">
          <option value="all">Todas</option>
          {tabelasUsadas.map(t => <option key={t} value={t}>{TABELAS[t]}</option>)}
        </select>
      </label>
      <label className="text-xs"><span className="mb-1 block font-semibold text-[#6E6E73]">Usuário</span>
        <div className="relative"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8E8E93]"/><input value={usuario} onChange={e => setUsuario(e.target.value)} placeholder="nome ou e-mail" className="h-9 w-[200px] rounded-lg border border-[#D2D2D7] pl-8 pr-2 text-sm outline-none focus:border-[#1D1D1F]"/></div>
      </label>
      <button type="submit" className="h-9 rounded-lg bg-[#1D1D1F] px-4 text-sm font-semibold text-white hover:bg-[#3a3a3c]">Aplicar</button>
    </form>
    {error && <div className="mb-5"><Notice>{error}</Notice></div>}
    {loading ? <Loading/> : rows.length === 0 ? <Empty>Nenhum registro encontrado.</Empty> : (
      <section className="overflow-hidden rounded-xl border border-[#E5E5EA] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b border-[#E5E5EA] text-xs text-[#8E8E93]">
              <th className="px-4 py-3 font-medium">Quando</th>
              <th className="px-4 py-3 font-medium">Quem</th>
              <th className="px-4 py-3 font-medium">O quê</th>
              <th className="px-4 py-3 font-medium">Ação</th>
              <th className="px-4 py-3 font-medium">Registro</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-[#F0F0F2]">
              {rows.map((r, i) => {
                const key = r.id ?? `${r.quando ?? ''}-${i}`;
                const mudou = r.mudou && typeof r.mudou === 'object' ? Object.entries(r.mudou) : [];
                const exp = expanded === key;
                return (
                  <Fragment key={key}>
                    <tr className="hover:bg-[#F5F5F7]">
                      <td className="px-4 py-3 tnum whitespace-nowrap text-[#1D1D1F]">{fmtQuando(r.quando)}</td>
                      <td className="px-4 py-3 text-[#6E6E73]">{r.usuario || 'usuário removido'}</td>
                      <td className="px-4 py-3 text-[#1D1D1F]">{TABELAS[r.tabela ?? ''] ?? r.tabela ?? '—'}</td>
                      <td className="px-4 py-3">{r.acao && <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-xs font-medium text-[#1D1D1F]">{ACOES[r.acao] ?? r.acao}</span>}</td>
                      <td className="px-4 py-3 max-w-[260px] truncate text-[#6E6E73]" title={fmtVal(r.registro)}>{fmtVal(r.registro)}</td>
                      <td className="px-4 py-3">{mudou.length > 0 && <button onClick={() => setExpanded(exp ? null : key)} className="text-[#8E8E93] hover:text-[#1D1D1F]"><ChevronDown size={16} className={`transition-transform ${exp ? 'rotate-180' : ''}`}/></button>}</td>
                    </tr>
                    {exp && mudou.length > 0 && (
                      <tr>
                        <td colSpan={6} className="bg-[#F5F5F7] px-4 py-4">
                          <table className="w-full max-w-[640px] text-xs">
                            <thead><tr className="text-[#8E8E93]"><th className="pb-2 text-left font-medium">Campo</th><th className="pb-2 text-left font-medium">Antes</th><th className="pb-2 text-left font-medium">Depois</th></tr></thead>
                            <tbody className="divide-y divide-[#E5E5EA]">
                              {mudou.map(([campo, v]) => <tr key={campo}><td className="py-1.5 pr-4 font-medium text-[#1D1D1F]">{campo}</td><td className="py-1.5 pr-4 text-[#6E6E73]">{fmtVal(v?.antes)}</td><td className="py-1.5 text-[#1D1D1F]">{fmtVal(v?.depois)}</td></tr>)}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[#E5E5EA] px-4 py-3 text-xs text-[#8E8E93]">
          <span>{rows.length} registro(s) nesta página</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="rounded-lg border border-[#D2D2D7] px-3 py-1.5 font-medium text-[#1D1D1F] disabled:opacity-40">Anterior</button>
            <button onClick={() => setPage(p => p + 1)} disabled={rows.length < PAGE} className="rounded-lg border border-[#D2D2D7] px-3 py-1.5 font-medium text-[#1D1D1F] disabled:opacity-40">Próxima</button>
          </div>
        </div>
      </section>
    )}
  </>;
}
