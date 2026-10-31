import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MarcaMotorCX } from '@/components/site/marca-motorcx';
import { setRemember, supabase } from '@/lib/supabase';
import DuasEtapas from '@/components/DuasEtapas';
import { proximoPasso, type Passo } from '@/components/duasEtapasLogica';
import { useFrente } from '@/components/frente-provider';
import { frenteDoLink, FRENTE_AVISO_KEY, FRENTE_LINK_KEY } from '@/lib/frentes';

type PassoPendente = Exclude<Passo, { etapa: 'pronto' }>;

export function LoginForm() {
	const navigate = useNavigate();
	const { frentes, loading: frentesLoading, aplicarFrente } = useFrente();
	const [equipe, setEquipe] = useState(false);
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [remember, setRemember] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [passo, setPasso] = useState<PassoPendente | null>(null);
	const [pronto, setPronto] = useState(false);

	// reset
	const [mode, setMode] = useState<'login' | 'reset'>('login');
	const [primeiroAcesso, setPrimeiroAcesso] = useState(false);
	const [resetEmail, setResetEmail] = useState('');
	const [resetSent, setResetSent] = useState(false);

	useEffect(() => {
		// Limpa o lembrete de duas etapas: ele volta a aparecer no próximo login.
		sessionStorage.removeItem('mfa-reminder-dismissed');
		// Frente do link: ?frente=motorcob | ?frente=motorcli (outros valores são ignorados).
		const linkFrente = frenteDoLink(new URLSearchParams(window.location.search).get('frente'));
		if (linkFrente) {
			sessionStorage.setItem(FRENTE_LINK_KEY, linkFrente);
		} else {
			sessionStorage.removeItem(FRENTE_LINK_KEY);
		}
		// Se já há sessão ao abrir /login, decide o próximo passo (código, cadastro
		// ou pronto) sem pedir a senha de novo.
		if (!supabase) return;
		let active = true;
		supabase.auth.getSession().then(async ({ data }) => {
			if (!active || !data.session) return;
			await decidirPasso(data.session.user.id);
		});
		return () => { active = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Depois de pronto (senha + 2FA), entra sempre no Início (decisão do dono:
	// sem tela de escolha de área e sem voltar à última área). A área ativa é
	// trocada depois pelo menu ou pelos atalhos do Início.
	useEffect(() => {
		if (!pronto || frentesLoading) return;
		// Frente do link (?frente=), só para clientes (a frente da equipe vem da
		// empresa selecionada): se o usuário tem acesso, troca só o contexto
		// (sessionStorage); sem acesso, deixa um aviso discreto no topo do Workspace.
		const linkFrente = frenteDoLink(sessionStorage.getItem(FRENTE_LINK_KEY));
		sessionStorage.removeItem(FRENTE_LINK_KEY);
		if (linkFrente && !equipe) {
			if (frentes.includes(linkFrente)) aplicarFrente(linkFrente);
			else sessionStorage.setItem(FRENTE_AVISO_KEY, linkFrente);
		}
		navigate('/inicio', { replace: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pronto, frentesLoading]);

	/** Busca o perfil e decide o próximo passo de duas etapas. */
	async function decidirPasso(userId: string) {
		if (!supabase) return;
		setBusy(true);
		try {
			const { data: perfil } = await supabase.from('perfis').select('papel,equipe').eq('id', userId).single();
			setEquipe(!!perfil?.equipe);
			const p = await proximoPasso(supabase, perfil?.papel === 'admin');
			if (p.etapa === 'pronto') {
				setPronto(true);
			} else {
				setPasso(p);
			}
		} catch {
			setError('Não foi possível verificar o segundo fator.');
		} finally {
			setBusy(false);
		}
	}

	async function submitCreds(e: FormEvent) {
		e.preventDefault();
		if (!supabase) return;
		setBusy(true); setError(''); setPasso(null);
		try {
			setRemember(remember);
			const { data, error } = await supabase.auth.signInWithPassword({ email, password });
			if (error) { setRemember(false); throw error; }
			await decidirPasso(data.user.id);
		} catch {
			setError('E-mail ou senha incorretos.');
		} finally {
			setBusy(false);
		}
	}

	async function submitReset(e: FormEvent) {
		e.preventDefault();
		if (!supabase) { setResetSent(true); return; }
		setBusy(true);
		try {
			await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo: 'https://motorcob.online/redefinir-senha' });
		} catch {
			/* mensagem genérica mesmo assim */
		} finally {
			setBusy(false);
			setResetSent(true);
		}
	}

	const inputCls = 'w-full bg-transparent text-[17px] text-[#1D1D1F] outline-none placeholder:text-[#A1A1A6]';

	// Etapa de duas etapas: mostra a tela do duplo fator no lugar do formulário.
	if (passo && supabase) {
		return (
			<main className="relative grid min-h-screen place-items-center bg-white px-5 py-16">
				<Link to="/" className="absolute left-5 top-5 flex items-center gap-1 text-[14px] text-[#1D1D1F] hover:underline">
					<span aria-hidden>‹</span> Voltar ao site
				</Link>
				<div className="w-full max-w-[380px]">
					<div className="flex justify-center"><MarcaMotorCX markClass="h-14 w-14" /></div>
					<div className="mt-8">
						<DuasEtapas
							supabase={supabase}
							passo={passo}
							onPronto={() => { setPasso(null); setPronto(true); }}
							onSair={() => { setPasso(null); setEmail(''); setPassword(''); }}
						/>
					</div>
				</div>
			</main>
		);
	}

	return (
		<main className="mc-halo relative grid min-h-screen place-items-center bg-white px-5 py-16">
			<Link to="/" className="absolute left-5 top-5 flex items-center gap-1 text-[14px] text-[#1D1D1F] hover:underline">
				<span aria-hidden>‹</span> Voltar ao site
			</Link>

			<div className="w-full max-w-[380px]">
				<div className="flex justify-center"><MarcaMotorCX markClass="h-14 w-14" /></div>

				{mode === 'reset' ? (
					<div className="mt-8">
						<h1 className="ls-tight text-center text-[28px] font-semibold text-[#1D1D1F]">Recuperar acesso</h1>
						{resetSent ? (
							<div className="mt-6 rounded-[14px] bg-[#F5F5F7] p-6 text-center">
								<p className="text-[15px] text-[#1D1D1F]">Se o e-mail estiver cadastrado, enviaremos um link para criar uma senha nova.</p>
								<button type="button" onClick={() => { setMode('login'); setResetSent(false); }} className="mt-4 text-[14px] font-medium text-[#1D1D1F] underline underline-offset-2">Voltar ao login</button>
							</div>
						) : (
							<form onSubmit={submitReset} className="mt-6 space-y-4">
								<div className="rounded-[14px] border border-[#D2D2D7] bg-white px-4 pb-2 pt-3">
									<label htmlFor="reset-email" className="block text-[12px] text-[#6E6E73]">E-mail</label>
									<input id="reset-email" type="email" required value={resetEmail} onChange={e => setResetEmail(e.target.value)} className={inputCls} placeholder="voce@empresa.com" />
								</div>
								<button type="submit" disabled={busy} className="h-[50px] w-full rounded-[12px] bg-[#1D1D1F] text-[17px] font-medium text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-40">
									{busy ? 'Enviando…' : 'Enviar link'}
								</button>
								<button type="button" onClick={() => setMode('login')} className="block w-full text-center text-[14px] text-[#1D1D1F] hover:underline">Voltar ao login</button>
							</form>
						)}
					</div>
				) : (
					<div className="mt-8">
						<h1 className="ls-tight text-center text-[34px] font-semibold text-[#1D1D1F]">Entre no MotorCX.</h1>
						<p className="mt-3 text-center text-[17px] text-[#6E6E73]">Uma conta para todas as áreas.</p>

						<form onSubmit={submitCreds} className="mt-8 space-y-4">
							<div className="overflow-hidden rounded-[14px] border border-[#D2D2D7] bg-white">
								<div className="px-4 pb-2 pt-3">
									<label htmlFor="email" className="block text-[12px] text-[#6E6E73]">E-mail</label>
									<input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="voce@empresa.com" />
								</div>
								<div className="border-t border-[#E5E5EA] px-4 pb-2 pt-3">
									<label htmlFor="password" className="block text-[12px] text-[#6E6E73]">Senha</label>
									<input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
								</div>
							</div>

							<label className="flex items-center gap-2 text-[14px] text-[#1D1D1F]">
								<input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="h-4 w-4" style={{ accentColor: '#1D1D1F' }} />
								Manter conectado
							</label>

							{error && <p className="text-[14px] text-[#C62828]">{error}</p>}

							<button type="submit" disabled={busy || !supabase} className="h-[50px] w-full rounded-[12px] bg-[#1D1D1F] text-[17px] font-medium text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-40">
								{busy ? 'Entrando…' : 'Continuar'}
							</button>
						</form>

						<div className="mt-5 flex flex-col items-center gap-3 text-[14px]">
							<button type="button" onClick={() => { setMode('reset'); setResetSent(false); setError(''); }} className="text-[#1D1D1F] hover:underline">Esqueceu a senha?</button>
							<p className="text-center text-[13px] text-[#6E6E73]">Acesso exclusivo para equipes convidadas. <button type="button" onClick={() => setPrimeiroAcesso(v => !v)} className="font-medium text-[#1D1D1F] hover:underline">Primeiro acesso</button></p>
							{primeiroAcesso && <p className="text-center text-[13px] text-[#6E6E73]">Use o link do convite enviado pelo Admin da sua empresa.</p>}
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
