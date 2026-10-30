import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useMotorAuth } from '@/components/auth-provider';
import { useAllowed } from '@/components/app-shell';
import {
	carregarAntes,
	fetchContagens,
	fetchUltimoPedido,
	horaBR,
	pedirReenquadramento,
	salvarAntes,
	type PedidoRotina,
	type StatusPedido,
} from '@/lib/reenquadramento';

export type ReenquadramentoHandle = { pedir: () => void };

type Props = {
	onConcluido?: () => void;
	className?: string;
};

const POLL_MS = 3000;
const HIDE_MS = 60000;
const AMBER_MS = 120000;

export const ReenquadramentoButton = forwardRef<ReenquadramentoHandle, Props>(function ReenquadramentoButton(
	{ onConcluido, className = '' },
	ref,
) {
	const { empresa, credor } = useMotorAuth();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [pedido, setPedido] = useState<PedidoRotina | null>(null);
	const [polling, setPolling] = useState(false);
	const [showBanner, setShowBanner] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [inserindo, setInserindo] = useState(false);
	const [agora, setAgora] = useState(Date.now());
	const concluidoIdRef = useRef<string | null>(null);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const credorId = credor?.id ?? null;

	// tick a cada 15s para atualizar o "tempo pendente" (âmbar após 2 min)
	useEffect(() => {
		if (!polling) return;
		const t = setInterval(() => setAgora(Date.now()), 15000);
		return () => clearInterval(t);
	}, [polling]);

	async function iniciarPedido() {
		if (!empresa || !credor) return;
		setConfirmOpen(false);
		setInserindo(true);
		// 1. guarda o snapshot "antes" no navegador
		try {
			const cont = await fetchContagens(empresa.id, credor.id);
			salvarAntes(credor.id, { ...cont, pedidoId: null, salvoEm: new Date().toISOString() });
		} catch {
			/* snapshot é best-effort; segue o pedido */
		}
		// 2. insert em pedidos_rotina
		const res = await pedirReenquadramento(credor.id);
		if (res.duplicado) {
			toast.error('Já tem um reenquadramento na fila desta carteira');
		} else if (!res.ok) {
			toast.error(res.erro);
		} else {
			toast.success('Pedido enviado · o MotorCX reenquadra em segundos');
		}
		// 3. lê o último pedido (seja o novo ou o que já estava na fila) e começa a acompanhar
		const ult = await fetchUltimoPedido(credor.id);
		setInserindo(false);
		if (ult) {
			concluidoIdRef.current = null;
			setPedido(ult);
			setShowBanner(true);
			if (ult.status === 'pendente' || ult.status === 'rodando') {
				setPolling(true);
			} else {
				// já terminou (raro): mostra por 1 min
				iniciarHideTimer();
				if (ult.status === 'ok') {
					concluidoIdRef.current = ult.id;
					onConcluido?.();
				}
			}
		}
	}

	const pedirRef = useRef<() => void>(() => {});
	pedirRef.current = () => void iniciarPedido();
	useImperativeHandle(ref, () => ({ pedir: () => pedirRef.current() }), []);

	function iniciarHideTimer() {
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		hideTimerRef.current = setTimeout(() => setShowBanner(false), HIDE_MS);
	}

	// ao montar (ou trocar de carteira): lê o último pedido e acompanha se ainda correndo
	useEffect(() => {
		if (!credorId) { setPedido(null); setPolling(false); setShowBanner(false); return; }
		let active = true;
		concluidoIdRef.current = null;
		(async () => {
			const ult = await fetchUltimoPedido(credorId);
			if (!active) return;
			setPedido(ult);
			if (!ult) { setShowBanner(false); setPolling(false); return; }
			if (ult.status === 'pendente' || ult.status === 'rodando') {
				setShowBanner(true);
				setPolling(true);
			} else {
				// terminal: só mostra se terminou há menos de 1 min
				const tf = ult.terminado_em ? new Date(ult.terminado_em).getTime() : 0;
				if (tf && Date.now() - tf < HIDE_MS) {
					setShowBanner(true);
					iniciarHideTimer();
				} else {
					setShowBanner(false);
				}
			}
		})();
		return () => {
			active = false;
			if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
		};
	}, [credorId]);

	// polling a cada 3s enquanto pendente/rodando
	useEffect(() => {
		if (!polling || !credorId) return;
		let active = true;
		const t = setInterval(async () => {
			const ult = await fetchUltimoPedido(credorId);
			if (!active) return;
			if (!ult) return;
			setPedido(ult);
			if (ult.status !== 'pendente' && ult.status !== 'rodando') {
				setPolling(false);
				setShowBanner(true);
				iniciarHideTimer();
				if (ult.status === 'ok' && concluidoIdRef.current !== ult.id) {
					concluidoIdRef.current = ult.id;
					onConcluido?.();
				}
			}
		}, POLL_MS);
		return () => { active = false; clearInterval(t); };
	}, [polling, credorId]);

	if (!canEdit || !credor) return null;

	const correndo = pedido?.status === 'pendente' || pedido?.status === 'rodando';
	const disabled = correndo || inserindo;
	const label = correndo ? 'Reenquadrando…' : '↻ Reenquadrar agora';

	return (
		<>
			<button
				type="button"
				onClick={() => setConfirmOpen(true)}
				disabled={disabled}
				className={`flex h-11 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-sm font-semibold text-[#0F4C5C] transition-colors hover:bg-[#eaf2f3] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
			>
				{correndo ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
				{label}
			</button>

			{showBanner && pedido && <Banner pedido={pedido} agora={agora} onVerEnquadramento={() => setShowBanner(false)} />}

			{confirmOpen && credor && (
				<ConfirmDialog
					nomeCarteira={credor.nome}
					onCancel={() => setConfirmOpen(false)}
					onConfirm={() => void iniciarPedido()}
				/>
			)}
		</>
	);
});

function Banner({ pedido, agora, onVerEnquadramento }: { pedido: PedidoRotina; agora: number; onVerEnquadramento: () => void }) {
	const status = pedido.status as StatusPedido;
	let body: React.ReactNode = null;

	if (status === 'pendente') {
		const pendenteMs = agora - (pedido.pedido_em ? new Date(pedido.pedido_em).getTime() : agora);
		if (pendenteMs > AMBER_MS) {
			body = (
				<div className="flex items-start gap-2 text-[#80520f]">
					<Clock size={16} className="mt-0.5 shrink-0" />
					<span>O pedido está demorando mais que o normal. Aguarde alguns minutos; se continuar, fale com o suporte.</span>
				</div>
			);
		} else {
			body = (
				<div className="flex items-center gap-2 text-[#0F4C5C]">
					<Loader2 size={16} className="animate-spin" />
					<span>Na fila… o MotorCX pega em segundos.</span>
				</div>
			);
		}
	} else if (status === 'rodando') {
		body = (
			<div className="flex items-center gap-2 text-[#0F4C5C]">
				<Loader2 size={16} className="animate-spin" />
				<span>Reenquadrando… (em geral 1 a 3 minutos).</span>
			</div>
		);
	} else if (status === 'ok') {
		body = (
			<div className="flex flex-wrap items-center gap-3 text-[#2E7D32]">
				<CheckCircle2 size={16} />
				<span>Reenquadrado às {horaBR(pedido.terminado_em)}.</span>
				<Link to="/clientes" onClick={onVerEnquadramento} className="rounded-md border border-[#2E7D32] px-3 py-1 text-xs font-semibold text-[#2E7D32] hover:bg-green-50">
					Ver enquadramento
				</Link>
			</div>
		);
	} else {
		body = (
			<div className="flex items-start gap-2 text-[#C62828]">
				<AlertCircle size={16} className="mt-0.5 shrink-0" />
				<span>Erro ao reenquadrar: {pedido.erro || 'falha desconhecida'}.</span>
			</div>
		);
	}

	const tone =
		status === 'ok' ? 'border-green-200 bg-green-50'
		: status === 'erro' ? 'border-red-200 bg-red-50'
		: status === 'pendente' && (agora - (pedido.pedido_em ? new Date(pedido.pedido_em).getTime() : agora)) > AMBER_MS
			? 'border-amber-200 bg-[#fff7e8]'
			: 'border-[#cfe0e3] bg-[#eaf2f3]';

	return <div className={`mt-3 rounded-lg border px-4 py-3 text-sm ${tone}`}>{body}</div>;
}

function ConfirmDialog({ nomeCarteira, onCancel, onConfirm }: { nomeCarteira: string; onCancel: () => void; onConfirm: () => void }) {
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-[#102e38]/60 p-4" onClick={onCancel}>
			<div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
				<div className="mb-4 flex items-center gap-3">
					<span className="grid h-10 w-10 place-items-center rounded-lg bg-[#eaf2f3] text-[#0F4C5C]"><RefreshCw size={20} /></span>
					<h2 className="text-lg font-semibold">Reenquadrar agora</h2>
				</div>
				<p className="text-sm leading-relaxed text-slate-600">
					Reenquadrar a carteira <strong>{nomeCarteira}</strong> com a orquestração atual? Os clientes são reclassificados nos segmentos e personas e a lista de ações de <strong>HOJE</strong> é refeita (se você já mandou os arquivos de hoje aos fornecedores, confira o que mudou).
				</p>
				<div className="mt-6 flex justify-end gap-3">
					<button onClick={onCancel} className="flex h-10 items-center rounded-lg border border-[#c9dadd] px-4 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Cancelar</button>
					<button onClick={onConfirm} className="flex h-10 items-center gap-2 rounded-lg bg-[#0F4C5C] px-5 text-sm font-semibold text-white hover:bg-[#0d4252]"><RefreshCw size={15} /> Reenquadrar</button>
				</div>
			</div>
		</div>
	);
}
