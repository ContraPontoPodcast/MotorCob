import { useEffect, useState, type ReactNode } from 'react';
import { Lock, Pencil, ArrowLeft, Loader2 } from 'lucide-react';

// Cartão de "salvar com revisão" (item 2 do prompt 49).
// Três fases: resumo (somente leitura + Editar) → editando (formulário) → revisão (mudanças + Salvar).
// O conteúdo de cada fase é controlado por quem chama; o PainelEdicao só gerencia a fase.
//
// Props:
//  - titulo: título do cartão.
//  - podeEditar: se false, mostra a etiqueta com cadeado em vez do botão Editar.
//  - motivoBloqueio: texto da etiqueta quando não pode editar.
//  - resumo / form / revisao: conteúdo de cada fase.
//  - podeRevisar: habilita o botão Revisar (formulário válido).
//  - podeSalvar / salvando: botão Salvar.
//  - erro / sucesso: mensagens.
//  - onSalvar: chamado ao confirmar.
//  - resetSignal: ao mudar, volta para a fase resumo (após salvar com sucesso).

type Fase = 'resumo' | 'editando' | 'revisao';

type Props = {
	titulo: string;
	podeEditar: boolean;
	motivoBloqueio: string;
	resumo: ReactNode;
	form: ReactNode;
	revisao: ReactNode;
	podeRevisar: boolean;
	podeSalvar: boolean;
	salvando: boolean;
	erro?: string;
	sucesso?: string;
	onSalvar: () => void;
	resetSignal?: number;
};

export function PainelEdicao({
	titulo, podeEditar, motivoBloqueio, resumo, form, revisao,
	podeRevisar, podeSalvar, salvando, erro, sucesso, onSalvar, resetSignal,
}: Props) {
	const [fase, setFase] = useState<Fase>('resumo');

	useEffect(() => { setFase('resumo'); }, [resetSignal]);

	return (
		<section className="rounded-2xl bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h2 className="text-[16px] font-semibold text-[#1D1D1F]">{titulo}</h2>
				{fase === 'resumo' && podeEditar && (
					<button onClick={() => setFase('editando')} className="flex h-8 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[13px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Pencil size={13} /> Editar</button>
				)}
				{fase === 'resumo' && !podeEditar && (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[12px] font-medium text-[#8E8E93]"><Lock size={12} /> {motivoBloqueio}</span>
				)}
			</div>

			{fase === 'resumo' && resumo}

			{fase === 'editando' && (
				<div>
					{form}
					<div className="mt-4 flex justify-end gap-3">
						<button onClick={() => setFase('resumo')} className="h-9 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={() => setFase('revisao')} disabled={!podeRevisar} className="h-9 rounded-lg bg-[#1D1D1F] px-5 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">Revisar</button>
					</div>
				</div>
			)}

			{fase === 'revisao' && (
				<div>
					{revisao}
					{erro && <p className="mt-3 rounded-lg bg-[#FFE8E6] px-3 py-2 text-[13px] text-[#FF3B30]">{erro}</p>}
					<div className="mt-4 flex justify-end gap-3">
						<button onClick={() => setFase('editando')} disabled={salvando} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7] disabled:opacity-50"><ArrowLeft size={13} /> Voltar</button>
						<button onClick={onSalvar} disabled={!podeSalvar || salvando} className="flex h-9 items-center gap-2 rounded-lg bg-[#1D1D1F] px-5 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{salvando && <Loader2 size={13} className="animate-spin" />} Salvar</button>
					</div>
				</div>
			)}

			{sucesso && fase === 'resumo' && <p className="mt-3 rounded-lg bg-[#E8F8EC] px-3 py-2 text-[13px] text-[#248A3D]">{sucesso}</p>}
		</section>
	);
}
