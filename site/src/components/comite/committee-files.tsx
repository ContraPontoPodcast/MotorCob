import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FolderClosed } from 'lucide-react';
import { Empty, Loading, Notice, PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, signedDownload, supabase, moneyBR, numberBR, type Row } from '@/lib/supabase';
import { primeiroDiaMes, ultimosMeses, mesExtenso } from '@/lib/empresa-helpers';
import { EscolhaCarteira } from '@/components/escolha-carteira';

type Folder = { name: string; files: string[] };

function pct1(v: unknown): string {
  return `${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Bloco “Mensageria por produto” — view comite_produtos (competencia, produto, canal, disparadas, gasto, cpcs). */
function ComiteProdutos() {
  const { empresa } = useMotorAuth();
  const [mes, setMes] = useState(primeiroDiaMes());
  const [linhas, setLinhas] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const meses = ultimosMeses(12);

  async function reload() {
    if (!supabase || !empresa) return;
    setLoading(true); setErro('');
    const { data, error } = await supabase.from('comite_produtos').select('*').eq('competencia', mes);
    if (error) { setErro(friendlyError(error)); setLoading(false); return; }
    setLinhas((data ?? []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [empresa?.id, mes]);

  const totalGasto = linhas.reduce((s, l) => s + Number(l.gasto ?? 0), 0) || 1;
  const totalCpcs = linhas.reduce((s, l) => s + Number(l.cpcs ?? 0), 0) || 1;

  return (
    <section className="mb-6 rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Mensageria por produto</h2>
        <select value={mes} onChange={e => setMes(e.target.value)} className="h-9 rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none">
          {meses.map(m => <option key={m} value={m}>{mesExtenso(m)}</option>)}
        </select>
      </div>
      {erro ? <p className="py-4 text-center text-[14px] text-[#FF3B30]">{erro}</p>
        : loading ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
        : linhas.length === 0 ? <p className="py-4 text-center text-[14px] text-[#8E8E93]">Sem mensageria neste mês.</p>
        : <>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[13px]">
            <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
              <th className="pb-3 font-medium">Produto</th><th className="pb-3 text-right font-medium">Disparadas</th><th className="pb-3 text-right font-medium">Gasto (R$)</th><th className="pb-3 text-right font-medium">CPCs</th><th className="pb-3 text-right font-medium">Custo/CPC</th><th className="pb-3 text-right font-medium">% gasto</th><th className="pb-3 text-right font-medium">% CPCs</th>
            </tr></thead>
            <tbody className="divide-y divide-[#F0F0F2]">
              {linhas.map((l, i) => {
                const gasto = Number(l.gasto ?? 0); const cpcs = Number(l.cpcs ?? 0); const disp = Number(l.disparadas ?? 0);
                const custoCpc = cpcs > 0 ? gasto / cpcs : null;
                const pctG = (gasto / totalGasto) * 100; const pctC = (cpcs / totalCpcs) * 100;
                return (
                  <tr key={i} className="align-top">
                    <td className="py-2.5 pr-3"><div className="font-medium text-[#1D1D1F]">{l.produto ?? '—'}</div><div className="text-[11px] text-[#8E8E93]">{l.canal}</div></td>
                    <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{numberBR(disp)}</td>
                    <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{moneyBR(gasto)}</td>
                    <td className="py-2.5 pr-3 text-right tnum text-[#6E6E73]">{numberBR(cpcs)}</td>
                    <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{custoCpc == null ? '—' : moneyBR(custoCpc)}</td>
                    <td className="py-2.5 pr-3 text-right tnum text-[#1D1D1F]">{pct1(pctG)}</td>
                    <td className="py-2.5 pr-3 text-right tnum text-[#6E6E73]">{pct1(pctC)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <div className="mt-4 space-y-2">
            {linhas.map((l, i) => {
              const gasto = Number(l.gasto ?? 0); const cpcs = Number(l.cpcs ?? 0);
              const pctG = (gasto / totalGasto) * 100; const pctC = (cpcs / totalCpcs) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-[12px] text-[#6E6E73]">{l.produto ?? '—'}</span>
                  <div className="flex flex-1 gap-1">
                    <div className="h-4 flex-1 overflow-hidden rounded bg-[#F5F5F7]"><div className="h-full rounded bg-[#0A60D0]" style={{ width: `${pctG}%` }} /></div>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-[#F5F5F7]"><div className="h-full rounded bg-[#C9A35A]" style={{ width: `${pctC}%` }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-4 text-[12px] text-[#6E6E73]">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#0A60D0]" /> % gasto</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#C9A35A]" /> % CPCs</span>
          </div>
        </>}
    </section>
  );
}

export function CommitteeFiles() {
  const { empresa, credor, credores } = useMotorAuth();
  const [folders, setFolders] = useState<Folder[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const slug = empresa?.slug;
  const codigo = credor?.codigo;
  const precisaCredor = !credor && credores.length > 1;

  useEffect(() => {
    if (!supabase || !slug || !codigo) return;
    const client = supabase; let active = true;
    async function load() {
      try {
        const { data, error } = await client.storage.from('saidas').list(`${slug}/comite`, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
        if (error) throw error;
        const months = (data ?? []).filter(f => /^\d{4}-\d{2}$/.test(f.name));
        const entries = await Promise.all(months.map(async month => {
          // pasta do credor; se vazia, cai na antiga (sem credor)
          let files: string[] = [];
          const credorPath = `${slug}/comite/${month.name}/${codigo}`;
          const r = await client.storage.from('saidas').list(credorPath, { limit: 100 });
          if (!r.error && r.data && r.data.length) files = r.data.filter(f => /\.(xlsx|csv)$/i.test(f.name)).map(f => f.name);
          if (files.length === 0) {
            const old = await client.storage.from('saidas').list(`${slug}/comite/${month.name}`, { limit: 100 });
            if (!old.error && old.data) files = old.data.filter(f => /\.(xlsx|csv)$/i.test(f.name)).map(f => f.name);
          }
          return { name: month.name, files };
        }));
        if (active) setFolders(entries.filter(f => f.files.length > 0));
      } catch { if (active) setError(friendlyError()); } finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [slug, codigo]);

  async function download(path: string) { if (!empresa) return; setBusy(path); setError(''); try { await signedDownload(path, undefined, 'saidas', empresa.id); } catch { setError('Ainda não gerado para esta data'); } finally { setBusy(''); } }

  return <><PageHeading eyebrow="GESTÃO / DOCUMENTOS" title="Comitê" description="Relatórios mensais e arquivos de acompanhamento para o comitê."/>
    {slug && <ComiteProdutos />}
    {!slug ? <Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice>
      : precisaCredor ? <EscolhaCarteira />
      : !codigo ? <Empty>Nenhum credor cadastrado para esta empresa.</Empty>
      : <>{error && <div className="mb-5"><Notice>{error}</Notice></div>}{loading ? <Loading/> : folders.length ? <div className="space-y-4">{folders.map(folder => <section key={folder.name} className="rounded-xl border border-[#dfe8ea] bg-white p-6 sm:p-8"><div className="mb-5 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e9f1f3] text-[#0F4C5C]"><FolderClosed size={19}/></div><div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">RELATÓRIOS DO MÊS</p><h2 className="font-semibold">{folder.name.slice(5,7)}/{folder.name.slice(0,4)}</h2></div></div>{folder.files.length ? <div className="divide-y divide-[#e9eff0]">{folder.files.map(file => { const path = `${slug}/comite/${folder.name}/${codigo}/${file}`; return <div key={file} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="flex items-center gap-3 break-all text-sm"><FileSpreadsheet size={17} className="shrink-0 text-[#0F4C5C]"/>{file}</span><button onClick={() => download(path)} disabled={!!busy} className="flex items-center gap-2 text-xs font-bold text-[#0F4C5C] hover:underline disabled:opacity-50"><Download size={15}/>{busy === path ? 'Baixando...' : 'Baixar'}</button></div>; })}</div> : <p className="text-sm text-slate-400">Nenhum arquivo disponível nesta pasta.</p>}</section>)}</div> : <Empty>Nenhum relatório de comitê disponível para {credor?.nome ?? 'este credor'}.</Empty>}</>}
  </>;
}
