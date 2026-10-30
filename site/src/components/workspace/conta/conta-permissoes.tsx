import { useEffect, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, type Row } from '@/lib/supabase';
import { ContaShell, cardShadow } from './conta-shell';

export function ContaPermissoesPage() {
  const { session } = useMotorAuth();
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [minhas, setMinhas] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !session) return;
    let active = true;
    (async () => {
      const [c, m] = await Promise.all([
        supabase.from('permissoes_catalogo').select('*').order('ordem'),
        supabase.rpc('minhas_permissoes'),
      ]);
      if (!active) return;
      setCatalog((c.data ?? []) as Row[]);
      setMinhas(new Set(((m.data ?? []) as { codigo: string; permitido: boolean }[]).filter(r => r.permitido).map(r => r.codigo)));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  const grupos: Record<string, Row[]> = {};
  for (const p of catalog) { (grupos[p.grupo] ??= []).push(p); }

  return (
    <ContaShell>
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Meu perfil</h2>
        <p className="mt-1 text-[14px] text-[#6E6E73]">O que o seu perfil pode fazer nesta empresa.</p>
        {loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> :
          <div className="mt-5 space-y-5">
            {Object.entries(grupos).map(([grupo, lista]) => (
              <div key={grupo}>
                <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[#8E8E93]">{grupo}</p>
                <div className="divide-y divide-[#F0F0F2]">
                  {lista.map(p => {
                    const on = minhas.has(p.codigo);
                    return (
                      <div key={p.codigo} className="flex items-center gap-3 py-2.5">
                        <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ backgroundColor: on ? '#E8F8EC' : '#F5F5F7' }}>
                          {on ? <Check size={13} className="text-[#248A3D]" /> : <Minus size={13} className="text-[#AEAEB2]" />}
                        </div>
                        <span className="text-[14px] text-[#1D1D1F]">{p.nome}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>}
        <p className="mt-6 border-t border-[#F0F0F2] pt-4 text-[13px] text-[#8E8E93]">Quem ajusta é o Admin, em Empresa › Pessoas e perfis.</p>
      </section>
    </ContaShell>
  );
}
