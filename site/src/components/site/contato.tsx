import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

type Status = 'idle' | 'ok' | 'rate' | 'error';

export function Contato() {
	const [nome, setNome] = useState('');
	const [empresa, setEmpresa] = useState('');
	const [email, setEmail] = useState('');
	const [telefone, setTelefone] = useState('');
	const [mensagem, setMensagem] = useState('');
	const [site, setSite] = useState('');
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<Status>('idle');

	async function submit(e: FormEvent) {
		e.preventDefault();
		if (site) return; // honeypot preenchido — não envia
		if (!consent) return;
		setBusy(true); setStatus('idle');
		try {
			if (!supabase) throw new Error('Supabase não configurado');
			// Só insere (sem .select()): o visitante não tem leitura na tabela (RLS, SQL 52).
			const { error, status: code } = await supabase.from('contatos_site').insert({
				nome,
				empresa,
				email,
				telefone,
				mensagem,
				consentimento: true,
				origem: 'home',
			});
			if (error) {
				// limite do banco (gatilho limitar_contatos_site) ou falha de rede: mesma mensagem de antes
				const limite = /muitas mensagens/i.test(error.message ?? '');
				setStatus(limite || code === 429 || code === 0 ? 'rate' : 'error');
				return;
			}
			setStatus('ok');
			setNome(''); setEmpresa(''); setEmail(''); setTelefone(''); setMensagem(''); setConsent(false);
		} catch {
			setStatus('error');
		} finally {
			setBusy(false);
		}
	}

	const inputCls = 'w-full rounded-[10px] border border-[#D2D2D7] bg-white px-3.5 py-2.5 text-[15px] text-[#1D1D1F] outline-none focus:border-[#1D1D1F] placeholder:text-[#A1A1A6]';

	return (
		<section id="contato" className="scroll-mt-[92px] bg-white px-5 py-20 md:scroll-mt-[64px] md:py-28">
			<div className="mx-auto max-w-[560px]">
				<h2 className="ls-tight text-center font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(32px, 5vw, 56px)' }}>Mostre a sua carteira.</h2>
				{status === 'ok' ? (
					<div className="mt-8 rounded-[14px] bg-[#F5F5F7] p-8 text-center">
						<p className="text-[19px] font-semibold text-[#1D1D1F]">Recebemos. Retornamos em até 1 dia útil.</p>
						<button type="button" onClick={() => setStatus('idle')} className="mt-4 text-[14px] font-medium text-[#1D1D1F] underline underline-offset-2">Enviar outra mensagem</button>
					</div>
				) : (
					<form onSubmit={submit} className="mt-8 space-y-4">
						<div>
							<label htmlFor="c-nome" className="mb-1.5 block text-[13px] font-medium text-[#1D1D1F]">Nome *</label>
							<input id="c-nome" required value={nome} onChange={e => setNome(e.target.value)} className={inputCls} />
						</div>
						<div>
							<label htmlFor="c-empresa" className="mb-1.5 block text-[13px] font-medium text-[#1D1D1F]">Empresa</label>
							<input id="c-empresa" value={empresa} onChange={e => setEmpresa(e.target.value)} className={inputCls} />
						</div>
						<div>
							<label htmlFor="c-email" className="mb-1.5 block text-[13px] font-medium text-[#1D1D1F]">E-mail *</label>
							<input id="c-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
						</div>
						<div>
							<label htmlFor="c-tel" className="mb-1.5 block text-[13px] font-medium text-[#1D1D1F]">Telefone</label>
							<input id="c-tel" value={telefone} onChange={e => setTelefone(e.target.value)} className={inputCls} />
						</div>
						<div>
							<label htmlFor="c-msg" className="mb-1.5 block text-[13px] font-medium text-[#1D1D1F]">Mensagem</label>
							<textarea id="c-msg" rows={4} value={mensagem} onChange={e => setMensagem(e.target.value)} className={inputCls} />
						</div>
						{/* honeypot — campo escondido */}
						<input type="text" name="site" value={site} onChange={e => setSite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
						<label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[#6E6E73]">
							<input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" style={{ accentColor: '#1D1D1F' }} />
							<span>Concordo que o MotorCX use estes dados para retornar o meu contato.</span>
						</label>
						{status === 'rate' && <p className="text-[14px] text-[#C62828]">Muitas mensagens em pouco tempo. Tente mais tarde.</p>}
						{status === 'error' && <p className="text-[14px] text-[#C62828]">Não conseguimos enviar agora.</p>}
						<button type="submit" disabled={busy || !consent} className="h-[50px] w-full rounded-[12px] bg-[#1D1D1F] text-[17px] font-medium text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-40">
							{busy ? 'Enviando…' : 'Enviar'}
						</button>
					</form>
				)}
			</div>
		</section>
	);
}
