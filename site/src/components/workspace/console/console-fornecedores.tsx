import { useEffect, useState } from 'react';
import { Plus, Info } from 'lucide-react';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { CANAIS_MSG } from '@/lib/empresa-helpers';
import { ConsoleShell, cardShadow } from './console-shell';
import { Chave } from './chave';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useConsolePerms } from './console-perms';
import { FornecedorDrawer, MENSAGEM_COR } from './console-fornecedor-drawer';
import { Negociacoes } from './console-negociacoes';
import { Rotas } from './console-rotas';

function canalNome(c: string) { return CANAIS_MSG.find(x => x.id === c)?.nome ?? c; }
function canalCor(c: string) { return CANAIS_MSG.find(x => x.id === c)?.cor ?? '#8E8E93'; }

export function ConsoleFornecedoresPage() {
	const { can, loading: permsLoading } = useConsolePerms();
	const pode = can('gerenciar_fornecedores');

	const [fornecedores, setFornecedores] = useState<Row[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [drawer, setDrawer] = useState<{ forn: Row | null; novo: boolean } | null>(null);

	async function reload() {
		if (!supabase) return;
		setLoading(true);
		const { data, error } = await supabase.from('mensageria_fornecedores').select('*').order('nome');
		setFornecedores((data ?? []) as Row[]);
		if (error) setError(friendlyError(error));
		setLoading(false);
	}
	useEffect(() => { void reload(); }, []);

	async function toggleAtivo(forn: Row, on: boolean) {
		if (!supabase) return;
		const { error } = await supabase.from('mensageria_fornecedores').update({ ativo: on }).eq('id', forn.id);
		if (error) { setError(friendlyError(error)); return; }
		void reload();
	}

	if (permsLoading) {
		return <ConsoleShell><p className="py-10 text-center text-[14px] text-[#8E8E93]">Carregando...</p></ConsoleShell>;
	}
	if (!pode) {
		return (
			<ConsoleShell>
				<div className="rounded-2xl bg-[#F5F5F7] px-6 py-12 text-center text-[14px] text-[#6E6E73]">Sua função não tem acesso a Fornecedores e rotas.</div>
			</ConsoleShell>
		);
	}

	return (
		<ConsoleShell>
			{error && <div className="mb-4 rounded-xl bg-[#FFE8E6] px-4 py-3 text-[14px] text-[#FF3B30]">{error}</div>}

			<Tabs defaultValue="fornecedores">
				<TabsList className="mb-6">
					<TabsTrigger value="fornecedores">Fornecedores</TabsTrigger>
					<TabsTrigger value="negociacoes">Negociações</TabsTrigger>
					<TabsTrigger value="rotas">Rotas</TabsTrigger>
				</TabsList>

				<TabsContent value="fornecedores">
					<section className="rounded-2xl bg-white p-5 sm:p-6" style={{ boxShadow: cardShadow }}>
						<div className="mb-4 flex items-center justify-between">
							<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Fornecedores</h2>
							<button onClick={() => setDrawer({ forn: null, novo: true })} className="flex h-9 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-white hover:opacity-90" style={{ backgroundColor: MENSAGEM_COR }}><Plus size={16} /> Novo fornecedor</button>
						</div>
						{loading ? <p className="py-6 text-center text-[14px] text-[#8E8E93]">Carregando...</p> : fornecedores.length === 0 ? (
							<p className="rounded-xl bg-[#F5F5F7] px-4 py-8 text-center text-[14px] text-[#8E8E93]">Nenhum fornecedor. Crie o primeiro.</p>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full min-w-[680px] text-left text-sm">
									<thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-3 font-medium">Nome</th><th className="pb-3 font-medium">Canais</th><th className="pb-3 font-medium">Integração</th><th className="pb-3 font-medium">Ativo</th><th className="pb-3 w-px whitespace-nowrap"></th></tr></thead>
									<tbody className="divide-y divide-[#F0F0F2]">
										{fornecedores.map(fn => {
											const canais: string[] = Array.isArray(fn.canais) ? (fn.canais as string[]) : [];
											const real = !!fn.segredo_ref;
											return (
												<tr key={fn.id}>
													<td className="py-3">
														<div className="font-medium text-[#1D1D1F]">{fn.nome}</div>
														<div className="font-mono text-[11px] text-[#8E8E93]">{fn.codigo}</div>
													</td>
													<td className="py-3"><div className="flex flex-wrap gap-1">{canais.map(c => <span key={c} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: canalCor(c) }}>{canalNome(c)}</span>)}</div></td>
													<td className="py-3">
														{real ? (
															<span className="rounded-full bg-[#E8F8EC] px-2 py-0.5 text-[11px] font-semibold text-[#248A3D]">Real</span>
														) : (
															<span className="group relative inline-flex items-center gap-1">
																<span className="rounded-full bg-[#FFF3E8] px-2 py-0.5 text-[11px] font-semibold text-[#9a631b]">Simulado</span>
																<span className="text-[#8E8E93]"><Info size={12} /></span>
																<span className="pointer-events-none absolute left-0 top-7 z-[110] w-[220px] rounded-xl bg-white p-3 text-[12px] leading-relaxed text-[#1D1D1F] opacity-0 transition-opacity duration-150 group-hover:opacity-100" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 12px 40px -8px rgba(0,0,0,.2)' }}>Sem integração o envio é simulado e a reserva assume.</span>
															</span>
														)}
													</td>
													<td className="py-3"><Chave checked={fn.ativo !== false} on={v => toggleAtivo(fn, v)} /></td>
													<td className="py-3 text-right whitespace-nowrap"><button onClick={() => setDrawer({ forn: fn, novo: false })} className="rounded-lg border border-[#D2D2D7] px-3 py-1 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]">Editar</button></td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</section>
				</TabsContent>

				<TabsContent value="negociacoes"><Negociacoes /></TabsContent>
				<TabsContent value="rotas"><Rotas /></TabsContent>
			</Tabs>

			{drawer && <FornecedorDrawer fornecedor={drawer.forn} novo={drawer.novo} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); void reload(); }} />}
		</ConsoleShell>
	);
}
