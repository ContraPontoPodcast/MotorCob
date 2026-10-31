import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, X } from 'lucide-react';
import { RotorMark } from '@/components/site/logo';
import { friendlyError, supabase, type Perfil } from '@/lib/supabase';
import DuasEtapas from '@/components/DuasEtapas';
import { proximoPasso, type Passo } from '@/components/duasEtapasLogica';

type Props = { mode: 'convite' | 'redefinir' };
type Etapa = 'senha' | 'codigo' | 'pronto' | 'expirado';
type PassoPendente = Exclude<Passo, { etapa: 'pronto' }>;

const RULES = [
  { id: 'len', label: '12 caracteres ou mais', test: (p: string) => p.length >= 12 },
  { id: 'letter', label: 'uma letra', test: (p: string) => /[a-zA-Z]/.test(p) },
  { id: 'num', label: 'um número', test: (p: string) => /[0-9]/.test(p) },
];

function forca(p: string): { score: number; label: string; color: string } {
  const passed = RULES.filter(r => r.test(p)).length;
  const score = p.length === 0 ? 0 : Math.min(4, Math.round((passed / RULES.length) * 4));
  const map = [
    { label: '—', color: '#D2D2D7' },
    { label: 'Muito fraca', color: '#FF3B30' },
    { label: 'Fraca', color: '#FF9500' },
    { label: 'Boa', color: '#FFCC00' },
    { label: 'Forte', color: '#34C759' },
  ];
  return { score, ...map[score] };
}

/** Pílulas dos passos no topo: feito ✓, atual destacado, futuro neutro. */
function StepPills({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-5 bg-[#D2D2D7]" />}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${
            i < current ? 'bg-[#34C759] text-white'
            : i === current ? 'bg-[#1D1D1F] text-white'
            : 'bg-[#F5F5F7] text-[#8E8E93]'
          }`}>
            {i < current ? <Check size={12} /> : <span className="tnum">{i + 1}</span>}
            {s}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DefinirSenhaForm({ mode }: Props) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ready, setReady] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>('senha');
  const [passo, setPasso] = useState<PassoPendente | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isEquipe, setIsEquipe] = useState(false);
  const [empresaNome, setEmpresaNome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    client.auth.getSession().then(({ data }) => { if (active && data.session) setReady(true); });
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) setReady(true);
    });
    const t = window.setTimeout(() => { if (active && !ready) setEtapa('expirado'); }, 4000);
    return () => { active = false; listener.subscription.unsubscribe(); window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca o papel para mostrar as pílulas certas (admin vê o passo do código).
  useEffect(() => {
    if (!ready || !supabase) return;
    let active = true;
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!active || !s.session) return;
      const { data: p } = await supabase.from('perfis').select('papel,equipe').eq('id', s.session.user.id).maybeSingle();
      if (!active) return;
      setIsAdmin((p as Perfil | null)?.papel === 'admin');
      setIsEquipe(!!(p as Perfil | null)?.equipe);
    })();
    return () => { active = false; };
  }, [ready]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const ok = RULES.every(r => r.test(password));
    if (!ok) { setError('A senha não atende a todos os requisitos.'); return; }
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      const { data: s } = await supabase.auth.getSession();
      let papel: Perfil['papel'] | null = null;
      let equipe = false;
      let empId: string | null = null;
      if (s.session) {
        const { data: p } = await supabase.from('perfis').select('papel,empresa_id,equipe').eq('id', s.session.user.id).maybeSingle();
        papel = (p as Perfil | null)?.papel ?? null;
        equipe = !!(p as Perfil | null)?.equipe;
        empId = (p as Perfil | null)?.empresa_id ?? null;
      }
      // Redefinição de senha: volta direto ao acesso.
      if (mode === 'redefinir') {
        navigate('/inicio', { replace: true });
        return;
      }
      // Convite: busca o nome da empresa para a tela de pronto.
      if (empId) {
        const { data: emp } = await supabase.from('empresas').select('nome').eq('id', empId).maybeSingle();
        setEmpresaNome((emp as { nome?: string } | null)?.nome ?? '');
      }
      setIsEquipe(equipe);
      // Admin precisa cadastrar o código no celular (duas etapas).
      if (papel === 'admin' && supabase) {
        setIsAdmin(true);
        const p = await proximoPasso(supabase, true);
        if (p.etapa !== 'pronto') {
          setPasso(p);
          setEtapa('codigo');
        } else {
          setEtapa('pronto');
        }
      } else {
        setEtapa('pronto');
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const f = forca(password);
  const allMet = RULES.every(r => r.test(password)) && password === confirm && password.length > 0;
  const inputCls = 'w-full bg-transparent text-[17px] text-[#1D1D1F] outline-none placeholder:text-[#A1A1A6]';

  const isConvite = mode === 'convite';
  const steps = isConvite && isAdmin ? ['Senha', 'Código no celular', 'Pronto'] : isConvite ? ['Senha', 'Pronto'] : ['Senha'];
  const currentIdx = etapa === 'senha' ? 0 : etapa === 'codigo' ? 1 : steps.length - 1;

  return (
    <main className="relative grid min-h-screen place-items-center bg-white px-5 py-16">
      <Link to="/" className="absolute left-5 top-5 flex items-center gap-1 text-[14px] text-[#1D1D1F] hover:underline">
        <span aria-hidden>‹</span> Voltar ao site
      </Link>
      <div className="w-full max-w-[380px]">
        <div className="flex justify-center"><RotorMark tone="onLight" className="h-14 w-14" /></div>

        {isConvite && ready && <StepPills steps={steps} current={currentIdx} />}

        {/* Link vencido */}
        {etapa === 'expirado' ? (
          <div className="mt-2">
            <h1 className="ls-tight text-center text-[28px] font-semibold text-[#1D1D1F]">Link vencido</h1>
            <div className="mt-8 rounded-[14px] bg-[#F5F5F7] p-6 text-center text-[15px] text-[#6E6E73]">
              Este convite venceu. Peça outro a quem convidou você.
            </div>
            <Link to="/login" className="mt-6 block text-center text-[14px] font-medium text-[#1D1D1F] hover:underline">Voltar ao login</Link>
          </div>
        ) : etapa === 'pronto' ? (
          <div className="mt-2 text-center">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-[#E8F8EC]"><Check size={28} className="text-[#34C759]" /></div>
            <h1 className="ls-tight text-[28px] font-semibold text-[#1D1D1F]">Conta pronta.</h1>
            <p className="mt-3 text-[15px] text-[#6E6E73]">
              {empresaNome
                ? `Agora é preparar a ${empresaNome} para o primeiro envio. O Início mostra o caminho.`
                : 'Agora é preparar a empresa para o primeiro envio. O Início mostra o caminho.'}
            </p>
            <button onClick={() => navigate(isEquipe ? '/workspace' : '/inicio', { replace: true })} className="mt-8 h-[50px] w-full rounded-[12px] bg-[#1D1D1F] text-[17px] font-medium text-white transition-colors hover:bg-[#3a3a3c]">
              Ir para o Início
            </button>
          </div>
        ) : etapa === 'codigo' && passo ? (
          <div className="mt-2">
            <DuasEtapas
              supabase={supabase!}
              passo={passo}
              onPronto={() => { setPasso(null); setEtapa('pronto'); }}
              onSair={() => { setPasso(null); navigate('/login', { replace: true }); }}
            />
          </div>
        ) : !ready ? (
          <div className="mt-8 rounded-[14px] bg-[#F5F5F7] p-6 text-center text-[15px] text-[#6E6E73]">
            Abra o link enviado para seu e-mail para definir a senha.
          </div>
        ) : (
          <form onSubmit={submit} className="mt-2 space-y-4">
            <h1 className="ls-tight text-center text-[28px] font-semibold text-[#1D1D1F]">{mode === 'convite' ? 'Crie sua senha.' : 'Nova senha.'}</h1>
            <p className="text-center text-[15px] text-[#6E6E73]">{mode === 'convite' ? 'Defina uma senha para ativar sua conta.' : 'Crie uma nova senha para acessar sua conta.'}</p>

            <div className="overflow-hidden rounded-[14px] border border-[#D2D2D7] bg-white">
              <div className="px-4 pb-2 pt-3">
                <label htmlFor="np" className="block text-[12px] text-[#6E6E73]">Nova senha</label>
                <input id="np" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
              </div>
              <div className="border-t border-[#E5E5EA] px-4 pb-2 pt-3">
                <label htmlFor="cp" className="block text-[12px] text-[#6E6E73]">Confirmar senha</label>
                <input id="cp" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} placeholder="••••••••" />
              </div>
            </div>

            {/* Indicador de força */}
            <div>
              <div className="flex gap-1">
                {[0,1,2,3].map(i => <span key={i} className="h-1 flex-1 rounded-full" style={{ backgroundColor: i < f.score ? f.color : '#E5E5EA' }} />)}
              </div>
              <p className="mt-1.5 text-[12px] text-[#8E8E93]">{f.label}</p>
            </div>

            {/* Regras em duas colunas */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {RULES.map(r => { const ok = r.test(password); return (
                <div key={r.id} className="flex items-center gap-2 text-[13px]">
                  {ok ? <Check size={14} className="text-[#34C759]" /> : <X size={14} className="text-[#8E8E93]" />}
                  <span className={ok ? 'text-[#1D1D1F]' : 'text-[#8E8E93]'}>{r.label}</span>
                </div>
              );})}
            </div>

            {error && <p className="text-[14px] text-[#FF3B30]">{error}</p>}
            <button type="submit" disabled={busy || !allMet} className="h-[50px] w-full rounded-[12px] bg-[#1D1D1F] text-[17px] font-medium text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-40">
              {busy ? 'Salvando…' : 'Continuar'}
            </button>
          </form>
        )}
        {etapa !== 'pronto' && etapa !== 'expirado' && (
          <Link to="/login" className="mt-6 block text-center text-[14px] font-medium text-[#1D1D1F] hover:underline">Voltar ao login</Link>
        )}
      </div>
    </main>
  );
}
