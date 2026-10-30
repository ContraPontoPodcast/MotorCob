import { ChevronDown, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import type { Acao, MensagemAcao, Passos } from '@/lib/estrategia';
import type { Frase } from '@/lib/frases';
import { canalTipoMensagem } from '@/lib/frases';
import { cpcMensagemLabel, cpcMensagemStatus, contagemFrasesFaixa, faixaTemFraseDesativada, mensagemLabel, mensagemStatus } from '@/lib/mensagem-dia';

const canalNome: Record<string, string> = {
	whatsapp: 'WhatsApp', rcs: 'RCS', sms: 'SMS', email: 'E-mail',
	agente_voz: 'Agente virtual', discador: 'Discador', enriquecimento: 'Bureau',
	persona_1: '★ Melhor da persona', persona_2: '☆ 2º da persona', sem_acao: 'Sem ação',
};

function diaLabel(d: number): string {
	if (d === 0) return 'D0';
	return d > 0 ? `D+${d}` : `D${d}`;
}

/** Bloco "Frases desta faixa" — recolhível, com resumo sempre visível. */
export function FrasesDaFaixa({ faixaKey, passos, frasesPorId, canEdit, open, onToggle, onEdit, onClear, onCopiarPara }: {
	faixaKey: string;
	passos: Passos;
	frasesPorId: Map<string, Frase>;
	canEdit: boolean;
	open: boolean;
	onToggle: () => void;
	onEdit: (day: number, lane: string, index: number) => void;
	onClear: (day: number, lane: string, index: number) => void;
	onCopiarPara?: (day: number, lane: string, index: number) => void;
}) {
	const { comFrase, total } = contagemFrasesFaixa(passos);
	const temDesativada = faixaTemFraseDesativada(passos, frasesPorId);

	// coleta todas as ações com dia/lane/index para a tabela (só canais com mensagem)
	const linhas: { day: number; lane: string; laneNome: string; index: number; acao: Acao }[] = [];
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	for (const d of dias) {
		const arr = passos[String(d)] ?? [];
		const split = arr;
		const pub = split.filter(a => !a.personas || a.personas.length === 0);
		pub.forEach((a, i) => { if (canalTipoMensagem(a.canal) !== 'nenhuma') linhas.push({ day: d, lane: 'pub', laneNome: 'Público geral', index: i, acao: a }); });
		const pids = new Set<string>();
		split.forEach(a => a.personas?.forEach(p => pids.add(p)));
		for (const pid of pids) {
			const pa = split.filter(a => a.personas?.includes(pid));
			pa.forEach((a, i) => { if (canalTipoMensagem(a.canal) !== 'nenhuma') linhas.push({ day: d, lane: pid, laneNome: pid, index: i, acao: a }); });
		}
	}

	const resumo = linhas.length === 0 ? 'Sem ações com mensagem nesta faixa.' : `${comFrase} de ${total} com mensagem` + (linhas.length > 0 ? ` · ${linhas.slice(0, 3).map(l => `${diaLabel(l.day)} ${canalNome[l.acao.canal] ?? l.acao.canal} ${mensagemStatus(l.acao, frasesPorId) === 'frase' ? (canalTipoMensagem(l.acao.canal) === 'template' ? '📄' : '📖') : mensagemStatus(l.acao, frasesPorId) === 'texto' ? '✎' : 'sem'}`).join(' · ')}` : '');

	return (
		<div className="mt-4 rounded-xl border border-[#dfe8ea] bg-white">
			<button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center justify-between px-5 py-4 text-left">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						{temDesativada && <span className="h-2 w-2 shrink-0 rounded-full bg-[#e9a23b]" />}
						<MessageCircle size={15} className="text-[#0F4C5C]" />
						<span className="text-sm font-bold text-[#163943]">Mensagens desta faixa</span>
					</div>
					<p className="mt-0.5 truncate text-[11px] text-slate-500">{resumo}</p>
				</div>
				<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
			</button>
			{open && (
				<div className="border-t border-[#ecf0f1] p-5">
					{linhas.length === 0 ? (
						<p className="py-4 text-center text-sm text-slate-400">Nenhuma ação com mensagem nesta faixa.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-xs">
								<thead>
									<tr className="border-b border-[#e2eaec] text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
										<th className="py-2 pr-3">Dia</th>
										<th className="py-2 pr-3">Canal</th>
										<th className="py-2 pr-3">Mensagem</th>
										<th className="py-2 pr-2 text-right">Ações</th>
									</tr>
								</thead>
								<tbody>
									{linhas.map((l, i) => {
										const status = mensagemStatus(l.acao, frasesPorId);
										const label = mensagemLabel(l.acao, frasesPorId);
										const isTemplate = canalTipoMensagem(l.acao.canal) === 'template';
										return (
											<tr key={i} className="border-b border-[#eef3f4] align-top">
												<td className="py-2.5 pr-3 font-semibold text-[#0F4C5C]">{diaLabel(l.day)}</td>
												<td className="py-2.5 pr-3 font-medium text-[#163943]">{canalNome[l.acao.canal] ?? l.acao.canal}</td>
												<td className="py-2.5 pr-3 max-w-[280px]">
													{status === 'nenhuma' && <span className="text-slate-300">— {isTemplate ? 'sem template' : 'sem frase'}</span>}
													{status === 'frase' && <span className="text-[#0F4C5C]">{isTemplate ? '📄' : '📖'} {label}</span>}
													{status === 'texto' && <span className="text-slate-600">✎ {label}</span>}
													{status === 'desativada' && <span className="text-[#C62828]">{isTemplate ? 'template' : 'frase'} desativad{isTemplate ? 'o' : 'a'} — não sai no arquivo</span>}
												</td>
												<td className="py-2.5 pr-2">
													<div className="flex items-center justify-end gap-1">
														{canEdit && <>
															<button onClick={() => onEdit(l.day, l.lane, l.index)} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-[#edf4f5] hover:text-[#0F4C5C]" aria-label="Editar mensagem"><Pencil size={14}/></button>
															<button onClick={() => onClear(l.day, l.lane, l.index)} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]" aria-label="Limpar mensagem"><Trash2 size={14}/></button>
														</>}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

type LinhaCpc = { tipo: string; canal: string; m: MensagemAcao | undefined; onEdit: () => void; onClear: () => void };

/** Bloco "Mensagens desta faixa" do Deu CPC — mesmo padrão de recolher das outras faixas. */
export function FrasesCpcFaixa({ cpc, frasesPorId, canEdit, open, onToggle, onEditHot, onClearHot, onEditReserva, onClearReserva, onEditJunto, onClearJunto }: {
	cpc: { ordem: Acao[]; junto: Acao[]; mensagem_hot?: Record<string, MensagemAcao> };
	frasesPorId: Map<string, Frase>;
	canEdit: boolean;
	open: boolean;
	onToggle: () => void;
	onEditHot: (canal: string) => void;
	onClearHot: (canal: string) => void;
	onEditReserva: (index: number) => void;
	onClearReserva: (index: number) => void;
	onEditJunto: (index: number) => void;
	onClearJunto: (index: number) => void;
}) {
	const linhas: LinhaCpc[] = [];
	const hotCanais = Object.keys(cpc.mensagem_hot ?? {});
	hotCanais.forEach(canal => linhas.push({ tipo: 'Canal do CPC', canal, m: cpc.mensagem_hot?.[canal], onEdit: () => onEditHot(canal), onClear: () => onClearHot(canal) }));
	cpc.ordem.forEach((a, i) => linhas.push({ tipo: `Reserva ${i + 1}`, canal: a.canal, m: a.mensagem, onEdit: () => onEditReserva(i), onClear: () => onClearReserva(i) }));
	cpc.junto.forEach((a, i) => linhas.push({ tipo: 'Junto', canal: a.canal, m: a.mensagem, onEdit: () => onEditJunto(i), onClear: () => onClearJunto(i) }));
	// só canais que usam mensagem (WhatsApp, RCS, SMS, Agente virtual)
	const linhasFiltradas = linhas.filter(l => canalTipoMensagem(l.canal) !== 'nenhuma');

	const total = linhasFiltradas.length;
	const comFrase = linhasFiltradas.filter(l => cpcMensagemStatus(l.m, frasesPorId) !== 'nenhuma').length;
	const temDesativada = linhasFiltradas.some(l => cpcMensagemStatus(l.m, frasesPorId) === 'desativada');
	const resumo = total === 0 ? 'Sem canais com mensagem no Deu CPC.' : `${comFrase} de ${total} com mensagem` + (linhasFiltradas.length > 0 ? ` · ${linhasFiltradas.slice(0, 3).map(l => `${l.tipo} ${canalNome[l.canal] ?? l.canal} ${cpcMensagemStatus(l.m, frasesPorId) === 'frase' ? (canalTipoMensagem(l.canal) === 'template' ? '📄' : '📖') : cpcMensagemStatus(l.m, frasesPorId) === 'texto' ? '✎' : cpcMensagemStatus(l.m, frasesPorId) === 'desativada' ? '⚠' : 'sem'}`).join(' · ')}` : '');

	return (
		<div className="mt-4 rounded-xl border border-[#dfe8ea] bg-white">
			<button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						{temDesativada && <span className="h-2 w-2 shrink-0 rounded-full bg-[#e9a23b]" />}
						<MessageCircle size={15} className="text-[#0F4C5C]" />
						<span className="text-sm font-bold text-[#163943]">Mensagens desta faixa</span>
					</div>
					<p className="mt-0.5 truncate text-[11px] text-slate-500">{resumo}</p>
				</div>
				<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
			</button>
			{open && (
				<div className="border-t border-[#ecf0f1] p-5">
					{linhasFiltradas.length === 0 ? (
						<p className="py-4 text-center text-sm text-slate-400">Nenhum canal com mensagem no Deu CPC.</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-xs">
								<thead>
									<tr className="border-b border-[#e2eaec] text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
										<th className="py-2 pr-3">Tipo</th>
										<th className="py-2 pr-3">Canal</th>
										<th className="py-2 pr-3">Mensagem</th>
										<th className="py-2 pr-2 text-right">Ações</th>
									</tr>
								</thead>
								<tbody>
									{linhasFiltradas.map((l, i) => {
										const status = cpcMensagemStatus(l.m, frasesPorId);
										const label = cpcMensagemLabel(l.m, frasesPorId, l.canal);
										const isTemplate = canalTipoMensagem(l.canal) === 'template';
										return (
											<tr key={i} className="border-b border-[#eef3f4] align-top">
												<td className="py-2.5 pr-3 font-semibold text-[#0F4C5C]">{l.tipo}</td>
												<td className="py-2.5 pr-3 font-medium text-[#163943]">{canalNome[l.canal] ?? l.canal}</td>
												<td className="py-2.5 pr-3 max-w-[280px]">
													{status === 'nenhuma' && <span className="text-slate-300">— {isTemplate ? 'sem template' : 'sem frase'}</span>}
													{status === 'frase' && <span className="text-[#0F4C5C]">{isTemplate ? '📄' : '📖'} {label}</span>}
													{status === 'texto' && <span className="text-slate-600">✎ {label}</span>}
													{status === 'desativada' && <span className="text-[#C62828]">{isTemplate ? 'template' : 'frase'} desativad{isTemplate ? 'o' : 'a'} — não sai no arquivo</span>}
												</td>
												<td className="py-2.5 pr-2">
													<div className="flex items-center justify-end gap-1">
														{canEdit && <>
															<button onClick={l.onEdit} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-[#edf4f5] hover:text-[#0F4C5C]" aria-label="Editar mensagem"><Pencil size={14}/></button>
															<button onClick={l.onClear} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]" aria-label="Limpar mensagem"><Trash2 size={14}/></button>
														</>}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
