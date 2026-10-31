import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError } from '@/lib/supabase';
import { ContaShell, cardShadow } from './conta-shell';

type TemaPref = 'claro' | 'escuro' | 'sistema';
type AjudaPref = 'automatica' | 'sempre' | 'info' | 'off';

const TEMAS: { id: TemaPref; label: string; icon: typeof Sun }[] = [
  { id: 'claro', label: 'Claro', icon: Sun },
  { id: 'escuro', label: 'Escuro', icon: Moon },
  { id: 'sistema', label: 'Do sistema', icon: Monitor },
];

const AJUDAS: { id: AjudaPref; label: string; desc: string }[] = [
  { id: 'automatica', label: 'Automática', desc: 'Mostra a ajuda nas telas que você usa pouco.' },
  { id: 'sempre', label: 'Sempre aberta', desc: 'A ajuda aparece aberta em todas as telas.' },
  { id: 'info', label: 'Só o (i)', desc: 'Mostra só o ícone; abra quando precisar.' },
  { id: 'off', label: 'Desligada', desc: 'Não mostra a ajuda nas telas.' },
];

export function ContaPreferenciasPage() {
  const { session } = useMotorAuth();
  const [tema, setTema] = useState<TemaPref>('sistema');
  const [ajuda, setAjuda] = useState<AjudaPref>('automatica');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !session) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.rpc('minha_ajuda');
        if (!active) return;
        const d = data as { tema?: string; ajuda?: string } | null;
        setTema((d?.tema === 'claro' || d?.tema === 'escuro' || d?.tema === 'sistema') ? d.tema as TemaPref : 'sistema');
        setAjuda((d?.ajuda === 'automatica' || d?.ajuda === 'sempre' || d?.ajuda === 'info' || d?.ajuda === 'off') ? d.ajuda as AjudaPref : 'automatica');
      } catch { /* defaults */ }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  function aplicarTema(t: TemaPref) {
    setTema(t);
    if (t === 'sistema') {
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-tema', dark ? 'escuro' : 'claro');
    } else {
      document.documentElement.setAttribute('data-tema', t === 'escuro' ? 'escuro' : 'claro');
    }
  }

  async function salvar() {
    if (!supabase || !session) return;
    setBusy(true);
    const payload: Record<string, string> = { tema, ajuda };
    const { error } = await supabase.from('perfis').update(payload).eq('id', session.user.id);
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Preferências salvas.');
  }

  return (
    <ContaShell>
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Preferências</h2>
        <p className="mt-1 text-[14px] text-[#6E6E73]">Ajuste como o MotorCX aparece para você.</p>

        {loading ? (
          <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
        ) : (
          <div className="mt-6 space-y-8">
            {/* Tema */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Sun size={16} className="text-[#8E8E93]" />
                <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Tema</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {TEMAS.map(t => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => aplicarTema(t.id)}
                      className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors ${tema === t.id ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}
                    >
                      <Icon size={20} className={tema === t.id ? 'text-[#1D1D1F]' : 'text-[#8E8E93]'} />
                      <span className={`text-[13px] font-medium ${tema === t.id ? 'text-[#1D1D1F]' : 'text-[#6E6E73]'}`}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Ajuda nas telas */}
            <div>
              <div className="mb-3 flex items-center gap-2">
                <HelpCircle size={16} className="text-[#8E8E93]" />
                <h3 className="text-[14px] font-semibold text-[#1D1D1F]">Ajuda nas telas</h3>
              </div>
              <div className="space-y-2">
                {AJUDAS.map(a => (
                  <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${ajuda === a.id ? 'border-[#1D1D1F] bg-[#F5F5F7]' : 'border-[#E5E5EA] hover:bg-[#F5F5F7]'}`}>
                    <input type="radio" name="ajuda" checked={ajuda === a.id} onChange={() => setAjuda(a.id)} className="mt-1 h-4 w-4 accent-[#1D1D1F]" />
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#1D1D1F]">{a.label}</p>
                      <p className="text-[12px] text-[#6E6E73]">{a.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {!loading && (
          <div className="mt-6 flex justify-end">
            <button onClick={salvar} disabled={busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">
              {busy ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        )}
      </section>
    </ContaShell>
  );
}
