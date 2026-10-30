import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// Diálogo de confirmação com texto do quadro e rótulo do botão.
// O texto e o botão são controlados por quem chama (item 3 do prompt 50).
//
// Props:
//  - aberto: controla a exibição.
//  - titulo: título do diálogo.
//  - texto: conteúdo do quadro (string ou ReactNode).
//  - botao: rótulo do botão de confirmação.
//  - onConfirm: chamado ao confirmar.
//  - onClose: chamado ao cancelar/fechar.
//  - corBotao: cor de fundo do botão (padrão: #1D1D1F).
//  - loading: desabilita e mostra spinner enquanto true.

type Props = {
	aberto: boolean;
	titulo: string;
	texto: React.ReactNode;
	botao: string;
	onConfirm: () => void;
	onClose: () => void;
	corBotao?: string;
	loading?: boolean;
};

export function ConfirmaAcao({ aberto, titulo, texto, botao, onConfirm, onClose, corBotao = '#1D1D1F', loading }: Props) {
	useEffect(() => {
		if (!aberto) return;
		const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
		window.addEventListener('keydown', h);
		return () => window.removeEventListener('keydown', h);
	}, [aberto, loading, onClose]);

	if (!aberto) return null;

	return (
		<div className="fixed inset-0 z-[120] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={() => !loading && onClose()}>
			<div role="dialog" aria-modal="true" className="my-auto w-full max-w-[440px] rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
				<h2 className="text-[17px] font-semibold text-[#1D1D1F]">{titulo}</h2>
				<div className="mt-3 text-[14px] leading-relaxed text-[#1D1D1F]">{texto}</div>
				<div className="mt-5 flex justify-end gap-3">
					<button onClick={onClose} disabled={loading} className="h-10 rounded-lg border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50">Cancelar</button>
					<button onClick={onConfirm} disabled={loading} className="flex h-10 items-center gap-2 rounded-lg px-6 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: corBotao }}>
						{loading && <Loader2 size={15} className="animate-spin" />}
						{botao}
					</button>
				</div>
			</div>
		</div>
	);
}
