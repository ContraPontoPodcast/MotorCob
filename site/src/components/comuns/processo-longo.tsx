import { Loader2, Check } from 'lucide-react';

// Régua de etapas de um processo demorado (análise de arquivo, cálculo de prévia,
// enriquecimento, sincronização). Mostra a etapa atual com spinner e as concluídas.
//
// Props:
//  - etapas: lista de rótulos, na ordem.
//  - etapaAtual: índice (0-based) da etapa em andamento.
//  - linhas: contador opcional (ex.: carregados da campanha).
//  - onSair: se houver, mostra o botão "Sair".
//  - aviso: texto secundário abaixo do título.

type Props = {
	etapas: string[];
	etapaAtual: number;
	linhas?: number;
	aviso?: string;
	onSair?: () => void;
};

export function ProcessoLongo({ etapas, etapaAtual, linhas, aviso, onSair }: Props) {
	return (
		<div className="max-w-[560px]">
			<div className="rounded-2xl bg-[#F5F5F7] p-8">
				<div className="flex flex-col items-center text-center">
					<Loader2 className="animate-spin text-[#0A60D0]" size={28} />
					<p className="mt-4 text-[16px] font-semibold text-[#1D1D1F]">Processando…</p>
					{linhas != null && <p className="mt-0.5 text-[14px] tnum text-[#6E6E73]">{linhas.toLocaleString('pt-BR')} linhas</p>}
					{aviso && <p className="mt-1 text-[13px] text-[#6E6E73]">{aviso}</p>}
				</div>

				<ol className="mx-auto mt-6 max-w-[420px] space-y-3">
					{etapas.map((rotulo, i) => {
						const concluida = i < etapaAtual;
						const atual = i === etapaAtual;
						return (
							<li key={i} className="flex items-center gap-3">
								<span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] ${concluida ? 'bg-[#34C759] text-white' : atual ? 'bg-[#1D1D1F] text-white' : 'bg-[#E5E5EA] text-[#8E8E93]'}`}>
									{concluida ? <Check size={13} /> : atual ? <Loader2 size={13} className="animate-spin" /> : i + 1}
								</span>
								<span className={`text-[14px] ${concluida || atual ? 'font-medium text-[#1D1D1F]' : 'text-[#8E8E93]'}`}>{rotulo}</span>
							</li>
						);
					})}
				</ol>

				{onSair && (
					<div className="mt-6 text-center">
						<button onClick={onSair} className="h-10 rounded-full border border-[#D2D2D7] bg-white px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Sair</button>
						<p className="mt-2 text-[12px] text-[#8E8E93]">Você pode sair: o processo continua e a campanha fica salva.</p>
					</div>
				)}
			</div>
		</div>
	);
}
