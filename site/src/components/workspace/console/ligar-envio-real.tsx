import { useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError } from '@/lib/supabase';
import { useConsolePerms } from './console-perms';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';

/**
 * Botão "Ligar envio real" + link "Devolver ao cliente".
 * Aparece em Console › Implantação, no chamado "Ligar envio real"
 * (Console › Atendimento) e em Console › Empresa › Mensageria.
 *
 * - Com permissão ligar_envio_real (Master e Atendimento): botão + devolver.
 * - Sem permissão: etiqueta com cadeado.
 *
 * rpc ligar_envio_real(empresa_id) liga; rpc recusar_envio_real(empresa_id, motivo)
 * devolve ao cliente (chamado fica "Aguardando cliente").
 */
export function LigarEnvioRealButton({
	empresaId,
	empresaNome,
	onDone,
	size = 'md',
}: {
	empresaId: string;
	empresaNome: string;
	onDone?: () => void;
	size?: 'sm' | 'md';
}) {
	const { can } = useConsolePerms();
	const podeLigar = can('ligar_envio_real');
	const [confirma, setConfirma] = useState(false);
	const [busy, setBusy] = useState(false);
	const [devolver, setDevolver] = useState(false);
	const [motivo, setMotivo] = useState('');
	const [devolverBusy, setDevolverBusy] = useState(false);

	async function ligar() {
		if (!supabase) return;
		setBusy(true);
		const { error } = await supabase.rpc('ligar_envio_real', { empresa_id: empresaId });
		setBusy(false);
		if (error) { toast.error(friendlyError(error)); return; }
		setConfirma(false);
		toast.success('Envio real ligado. A empresa recebe o aviso no sino.');
		onDone?.();
	}

	async function recusar() {
		if (!supabase) return;
		setDevolverBusy(true);
		const { error } = await supabase.rpc('recusar_envio_real', { empresa_id: empresaId, motivo: motivo.trim() });
		setDevolverBusy(false);
		if (error) { toast.error(friendlyError(error)); return; }
		setDevolver(false);
		setMotivo('');
		toast.success('Devolvido ao cliente. O chamado ficou “Aguardando cliente”.');
		onDone?.();
	}

	if (!podeLigar) {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1.5 text-[12px] font-medium text-[#8E8E93]">
				<Lock size={12} /> Só Master e Atendimento ligam o envio real
			</span>
		);
	}

	const btnClass = size === 'sm'
		? 'inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1D1D1F] px-3 text-[12px] font-medium text-white hover:opacity-85'
		: 'inline-flex h-9 items-center gap-2 rounded-full bg-[#1D1D1F] px-4 text-[13px] font-semibold text-white hover:opacity-85';

	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<button onClick={() => setConfirma(true)} className={btnClass}>Ligar envio real</button>
				<button onClick={() => setDevolver(true)} className="text-[12px] font-medium text-[#0A60D0] hover:underline">Devolver ao cliente</button>
			</div>

			<ConfirmaAcao
				aberto={confirma}
				titulo="Ligar envio real"
				texto={`As mensagens da ${empresaNome} passam a sair de verdade e entram na fatura. Confira a rota e o template antes.`}
				botao="Ligar envio real"
				onConfirm={() => void ligar()}
				onClose={() => setConfirma(false)}
				loading={busy}
			/>

			{devolver && (
				<div className="fixed inset-0 z-[120] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={() => !devolverBusy && setDevolver(false)}>
					<div role="dialog" aria-modal="true" className="my-auto w-full max-w-[440px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
						<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Devolver ao cliente</h2>
						<label className="mt-3 block text-[14px] text-[#6E6E73]">O que falta (o cliente vê esta frase)</label>
						<textarea
							value={motivo}
							onChange={e => setMotivo(e.target.value)}
							rows={3}
							maxLength={400}
							className="mt-2 w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus:border-[#1D1D1F]"
							placeholder="Ex.: O template ainda não foi aprovado pelo operador…"
							autoFocus
						/>
						<p className="mt-1 text-[12px] text-[#8E8E93] tnum">{motivo.length}/400 · mínimo 5 caracteres</p>
						<div className="mt-5 flex justify-end gap-3">
							<button onClick={() => setDevolver(false)} disabled={devolverBusy} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">Cancelar</button>
							<button onClick={() => void recusar()} disabled={devolverBusy || motivo.trim().length < 5} className="flex h-10 items-center gap-2 rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50">Devolver</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
