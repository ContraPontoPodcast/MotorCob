import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase, friendlyError } from '@/lib/supabase';
import { CANAIS_DESCADASTRO } from '@/lib/mensageria';

/** Modal de descadastro manual de um contato (telefone ou e-mail). */
export function DescadastrarModal({ empresaId, onClose, onDone }: { empresaId: string; onClose: () => void; onDone: (msg: string) => void }) {
	const [canal, setCanal] = useState('sms');
	const [destino, setDestino] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	async function salvar() {
		const d = destino.trim();
		if (!d) { setError('Informe o telefone ou e-mail.'); return; }
		if (!supabase) return;
		setBusy(true); setError('');
		const { error } = await supabase.rpc('descadastrar_destino', { empresa: empresaId, canal, destino: d });
		setBusy(false);
		if (error) { setError(friendlyError(error)); return; }
		setDestino('');
		onDone('Pronto. Esse contato não recebe mais mensagens deste canal.');
	}

	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 px-4" onClick={onClose}>
			<div className="w-full max-w-[420px] rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Descadastrar contato</h2>
					<button onClick={onClose} aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-lg text-[#8E8E93] hover:bg-[#F5F5F7]"><X size={16} /></button>
				</div>

				<div className="space-y-4">
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Canal</label>
						<select value={canal} onChange={(e) => setCanal(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] text-[#1D1D1F] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40">
							{CANAIS_DESCADASTRO.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
						</select>
					</div>
					<div>
						<label className="mb-1.5 block text-[13px] font-semibold text-[#1D1D1F]">Telefone ou E-mail</label>
						<input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="(11) 99999-9999 ou nome@exemplo.com" className="h-10 w-full rounded-lg border border-[#D2D2D7] px-3 text-[14px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					</div>

					{error && <p className="text-[13px] text-[#FF3B30]">{error}</p>}

					<div className="flex justify-end gap-2 pt-1">
						<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={salvar} disabled={busy} className="h-10 rounded-full bg-[#1D1D1F] px-5 text-[14px] font-medium text-white disabled:opacity-50 hover:opacity-85">{busy ? 'Salvando...' : 'Descadastrar'}</button>
					</div>
				</div>
			</div>
		</div>
	);
}
