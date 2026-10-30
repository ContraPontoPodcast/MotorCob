import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search, ChevronRight } from 'lucide-react';
import { DOC_ARTIGOS, DOC_CATEGORIAS } from '@/data/docs';
import { WorkspaceHeading } from '@/components/workspace/workspace-shell';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

export function DocsListaPage() {
  const [q, setQ] = useState('');
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return DOC_ARTIGOS;
    return DOC_ARTIGOS.filter(a => a.titulo.toLowerCase().includes(t) || a.resumo.toLowerCase().includes(t) || a.paragrafos.some(p => p.toLowerCase().includes(t)));
  }, [q]);

  return (
    <div className="mx-auto max-w-[960px] px-4 py-8">
      <WorkspaceHeading title="Documentação" description="Respostas rápidas sem sair da tela" />
      <div className="relative mb-6">
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar na documentação" className="h-12 w-full rounded-2xl bg-white pl-11 pr-4 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/30" style={{ boxShadow: cardShadow }} />
      </div>
      {q.trim() && filtrados.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center" style={{ boxShadow: cardShadow }}>
          <p className="text-[14px] text-[#6E6E73]">Nada encontrado para “{q}”.</p>
          <Link to="/suporte/novo" className="mt-3 inline-flex h-9 items-center rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Abrir chamado</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_CATEGORIAS.map(cat => {
            const arts = filtrados.filter(a => a.categoria === cat);
            if (arts.length === 0) return null;
            return (
              <div key={cat} className="rounded-2xl bg-white p-5" style={{ boxShadow: cardShadow }}>
                <h2 className="mb-3 text-[15px] font-semibold text-[#1D1D1F]">{cat}</h2>
                <div className="space-y-1">
                  {arts.map(a => (
                    <Link key={a.slug} to={`/docs/${a.slug}`} className="group flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-[#F5F5F7]">
                      <span className="min-w-0 flex-1 text-[14px] text-[#1D1D1F]">{a.titulo}</span>
                      <ChevronRight size={14} className="shrink-0 text-[#8E8E93] transition group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
