import { useEffect, useState } from 'react';
import { Lock, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError } from '@/lib/supabase';
import { ContaShell, cardShadow } from './conta-shell';

type Notificacao = {
  assunto: string;
  nome: string;
  descricao: string | null;
  sino: boolean;
  email: boolean;
  sino_travado: boolean;
  email_travado: boolean;
};

export function ContaNotificacoesPage() {
  const { session } = useMotorAuth();
  const [lista, setLista] = useState<Notificacao[]>([]);
  const [orig, setOrig] = useState<Notificacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase || !session) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase.rpc('minhas_notificacoes');
      if (!active) return;
      if (error) { setLista([]); setOrig([]); setLoading(false); return; }
      const rows = (data ?? []) as Notificacao[];
      setLista(rows);
      setOrig(rows);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  function toggle(i: number, campo: 'sino' | 'email', v: boolean) {
    setLista(prev => prev.map((n, idx) => (idx === i ? { ...n, [campo]: v } : n)));
  }

  const mudancas = lista.filter((n, i) => {
    const o = orig[i];
    return o && (n.sino !== o.sino || n.email !== o.email);
  });
  const temMudanca = mudancas.length > 0;

  async function salvar() {
    if (!supabase || !temMudanca) return;
    setBusy(true);
    const payload = mudancas.map(n => ({ assunto: n.assunto, sino: n.sino, email: n.email }));
    const { error } = await supabase.rpc('salvar_notificacoes', { alteracoes: payload });
    setBusy(false);
    if (error) { toast.error(friendlyError(error)); return; }
    const ligouEmail = mudancas.filter(n => {
      const o = orig.find(x => x.assunto === n.assunto);
      return o && n.email && !o.email;
    });
    if (ligouEmail.length > 0) {
      toast.success(`Salvo. Você passa a receber por e-mail: ${ligouEmail.map(n => n.nome).join(', ')}.`);
    } else {
      toast.success('Salvo.');
    }
    setOrig(lista);
  }

  return (
    <ContaShell>
      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: cardShadow }}>
        <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Notificações</h2>
        <p className="mt-1 text-[14px] text-[#6E6E73]">Escolha o que você recebe no sino e por e-mail.</p>

        {loading ? (
          <p className="py-8 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
        ) : lista.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-[#8E8E93]">Nenhuma notificação disponível.</p>
        ) : (
          <div className="mt-5 overflow-hidden rounded-xl border border-[#E5E5EA]">
            <div className="hidden sm:grid sm:grid-cols-[1fr_90px_90px] gap-3 bg-[#F5F5F7] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
              <span>Assunto</span>
              <span className="text-center">Sino</span>
              <span className="text-center">E-mail</span>
            </div>
            <div className="divide-y divide-[#F0F0F2]">
              {lista.map((n, i) => (
                <div key={n.assunto} className="px-4 py-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-[#1D1D1F]">{n.nome}</p>
                      {n.descricao && <p className="mt-0.5 text-[13px] text-[#8E8E93]">{n.descricao}</p>}
                    </div>
                    <div className="flex items-center gap-5">
                      <label className="flex items-center gap-2 sm:w-[90px] sm:justify-center">
                        <span className="text-[12px] text-[#8E8E93] sm:hidden">Sino</span>
                        {n.sino_travado ? (
                          <span title="Avisa de algo que para a operação ou mexe em acesso e pagamento" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> obrigatório</span>
                        ) : (
                          <Caixa checked={n.sino} on={v => toggle(i, 'sino', v)} />
                        )}
                      </label>
                      <label className="flex items-center gap-2 sm:w-[90px] sm:justify-center">
                        <span className="text-[12px] text-[#8E8E93] sm:hidden">E-mail</span>
                        {n.email_travado ? (
                          <span title="Avisa de algo que para a operação ou mexe em acesso e pagamento" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> obrigatório</span>
                        ) : (
                          <Caixa checked={n.email} on={v => toggle(i, 'email', v)} />
                        )}
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-4 text-[13px] leading-relaxed text-[#8E8E93]">O e-mail começa desligado nos assuntos opcionais. Mesmo aviso repetido: no máximo 1 e-mail por dia. O link "Não quero mais estes e-mails" no rodapé de cada e-mail desliga o assunto direto.</p>

        {lista.length > 0 && (
          <div className="mt-5 flex justify-end">
            <button onClick={salvar} disabled={!temMudanca || busy} className="h-10 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Salvando...' : 'Salvar'}</button>
          </div>
        )}
      </section>
    </ContaShell>
  );
}

function Caixa({ checked, on }: { checked: boolean; on: (v: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => on(!checked)}
      className="grid h-[22px] w-[22px] place-items-center rounded-[6px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5] focus-visible:ring-offset-1"
      style={{ backgroundColor: checked ? '#1D1D1F' : 'transparent', borderColor: checked ? '#1D1D1F' : '#D2D2D7' }}>
      {checked && <Check size={14} className="text-white" />}
    </button>
  );
}
