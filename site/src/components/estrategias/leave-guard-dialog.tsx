/** Diálogo de saída com alterações não salvas: Salvar / Sair sem salvar / Cancelar. */
export function LeaveGuardDialog({ open, saving, onSalvar, onSairSemSalvar, onCancelar }: {
	open: boolean;
	saving: boolean;
	onSalvar: () => void;
	onSairSemSalvar: () => void;
	onCancelar: () => void;
}) {
	if (!open) return null;
	return (
		<div className="fixed inset-0 z-[100] grid place-items-center bg-[#102e38]/60 p-4">
			<div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
				<h3 className="text-base font-semibold text-[#163943]">Alterações não salvas</h3>
				<p className="mt-2 text-sm text-slate-500">A estratégia tem alterações que ainda não foram salvas. O que deseja fazer?</p>
				<div className="mt-5 flex flex-col gap-2">
					<button type="button" onClick={onSalvar} disabled={saving} className="h-10 rounded-lg bg-[#0F4C5C] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar e sair'}</button>
					<button type="button" onClick={onSairSemSalvar} className="h-10 rounded-lg border border-[#c9dadd] px-4 text-sm font-semibold text-[#304b55] hover:bg-[#edf4f5]">Sair sem salvar</button>
					<button type="button" onClick={onCancelar} className="h-10 text-sm text-slate-400 hover:text-slate-600">Cancelar</button>
				</div>
			</div>
		</div>
	);
}
