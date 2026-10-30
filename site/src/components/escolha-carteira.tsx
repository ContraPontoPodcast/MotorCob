import { useMotorAuth } from '@/components/auth-provider';

/** Cartão "Escolha a carteira" mostrado quando nenhuma carteira está selecionada
 *  e a empresa tem mais de uma. Clicar chama selectCredorRecord (mesmo do seletor). */
export function EscolhaCarteira({ texto }: { texto?: string }) {
	const { credores, selectCredorRecord } = useMotorAuth();
	const ativos = credores.filter(c => c.ativo);
	if (ativos.length === 0) return null;
	return (
		<div className="rounded-[14px] border-2 border-dashed p-8 text-center" style={{ borderColor: 'var(--base-borda, #E5E5EA)', backgroundColor: 'var(--base-fill, #F5F5F7)' }}>
			<h2 className="text-[18px] font-semibold text-[#1D1D1F]">Escolha a carteira</h2>
			<p className="mt-1 text-[14px] text-[#6E6E73]">{texto ?? 'A Lista do dia é por carteira.'}</p>
			<div className="mt-4 flex flex-wrap justify-center gap-2">
				{ativos.map(c => (
					<button key={c.id} onClick={() => selectCredorRecord(c)} className="rounded-full border border-[#D2D2D7] bg-white px-4 py-2 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">{c.nome}</button>
				))}
			</div>
		</div>
	);
}
