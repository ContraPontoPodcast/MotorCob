import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { X, Send, MessageSquare } from 'lucide-react';
import { useAssistente } from './assistente-context';
import { AssistenteConteudo } from './assistente-conteudo';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { AVATAR_ASSISTENTE } from '@/lib/assistente';

export function AssistenteGaveta() {
	const { mensagens, loading, drawerOpen, fecharGaveta, perguntar, telaNomeAtual, sugestoes, carregandoSugestoes } = useAssistente();
	const { perfil } = useMotorAuth();
	const { info: frenteInfo } = useFrente();
	const [texto, setTexto] = useState('');
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const perfilLabel = perfil?.equipe ? 'Equipe MotorCX' : (({ admin: 'Administrador', planejamento: 'Planejamento', operacao: 'Operação', gestao: 'Gestão' } as Record<string, string>)[perfil?.papel ?? ''] ?? perfil?.papel ?? '');

	useEffect(() => {
		if (drawerOpen && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [mensagens, loading, drawerOpen]);

	useEffect(() => {
		if (!drawerOpen) return;
		const t = setTimeout(() => inputRef.current?.focus(), 50);
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') { e.preventDefault(); fecharGaveta(); return; }
			if (e.key === 'Tab' && panelRef.current) {
				const focusable = panelRef.current.querySelectorAll<HTMLElement>('button, a, input, [tabindex]:not([tabindex="-1"])');
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		}
		window.addEventListener('keydown', onKey);
		return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
	}, [drawerOpen, fecharGaveta]);

	if (!drawerOpen) return null;

	async function enviar(e?: React.FormEvent) {
		e?.preventDefault();
		const t = texto.trim();
		if (!t || loading) return;
		setTexto('');
		await perguntar(t, 'conversa');
	}

	const semConversa = mensagens.length === 0;

	return (
		<div className="fixed inset-0 z-[90] flex justify-end bg-black/30" onClick={fecharGaveta}>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label="Assistente MotorCX"
				className="flex h-full w-full max-w-[400px] flex-col bg-white"
				style={{ boxShadow: '-12px 0 40px -8px rgba(0,0,0,.25)' }}
				onClick={e => e.stopPropagation()}
			>
				{/* Cabeçalho */}
				<div className="border-b border-[#E5E5EA] px-4 py-3.5">
					<div className="flex items-center gap-3">
						<img src={AVATAR_ASSISTENTE} alt="" className="h-10 w-10 rounded-full object-cover" />
						<div className="min-w-0 flex-1">
							<p className="text-[16px] font-semibold text-[#1D1D1F]">Assistente MotorCX</p>
							<p className="text-[12.5px] text-[#6E6E73]">Tira dúvidas sobre a plataforma</p>
						</div>
						<Link to="/assistente/minhas" onClick={fecharGaveta} className="inline-flex items-center gap-1 rounded-full border border-[#E5E5EA] px-2.5 py-1 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">
							<MessageSquare size={12} /> Minhas perguntas
						</Link>
						<button onClick={fecharGaveta} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-full text-[#8E8E93] hover:bg-[#F5F5F7]"><X size={18} /></button>
					</div>
					{/* Você está em + perfil + frente */}
					<div className="mt-3 flex flex-wrap items-center gap-1.5">
						<span className="text-[12px] text-[#8E8E93]">Você está em</span>
						<span className="inline-flex items-center rounded-full bg-[#F5F5F7] px-2.5 py-0.5 text-[12px] font-medium text-[#1D1D1F]">{telaNomeAtual}</span>
						<span className="inline-flex items-center gap-1 rounded-full bg-[#F5F5F7] px-2.5 py-0.5 text-[12px] font-medium text-[#1D1D1F]">
							<span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: frenteInfo.cor }} />
							{perfilLabel} · {frenteInfo.nome}
						</span>
					</div>
				</div>

				{/* Mensagens / sugestões */}
				<div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
					{semConversa && (
						<div className="space-y-4">
							<div className="flex gap-2">
								<img src={AVATAR_ASSISTENTE} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
								<div className="rounded-2xl rounded-tl-sm bg-[#F5F5F7] px-3.5 py-2.5 text-[14px] text-[#1D1D1F]">
									Olá! Sou o Assistente MotorCX. Pergunte sobre a plataforma ou escolha uma sugestão.
								</div>
							</div>
							{!carregandoSugestoes && (sugestoes.tela.length > 0 || sugestoes.frequentes.length > 0) && (
								<div className="space-y-3 pl-10">
									{sugestoes.tela.length > 0 && (
										<div>
											<p className="mb-1.5 text-[12px] font-semibold text-[#8E8E93]">Nesta tela</p>
											<div className="space-y-1.5">
												{sugestoes.tela.map((s, i) => (
													<button key={i} onClick={() => void perguntar(s, 'conversa')} className="block w-full rounded-full border border-[#E5E5EA] bg-white px-3.5 py-2 text-left text-[13.5px] text-[#1D1D1F] hover:bg-[#F5F5F7]">{s}</button>
												))}
											</div>
										</div>
									)}
									{sugestoes.frequentes.length > 0 && (
										<div>
											<p className="mb-1.5 text-[12px] font-semibold text-[#8E8E93]">Mais perguntadas na sua empresa</p>
											<div className="space-y-1.5">
												{sugestoes.frequentes.map((s, i) => (
													<button key={i} onClick={() => void perguntar(s, 'conversa')} className="block w-full rounded-full border border-[#E5E5EA] bg-white px-3.5 py-2 text-left text-[13.5px] text-[#1D1D1F] hover:bg-[#F5F5F7]">{s}</button>
												))}
											</div>
										</div>
									)}
								</div>
							)}
							{carregandoSugestoes && (
								<div className="pl-10 text-[13px] text-[#8E8E93]">Carregando sugestões...</div>
							)}
						</div>
					)}
					{mensagens.map((m, i) => (
						<div key={i} className={`flex ${m.papel === 'usuario' ? 'justify-end' : 'justify-start'}`}>
							{m.papel === 'usuario' ? (
								<div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[#1D1D1F] px-3.5 py-2.5 text-[14px] text-white">{m.texto}</div>
							) : (
								<div className="flex max-w-[90%] gap-2">
									<img src={AVATAR_ASSISTENTE} alt="" className="mt-1 h-8 w-8 shrink-0 rounded-full object-cover" />
									<div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-[#F5F5F7] px-3.5 py-2.5">
										<AssistenteConteudo msg={m} compacto />
									</div>
								</div>
							)}
						</div>
					))}
				</div>

				{/* Rodapé */}
				<div className="border-t border-[#E5E5EA] px-4 py-3">
					<p className="mb-2 text-[12px] leading-snug text-[#6E6E73]">Não vê dados de clientes. Não escreva CPF, telefone ou e-mail de clientes.</p>
					<form onSubmit={enviar} className="flex items-end gap-2">
						<textarea
							ref={inputRef}
							value={texto}
							onChange={e => setTexto(e.target.value)}
							onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
							placeholder="Pergunte sobre a plataforma"
							rows={1}
							className="max-h-[120px] min-h-[40px] flex-1 resize-none rounded-[20px] bg-[#F5F5F7] px-4 py-2.5 text-[14px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus-visible:ring-2 focus-visible:ring-[#0071E5]/40"
						/>
						<button type="submit" disabled={loading || !texto.trim()} aria-label="Enviar" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1D1D1F] text-white hover:opacity-85 disabled:opacity-40"><Send size={16} /></button>
					</form>
				</div>
			</div>
		</div>
	);
}
