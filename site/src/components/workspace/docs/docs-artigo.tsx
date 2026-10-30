import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react';
import { DOC_ARTIGOS } from '@/data/docs';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

export function DocsArtigoPage() {
  const { slug } = useParams();
  const artigo = DOC_ARTIGOS.find(a => a.slug === slug);
  const [voto, setVoto] = useState<'sim' | 'nao' | null>(null);

  if (!artigo) {
    return (
      <div className="mx-auto max-w-[680px] px-4 py-16 text-center">
        <h1 className="text-[22px] font-bold text-[#1D1D1F]">Artigo não encontrado</h1>
        <Link to="/docs" className="mt-4 inline-flex h-9 items-center rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white hover:opacity-85">Voltar à documentação</Link>
      </div>
    );
  }

  const relacionados = DOC_ARTIGOS.filter(a => a.categoria === artigo.categoria && a.slug !== artigo.slug);

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-8">
      <nav className="mb-5 flex items-center gap-1.5 text-[13px] text-[#8E8E93]">
        <Link to="/docs" className="hover:underline">Documentação</Link>
        <ChevronRight size={13} />
        <span>{artigo.categoria}</span>
      </nav>
      <div className="flex flex-col gap-10 lg:flex-row">
        <article className="min-w-0 max-w-[680px] flex-1">
          <h1 className="text-[34px] font-bold leading-tight tracking-tight text-[#1D1D1F]">{artigo.titulo}</h1>
          <div className="mt-6 space-y-4">
            {artigo.paragrafos.map((p, i) => <p key={i} className="text-[17px] leading-[1.6] text-[#1D1D1F]">{p}</p>)}
          </div>
          <div className="mt-10 rounded-2xl bg-[#F5F5F7] p-5" style={{ boxShadow: cardShadow }}>
            <p className="text-[14px] text-[#1D1D1F]">Isso ajudou?</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setVoto('sim')} className={`flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] font-medium ${voto === 'sim' ? 'border-[#248A3D] bg-[#E8F8EC] text-[#248A3D]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-white'}`}><ThumbsUp size={14} /> Sim</button>
              <button onClick={() => setVoto('nao')} className={`flex h-9 items-center gap-2 rounded-full border px-4 text-[13px] font-medium ${voto === 'nao' ? 'border-[#FF3B30] bg-[#FFE8E6] text-[#FF3B30]' : 'border-[#D2D2D7] text-[#1D1D1F] hover:bg-white'}`}><ThumbsDown size={14} /> Não</button>
            </div>
          </div>
          <div className="mt-6 border-t border-[#F0F0F2] pt-5">
            <p className="text-[14px] text-[#6E6E73]">Não achou? <Link to="/suporte/novo" className="font-medium text-[#1D1D1F] hover:underline">Abrir chamado</Link></p>
          </div>
        </article>
        {relacionados.length > 0 && (
          <aside className="w-full shrink-0 lg:w-[240px]">
            <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-[#8E8E93]">Nesta categoria</p>
            <div className="space-y-1">
              {relacionados.map(a => (
                <Link key={a.slug} to={`/docs/${a.slug}`} className="block rounded-lg px-3 py-2 text-[14px] text-[#1D1D1F] hover:bg-[#F5F5F7]">{a.titulo}</Link>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
