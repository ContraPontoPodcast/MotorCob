import { useEffect, useState } from 'react';
import { Send, X, CheckCircle2 } from 'lucide-react';
import { supabase, friendlyError, moneyBR, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { CANAL_NOME, ITEM_NOME } from '@/lib/mensageria';
import { num } from '@/lib/mensageria-produtos';
import { ProcessoLongo } from '@/components/comuns/processo-longo';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';

const SHADOW = '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)';

/** Painel de resposta em grupo: envia o mesmo texto para várias conversas
 *  abertas sem resposta nossa de um filtro de classe. Mostra o custo previsto
 *  por rpc custo_resposta_grupo e envia com o ProcessoLongo (uma chamada de
 *  responder_conversa por conversa). */
export function ResponderGrupo({ ids, temSms, onClose, onDone }: {
	ids: string[];
	temSms: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const { empresa } = useMotorAuth();
	const [texto, setTexto] = useState('');
	const [custo, setCusto] = useState<Row[] | null>(null);
	const [loadingCusto, setLoadingCusto] = useState(false);
	const [confirma, setConfirma] = useState(false);
	const [enviando, setEnviando] = useState(false);
	const [enviadas, setEnviadas] = useState(0);
	const [falhas, setFalhas] = useState(0);
	const [sucesso, setSucesso] = useState(false);
	const [erro, setErro] = useState('');

	const limite = temSms ? 160 : 1000;
	const semVars = texto.replace(/\{\{[^}]+\}\}/g, '');

	// Custo previsto (debounced conforme o texto muda).
	useEffect(() => {
		if (!supabase || !empresa || !texto.trim() || ids.length === 0) { setCusto(null); return; }
		const sb = supabase;
		let active = true;
		const t = setTimeout(async () => {
			setLoadingCusto(true);
			const { data, error } = await sb.rpc('custo_resposta_grupo', { ids, texto: texto.trim() });
			if (!active) return;
			setLoadingCusto(false);
			if (error) { setCusto(null); return; }
			setCusto((data ?? []) as Row[]);
		}, 500);
		return () => { active = false; clearTimeout(t); };
	}, [texto, ids, empresa?.id]);

	const totalMensagens = custo?.reduce((s, r) => s + Number(r.mensagens ?? 0), 0) ?? 0;
	const totalDescadastros = custo?.reduce((s, r) => s + Number(r.descadastrados ?? 0), 0) ?? 0;
	const totalValor = custo?.reduce((s, r) => s + Number(r.total ?? 0), 0) ?? 0;
	const smsCount = custo?.filter(r => String(r.canal) === 'sms').reduce((s, r) => s + Number(r.mensagens ?? 0), 0) ?? 0;
	const rcsCount = custo?.filter(r => String(r.canal) === 'rcs').reduce((s, r) => s + Number(r.mensagens ?? 0), 0) ?? 0;

	async function enviar() {
		if (!supabase) return;
		setConfirma(false);
		setEnviando(true);
		setErro('');
		let ok = 0; let fail = 0;
		for (let i = 0; i < ids.length; i++) {
			const { error } = await supabase.rpc('responder_conversa', { conversa: ids[i], texto: texto.trim() });
			if (error) fail++; else ok++;
			setEnviadas(i + 1);
		}
		setFalhas(fail);
		setEnviando(false);
		setSucesso(true);
	}

	// Tela de envio (ProcessoLongo).
	if (enviando) {
		return (
			<div className="fixed inset-0 z-[110] grid place-items-center bg-black/40 px-4">
				<ProcessoLongo
					etapas={[`Enviando ${ids.length} respostas`]}
					etapaAtual={0}
					linhas={enviadas}
					aviso={`${enviadas} de ${ids.length} conversas respondidas`}
				/>
			</div>
		);
	}

	// Tela de sucesso.
	if (sucesso) {
		return (
			<div className="fixed inset-0 z-[110] grid place-items-center bg-black/40 px-4" onClick={onDone}>
				<div className="w-full max-w-[440px] rounded-2xl bg-white p-6 text-center" onClick={e => e.stopPropagation()} style={{ boxShadow: SHADOW }}>
					<CheckCircle2 className="mx-auto mb-3 text-[#34C759]" size={32} />
					<p className="text-[16px] font-semibold text-[#1D1D1F]">{enviadas - falhas} respostas enviadas.</p>
					<p className="mt-1 text-[14px] text-[#6E6E73]">As conversas ficaram Aguardando cliente.</p>
					{falhas > 0 && <p className="mt-1 text-[13px] text-[#FF3B30]">{falhas} não foram enviadas.</p>}
					<button onClick={onDone} className="mt-5 h-10 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-medium text-white hover:opacity-85">Fechar</button>
				</div>
			</div>
		);
	}

	const resumoCanais = [];
	if (smsCount) resumoCanais.push(`${smsCount} SMS`);
	if (rcsCount) resumoCanais.push(`${rcsCount} RCS`);

	return (
		<>
			<div className="fixed inset-0 z-[110] grid place-items-center bg-black/40 px-4 py-8 overflow-y-auto" onClick={onClose}>
				<div className="my-auto w-full max-w-[560px] rounded-2xl bg-white p-6" onClick={e => e.stopPropagation()} style={{ boxShadow: SHADOW }}>
					<div className="mb-4 flex items-center justify-between">
						<h2 className="text-[17px] font-semibold text-[#1D1D1F]">Responder em grupo</h2>
						<button onClick={onClose} className="text-[#8E8E93] hover:text-[#1D1D1F]"><X size={18} /></button>
					</div>
					<p className="mb-3 text-[13px] text-[#6E6E73]">{num(ids.length)} conversas abertas sem resposta nesta classe.</p>

					<textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Digite a resposta..." className="w-full resize-none rounded-lg border border-[#D2D2D7] px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071E5]/40" />
					<div className="mt-1 text-right text-[12px] text-[#8E8E93] tnum">{semVars.length}/{limite}</div>

					{/* Tabela do custo previsto */}
					{loadingCusto && <p className="py-3 text-center text-[13px] text-[#8E8E93]">Calculando o custo previsto...</p>}
					{custo && custo.length > 0 && (
						<div className="mt-3">
							<div className="overflow-x-auto">
								<table className="w-full border-collapse text-[14px]">
									<thead><tr className="border-b border-[#E5E5EA] text-left text-[12px] font-semibold uppercase tracking-wide text-[#8E8E93]">
										<th className="py-2 pr-4">Canal</th><th className="py-2 pr-4">Item</th><th className="py-2 pr-4 text-right">Mensagens</th><th className="py-2 pr-4 text-right">Descadastrados</th><th className="py-2 pr-4 text-right">Preço</th><th className="py-2 text-right">Total</th>
									</tr></thead>
									<tbody>
										{custo.map((r, i) => (
											<tr key={i} className="border-b border-[#F0F0F2]">
												<td className="py-2.5 pr-4 text-[#1D1D1F]">{CANAL_NOME[String(r.canal)] ?? r.canal}</td>
												<td className="py-2.5 pr-4 text-[#6E6E73]">{ITEM_NOME[String(r.item)] ?? r.item ?? '—'}</td>
												<td className="py-2.5 pr-4 text-right tnum">{num(r.mensagens)}</td>
												<td className="py-2.5 pr-4 text-right tnum">{num(r.descadastrados)}</td>
												<td className="py-2.5 pr-4 text-right tnum">{moneyBR(r.preco)}</td>
												<td className="py-2.5 text-right tnum font-medium">{moneyBR(r.total)}</td>
											</tr>
										))}
										<tr className="border-t-2 border-[#E5E5EA] font-semibold">
											<td className="py-2.5 pr-4 text-[#1D1D1F]" colSpan={2}>Total</td>
											<td className="py-2.5 pr-4 text-right tnum">{num(totalMensagens)}</td>
											<td className="py-2.5 pr-4 text-right tnum">{num(totalDescadastros)}</td>
											<td className="py-2.5 pr-4" />
											<td className="py-2.5 text-right tnum">{moneyBR(totalValor)}</td>
										</tr>
									</tbody>
								</table>
							</div>
							{totalDescadastros > 0 && <p className="mt-2 text-[13px] text-[#9a631b]">{num(totalDescadastros)} conversas com o contato descadastrado não recebem.</p>}
						</div>
					)}

					{erro && <p className="mt-3 text-[13px] text-[#FF3B30]">{erro}</p>}

					<div className="mt-5 flex justify-end gap-2">
						<button onClick={onClose} className="h-10 rounded-full border border-[#D2D2D7] px-5 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
						<button onClick={() => setConfirma(true)} disabled={!texto.trim() || !custo} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white disabled:opacity-50 hover:opacity-85"><Send size={15} /> Enviar para {num(ids.length)} conversas</button>
					</div>
				</div>
			</div>

			<ConfirmaAcao
				aberto={confirma}
				titulo="Enviar respostas em grupo"
				texto={`${num(totalMensagens)} mensagens serão enviadas agora${resumoCanais.length ? `: ${resumoCanais.join(' e ')}` : ''}. Custo previsto de ${moneyBR(totalValor)}. As conversas ficam Aguardando cliente.`}
				botao={`Enviar ${num(totalMensagens)} mensagens`}
				onConfirm={() => void enviar()}
				onClose={() => setConfirma(false)}
				loading={enviando}
			/>
		</>
	);
}
