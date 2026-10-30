import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import { Loader2, MailX, CheckCircle2 } from 'lucide-react';
import { MarcaMotorCX } from '@/components/site/marca-motorcx';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

type Estado = 'carregando' | 'valido' | 'invalido' | 'feito';

export function EmailSairPage() {
  const [params] = useSearchParams();
  const u = params.get('u') ?? '';
  const a = params.get('a') ?? '';
  const t = params.get('t') ?? '';
  const [estado, setEstado] = useState<Estado>('carregando');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!SUPABASE_URL || !ANON_KEY || !u || !a || !t) { setEstado('invalido'); return; }
    let active = true;
    (async () => {
      try {
        const url = `${SUPABASE_URL}/functions/v1/emails/sair?u=${encodeURIComponent(u)}&a=${encodeURIComponent(a)}&t=${encodeURIComponent(t)}`;
        const res = await fetch(url, { headers: { apikey: ANON_KEY } });
        if (!active) return;
        if (!res.ok) { setEstado('invalido'); return; }
        const data = await res.json().catch(() => null);
        if (data && data.valido === false) { setEstado('invalido'); return; }
        setEstado('valido');
      } catch {
        if (active) setEstado('invalido');
      }
    })();
    return () => { active = false; };
  }, [u, a, t]);

  async function sair() {
    if (!SUPABASE_URL || !ANON_KEY) return;
    setBusy(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ acao: 'sair', u, a, t }),
      });
      const data = await res.json().catch(() => null);
      setMsg(data?.mensagem ?? 'Pronto.');
      setEstado('feito');
    } catch {
      setMsg('Não foi possível agora. Tente novamente mais tarde.');
      setEstado('feito');
    }
    setBusy(false);
  }

  const ehRelatorio = a.startsWith('relatorio:');

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#F5F5F7] px-5 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex justify-center">
          <MarcaMotorCX />
        </div>

        <div className="rounded-2xl bg-white p-7 text-center" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
          {estado === 'carregando' && (
            <>
              <Loader2 size={28} className="mx-auto animate-spin text-[#8E8E93]" />
              <p className="mt-4 text-[15px] text-[#6E6E73]">Verificando o link...</p>
            </>
          )}

          {estado === 'valido' && (
            <>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#FFF3E8]">
                <MailX size={24} className="text-[#9a631b]" />
              </div>
              <h1 className="mt-4 text-[20px] font-semibold text-[#1D1D1F]">{ehRelatorio ? 'Sair da lista deste relatório?' : 'Parar de receber estes e-mails?'}</h1>
              <p className="mt-2 text-[14px] leading-relaxed text-[#6E6E73]">Você deixa de receber este tipo de e-mail. O sino na plataforma continua mostrando tudo.</p>
              <button onClick={sair} disabled={busy} className="mt-5 h-11 w-full rounded-xl bg-[#1D1D1F] text-[15px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Processando...' : ehRelatorio ? 'Sair da lista' : 'Não quero mais'}</button>
            </>
          )}

          {estado === 'feito' && (
            <>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#E8F8EC]">
                <CheckCircle2 size={24} className="text-[#248A3D]" />
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-[#1D1D1F]">{msg}</p>
              <Link to="/conta?aba=notificacoes" className="mt-5 inline-block text-[14px] font-medium text-[#0A60D0] hover:underline">Escolher outros em Minha conta › Notificações</Link>
            </>
          )}

          {estado === 'invalido' && (
            <>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#F5F5F7]">
                <MailX size={24} className="text-[#8E8E93]" />
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-[#1D1D1F]">Este link não vale mais. Entre na plataforma e ajuste em Minha conta › Notificações.</p>
              <Link to="/login" className="mt-5 inline-block text-[14px] font-medium text-[#0A60D0] hover:underline">Entrar</Link>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] text-[#8E8E93]">© 2026 MotorCX</p>
      </div>
    </main>
  );
}
