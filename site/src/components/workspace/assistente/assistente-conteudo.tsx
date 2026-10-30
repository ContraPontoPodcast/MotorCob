import { useEffect, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown, ArrowRight, LifeBuoy } from 'lucide-react';
import { useAssistente, type Mensagem } from './assistente-context';

const MOTIVOS: { id: string; label: string }[] = [
	{ id: 'nao_respondeu', label: 'Não respondeu' },
	{ id: 'errado', label: 'Está errado' },
	{ id: 'dificil', label: 'Difícil de entender' },
	{ id: 'sem_acesso', label: 'Não tenho essa tela' },
];

/** Cursor piscando no fim do texto em streaming (sem cursor com reduced-motion). */
function Cursor() {
	return (
		<span aria-hidden className="inline-block w-[2px] -mb-[2px] h-[1em] align-middle bg-[#1D1D1F] motion-reduce:hidden" style={{ animation: 'mc-cursor 1s step-end infinite' }}>
			<style>{`@keyframes mc-cursor{0%,50%{opacity:1}51%,100%{opacity:0}}`}</style>
		</span>
	);
}

/** Renderiza o conteúdo de uma mensagem do assistente. */
export function AssistenteConteudo({ msg, compacto = false }: { msg: Mensagem; compacto?: boolean }) {
	const { avaliar, executarAcao, abrirSuporte } = useAssistente();
	const [mostrarMotivos, setMostrarMotivos] = useState(false);
	const timerRef = useRef<number | null>(null);
	const votado = msg.avaliacao != null;
	const situacao = msg.situacao ?? 'respondida';
	const foraDoAr = situacao === 'fora_do_ar' || msg.erro === 'erro';
	const semResposta = situacao === 'sem_resposta';
	const teto = situacao === 'teto';
	const mostrarSuporte = semResposta || teto || foraDoAr;

	// Timer de 10 s: se a pessoa clicou 👎 e não escolheu motivo, grava -1.
	useEffect(() => {
		if (!mostrarMotivos) return;
		timerRef.current = window.setTimeout(() => {
			if (msg.id && msg.avaliacao == null) void avaliar(msg.id, -1);
			setMostrarMotivos(false);
		}, 10000);
		return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
	}, [mostrarMotivos, msg.id, msg.avaliacao, avaliar]);

	function onThumbsUp() {
		if (!msg.id || votado) return;
		void avaliar(msg.id, 1);
		setMostrarMotivos(false);
	}
	function onThumbsDown() {
		if (!msg.id || votado) return;
		setMostrarMotivos(true);
	}
	function onMotivo(motivoId: string) {
		if (!msg.id) return;
		if (timerRef.current) window.clearTimeout(timerRef.current);
		void avaliar(msg.id, -1, motivoId);
		setMostrarMotivos(false);
	}
	function onSuporte() {
		if (timerRef.current) window.clearTimeout(timerRef.current);
		void abrirSuporte(msg);
	}

	const tam = compacto ? 'text-[14px]' : 'text-[15px]';

	return (
		<div className="min-w-0">
			{/* Faixa âmbar de dado pessoal removido. */}
			{msg.removeu && (
				<div className="mb-2 rounded-lg bg-[#FFF7E8] px-3 py-2 text-[12.5px] leading-snug text-[#9A631B]" role="status">
					Tiramos um dado pessoal da sua pergunta antes de enviar. O Assistente não vê clientes.
				</div>
			)}

			{/* Cartão vermelho de fora do ar. */}
			{foraDoAr ? (
				<div className="rounded-xl bg-[#FFE8E6] px-3.5 py-3 text-[14px] leading-relaxed text-[#C62828]">
					{msg.texto || 'O Assistente está fora do ar agora. Tente de novo em alguns minutos ou fale com o Suporte.'}
				</div>
			) : (
				// aria-live só no fim do streaming.
				<div aria-live={msg.streaming ? 'off' : 'polite'}>
					{msg.texto && (
						<p className={`whitespace-pre-wrap text-[#1D1D1F] ${tam} leading-relaxed`}>
							{msg.texto}
							{msg.streaming && <Cursor />}
						</p>
					)}
					{msg.streaming && !msg.texto && (
						<span className="inline-flex items-center gap-1 py-1">
							{[0, 1, 2].map(i => (
								<span key={i} className="h-2 w-2 rounded-full bg-[#8E8E93]" style={{ animation: `mc-bounce-c 1.2s ${i * 0.15}s ease-in-out infinite` }} />
							))}
							<style>{`@keyframes mc-bounce-c{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}`}</style>
						</span>
					)}
				</div>
			)}

			{!foraDoAr && msg.passos && msg.passos.length > 0 && !msg.streaming && (
				<ol className={`mt-2 space-y-1.5 ${compacto ? 'text-[13px]' : 'text-[14px]'}`}>
					{msg.passos.map((p, i) => (
						<li key={i} className="flex gap-2 text-[#1D1D1F]">
							<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#1D1D1F] text-[11px] font-semibold text-white">{i + 1}</span>
							<span className="min-w-0 pt-px">{p}</span>
						</li>
					))}
				</ol>
			)}

			{/* Botão da ação (mapa de ações). */}
			{!foraDoAr && msg.acao && !msg.streaming && (
				<button
					onClick={() => executarAcao(msg)}
					className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85 active:scale-[.98]"
				>
					{msg.acao.rotulo}
					<ArrowRight size={14} />
				</button>
			)}

			{/* Falar com o Suporte (sem_resposta, teto, fora_do_ar). */}
			{mostrarSuporte && !msg.streaming && (
				<button
					onClick={onSuporte}
					className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-[#D2D2D7] bg-white px-4 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7] active:scale-[.98]"
				>
					<LifeBuoy size={14} />
					Falar com o Suporte
				</button>
			)}

			{/* Ajudou? — só respostas com id, não em erro/streaming. */}
			{!msg.erro && msg.id && !msg.streaming && !mostrarSuporte && (
				<div className="mt-2">
					{!votado && !mostrarMotivos && (
						<div className="flex items-center gap-1">
							<span className="mr-1 text-[12px] text-[#8E8E93]">Ajudou?</span>
							<button
								onClick={onThumbsUp}
								aria-pressed={msg.avaliacao === 1}
								aria-label="Resposta útil"
								className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] transition-colors hover:bg-[#E5E5EA]"
							>
								<ThumbsUp size={14} />
							</button>
							<button
								onClick={onThumbsDown}
								aria-pressed={msg.avaliacao === -1}
								aria-label="Resposta não útil"
								className="grid h-7 w-7 place-items-center rounded-full text-[#8E8E93] transition-colors hover:bg-[#E5E5EA]"
							>
								<ThumbsDown size={14} />
							</button>
						</div>
					)}
					{msg.avaliacao === 1 && <span className="text-[12px] text-[#8E8E93]">Obrigado!</span>}
					{mostrarMotivos && (
						<div className="mt-1">
							<p className="text-[12px] text-[#8E8E93]">O que faltou?</p>
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{MOTIVOS.map(m => (
									<button key={m.id} onClick={() => onMotivo(m.id)} className="rounded-full border border-[#E5E5EA] bg-white px-3 py-1 text-[12.5px] text-[#1D1D1F] hover:bg-[#F5F5F7]">{m.label}</button>
								))}
								<button onClick={onSuporte} className="inline-flex items-center gap-1 rounded-full border border-[#E5E5EA] bg-white px-3 py-1 text-[12.5px] text-[#1D1D1F] hover:bg-[#F5F5F7]">
									<LifeBuoy size={12} /> Falar com o Suporte
								</button>
							</div>
						</div>
					)}
					{msg.avaliacao === -1 && !mostrarMotivos && <span className="text-[12px] text-[#8E8E93]">Obrigado! A equipe vê este motivo.</span>}
				</div>
			)}
		</div>
	);
}
