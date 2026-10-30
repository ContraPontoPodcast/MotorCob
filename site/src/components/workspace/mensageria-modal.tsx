import { useState } from 'react';
import { X, MessageSquare, CheckCircle2, AlertCircle } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { supabase, dateBR, type Row } from '@/lib/supabase';

type Estado = 'info' | 'verificando' | 'ja_pediu' | 'enviado' | 'erro';

const ASSUNTO = 'Quero conhecer: Mensageria';

const LINHAS = [
	'Envio de SMS, e-mail e RCS direto da Lista do dia.',
	'Horários e limites respeitados automaticamente.',
	'Você paga só o que enviar.',
];

/**
 * Janela "Quero conhecer: Mensageria". Não navega para outra página: consulta a
 * existência de um chamado aberto com o assunto fixo e, se não houver, cria um.
 */
export function MensageriaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { empresa } = useMotorAuth();
	const [estado, setEstado] = useState<Estado>('info');
	const [protocolo, setProtocolo] = useState('');
	const [data, setData] = useState('');

	if (!open) return null;

	function reset() { setEstado('info'); setProtocolo(''); setData(''); }
	function fechar() { reset(); onClose(); }

	async function falarComercial() {
		if (!supabase || !empresa) return;
		setEstado('verificando');
		try {
			// 1. Já existe um pedido em aberto para esta empresa?
			const { data: existente, error: e1 } = await supabase
				.from('chamados')
				.select('protocolo,criado_em')
				.eq('empresa_id', empresa.id)
				.eq('assunto', ASSUNTO)
				.neq('situacao', 'resolvido')
				.order('criado_em', { ascending: false })
				.limit(1);
			if (e1) throw e1;
			if (existente && existente.length > 0) {
				const r = existente[0] as Row;
				setProtocolo(String(r.protocolo ?? ''));
				setData(dateBR(r.criado_em));
				setEstado('ja_pediu');
				return;
			}
			// 2. Cria o pedido.
			const { data: ins, error: e2 } = await supabase
				.from('chamados')
				.insert({
					empresa_id: empresa.id,
					motivo: 'outro',
					motivo_outro: 'Interesse comercial',
					assunto: ASSUNTO,
					prioridade: 'normal',
				})
				.select('protocolo')
				.single();
			if (e2 || !ins) throw e2;
			setProtocolo(String((ins as Row).protocolo ?? ''));
			setEstado('enviado');
		} catch {
			setEstado('erro');
		}
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={fechar}>
			<div role="dialog" aria-modal="true" className="w-full max-w-[420px] rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="flex items-start justify-between">
					<div className="grid h-10 w-10 place-items-center rounded-xl bg-[#F5F5F7] text-[#1D1D1F]"><MessageSquare size={20} /></div>
					<button onClick={fechar} aria-label="Fechar"><X size={20} className="text-[#8E8E93]" /></button>
				</div>

				<h2 className="mt-4 text-[20px] font-semibold tracking-tight text-[#1D1D1F]">Mensageria</h2>

				{estado === 'info' && (
					<>
						<ul className="mt-4 space-y-2.5">
							{LINHAS.map(l => (
								<li key={l} className="flex gap-2.5 text-[15px] leading-snug text-[#1D1D1F]">
									<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1D1D1F]" />
									{l}
								</li>
							))}
						</ul>
						<button onClick={() => void falarComercial()} className="mt-6 h-10 w-full rounded-full bg-[#1D1D1F] text-[14px] font-semibold text-white hover:opacity-85">Falar com o comercial</button>
						<button onClick={fechar} className="mt-2 h-9 w-full text-[13px] font-medium text-[#6E6E73] hover:underline">Agora não</button>
					</>
				)}

				{estado === 'verificando' && (
					<p className="mt-4 py-6 text-center text-[14px] text-[#8E8E93]">Enviando...</p>
				)}

				{estado === 'ja_pediu' && (
					<>
						<div className="mt-4 flex items-start gap-3 rounded-xl bg-[#FFF3E8] px-4 py-3">
							<AlertCircle size={18} className="mt-0.5 shrink-0 text-[#FF9500]" />
							<p className="text-[14px] text-[#1D1D1F]">Você já pediu em {data}. Protocolo <span className="tnum font-semibold">{protocolo}</span>.</p>
						</div>
						<button onClick={fechar} className="mt-6 h-10 w-full rounded-full bg-[#1D1D1F] text-[14px] font-semibold text-white hover:opacity-85">Fechar</button>
					</>
				)}

				{estado === 'enviado' && (
					<>
						<div className="mt-4 flex flex-col items-center text-center">
							<CheckCircle2 size={40} className="text-[#34C759]" />
							<p className="mt-3 text-[15px] text-[#1D1D1F]">Pedido enviado. O comercial da MotorCX fala com você em até 1 dia útil.</p>
							<p className="mt-2 text-[13px] text-[#6E6E73]">Protocolo <span className="tnum font-semibold text-[#1D1D1F]">{protocolo}</span></p>
						</div>
						<button onClick={fechar} className="mt-6 h-10 w-full rounded-full bg-[#1D1D1F] text-[14px] font-semibold text-white hover:opacity-85">Fechar</button>
					</>
				)}

				{estado === 'erro' && (
					<>
						<div className="mt-4 flex items-start gap-3 rounded-xl bg-[#FFE8E6] px-4 py-3">
							<AlertCircle size={18} className="mt-0.5 shrink-0 text-[#FF3B30]" />
							<p className="text-[14px] text-[#FF3B30]">Não foi possível enviar agora. Tente de novo em instantes.</p>
						</div>
						<div className="mt-6 flex gap-3">
							<button onClick={fechar} className="h-10 flex-1 rounded-full border border-[#D2D2D7] text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Fechar</button>
							<button onClick={() => setEstado('info')} className="h-10 flex-1 rounded-full bg-[#1D1D1F] text-[14px] font-semibold text-white hover:opacity-85">Tentar de novo</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
