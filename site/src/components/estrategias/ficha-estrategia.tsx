import type { Definicao, Acao, Passos } from '@/lib/estrategia';
import { diaFrase } from '@/lib/estrategia';
import type { PersonaUsuario } from '@/lib/supabase';
import { type Frase } from '@/lib/frases';
import { hasMensagem, mensagemLabel } from '@/lib/mensagem-dia';

/** Canais e cores (mesmo padrão do Desenho da Esteira). */
const CANAIS = [
	{ id: 'whatsapp', label: 'WhatsApp', cor: '#1F8A4C' },
	{ id: 'rcs', label: 'RCS', cor: '#3B5BA9' },
	{ id: 'sms', label: 'SMS', cor: '#7A4FB0' },
	{ id: 'email', label: 'E-mail', cor: '#A2552B' },
	{ id: 'agente_voz', label: 'Agente virtual', cor: '#0E7C86' },
	{ id: 'discador', label: 'Discador', cor: '#475569' },
	{ id: 'enriquecimento', label: 'Bureau', cor: '#64748b' },
] as const;
const canalCor: Record<string, string> = Object.fromEntries(CANAIS.map(c => [c.id, c.cor]));
const canalNome: Record<string, string> = { ...Object.fromEntries(CANAIS.map(c => [c.id, c.label])), persona_1: '★ Melhor da persona', persona_2: '☆ 2º da persona', sem_acao: 'Sem ação' };
const MODO_LABEL: Record<string, string> = { sempre: 'sempre', senao: 'senão', junto: '+ junto', reserva: 'reserva' };

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export type FichaDados = {
	nome: string;
	empresaNome: string;
	credorNome: string;
	segmentos: string[];
	def: Definicao;
	personas: PersonaUsuario[];
	contagens: Record<string, number>;
	calendar: { diasSemana: number[]; seguirPadrao: boolean; feriados: boolean } | null;
	resumo: string[];
};

// ---- normalização (espelho mínimo do Desenho da Esteira) ----
function normAcao(x: unknown): Acao {
	if (typeof x === 'string') return { canal: x, modo: 'sempre' };
	const a = x as Acao;
	return { canal: a?.canal ?? '', modo: a?.modo, contatos: a?.contatos, numeros: a?.numeros, personas: a?.personas, mensagem: a?.mensagem };
}
function normPassos(p: unknown): Passos {
	if (!p || typeof p !== 'object') return {};
	const out: Passos = {};
	for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
		if (Array.isArray(v)) out[k] = v.map(normAcao).filter(a => a.canal);
	}
	return out;
}
export const fichaNormPassos = normPassos;
function splitMultiPersona(arr: Acao[]): Acao[] {
	const out: Acao[] = [];
	for (const a of arr) {
		if (a.personas && a.personas.length > 1) { for (const id of a.personas) out.push({ ...a, personas: [id] }); }
		else out.push(a);
	}
	return out;
}
const isPublico = (a: Acao) => !a.personas || a.personas.length === 0;
const acoesPublico = (arr: Acao[]) => arr.filter(isPublico);
const acoesPersona = (arr: Acao[], pid: string) => arr.filter(a => a.personas?.includes(pid));

type Lane = { id: string; nome: string; cor: string; cells: Record<string, Acao[]> };

function lanesDeFaixa(passos: Passos, personas: PersonaUsuario[]): { dias: string[]; lanes: Lane[] } {
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b).map(String);
	const lanePersonas = personas.filter(p => Object.values(passos).some(arr => splitMultiPersona(arr).some(a => a.personas?.includes(p.id))));
	const lanes: Lane[] = [{ id: 'pub', nome: 'Público geral', cor: '#0F4C5C', cells: {} }];
	for (const p of lanePersonas) lanes.push({ id: p.id, nome: p.nome, cor: p.cor, cells: {} });
	for (const d of dias) {
		const arr = splitMultiPersona(passos[d] ?? []);
		lanes[0].cells[d] = acoesPublico(arr);
		for (const p of lanePersonas) {
			const lane = lanes.find(l => l.id === p.id)!;
			lane.cells[d] = acoesPersona(arr, p.id);
		}
	}
	return { dias, lanes };
}

function diaLabel(d: number | string): string {
	const n = Number(d);
	if (n === 0) return 'D0';
	return n > 0 ? `D+${n}` : `D${n}`;
}
export const fichaDiaLabel = diaLabel;
export const fichaCanalNome = canalNome;
export const fichaLanesDeFaixa = lanesDeFaixa;

/** Computa as linhas do "Como vai funcionar" a partir da definição e personas. */
function laneFrase(acts: Acao[]): string {
	const ativas = acts.filter(a => a.canal !== 'sem_acao');
	if (!ativas.length) return 'sem ação';
	return diaFrase(ativas);
}
function resumoFaixa(passos: Passos, prefixo: string, personas: PersonaUsuario[]): string[] {
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	const lines: string[] = [];
	for (const d of dias) {
		const acts = splitMultiPersona(passos[String(d)] ?? []);
		const pub = acoesPublico(acts);
		const parts: string[] = [];
		if (pub.length) parts.push(`Público geral: ${diaFrase(pub)}`);
		for (const p of personas) {
			const pa = acoesPersona(acts, p.id);
			if (pa.length) parts.push(`${p.nome}: ${laneFrase(pa)}`);
		}
		if (parts.length) lines.push(`${prefixo}${d} · ${parts.join(' · ')}`);
	}
	return lines;
}
export function computarResumoFicha(def: Definicao, personas: PersonaUsuario[]): string[] {
	const out: string[] = [];
	const locAtivo = def.localizacao?.ativo !== false;
	const cpcAtivo = def.cpc?.ativo !== false;
	const giroAtivo = def.giro?.ativo !== false;
	if (!locAtivo) { out.push('Cliente novo: desligada.'); }
	else {
		const loc = resumoFaixa(normPassos(def.localizacao?.passos), 'D+', personas);
		if (loc.length) { out.push('Cliente novo:'); out.push(...loc); }
	}
	const cpcOrdem = (def.cpc?.ordem ?? []).filter(a => a.canal).map(a => canalNome[a.canal] ?? a.canal).join(' → ');
	const intervaloCpa = def.cpc?.intervalo_cpa ?? 1;
	const intervaloCpb = def.cpc?.intervalo_cpb ?? 1;
	const tentCpc = def.cpc?.tentativas_por_canal ?? 3;
	if (!cpcAtivo) { out.push('Deu CPC: desligada.'); }
	else { out.push(`Deu CPC: CPC A a cada ${intervaloCpa} dia${intervaloCpa > 1 ? 's' : ''}, CPC B a cada ${intervaloCpb} dia${intervaloCpb > 1 ? 's' : ''}. Canal do CPC no contato principal; depois de ${tentCpc} tentativas, troca na ordem ${cpcOrdem || 'só o canal do CPC'}.`); }
	const ciclo = def.giro?.ciclo_dias ?? 8;
	const maxCiclos = def.giro?.max_ciclos ?? 3;
	if (!giroAtivo) { out.push('Não CPC: desligada.'); }
	else {
		const giro = resumoFaixa(normPassos(def.giro?.passos), 'D+', personas);
		if (giro.length || def.giro) { out.push(`Não CPC: ciclo de ${ciclo} dias repetido ${maxCiclos} vezes; depois aguarda enriquecimento.`); out.push(...giro); }
	}
	const prev = resumoFaixa(normPassos(def.preventivo?.passos), 'D', personas);
	if (def.preventivo?.ativo === false) { out.push('Preventivo: desligado.'); }
	else if (prev.length) { out.push('Preventivo:'); out.push(...prev); }
	const carencia = def.quebra?.carencia ?? 0;
	const diasEstoque = def.quebra?.dias_para_estoque ?? 6;
	const quebra = resumoFaixa(normPassos(def.quebra?.passos), 'D+', personas);
	if (def.quebra?.ativo === false) { out.push(`Quebra: desligada (volta ao estoque em ${diasEstoque} dias${carencia > 0 ? `, a partir do D+${carencia + 1}` : ''}).`); }
	else {
		if (carencia > 0) out.push(`Quebra: a partir do D+${carencia + 1} (carência de ${carencia} dia${carencia > 1 ? 's' : ''}).`);
		if (quebra.length) { if (!carencia) out.push('Quebra:'); out.push(...quebra); }
	}
	return out;
}

function ChipCanal({ acao, frasesPorId }: { acao: Acao; frasesPorId?: Map<string, Frase> }) {
	const cor = canalCor[acao.canal] ?? '#475569';
	const nome = canalNome[acao.canal] ?? acao.canal;
	const msg = hasMensagem(acao);
	const msgTxt = frasesPorId ? mensagemLabel(acao, frasesPorId) : '';
	return (
		<span style={{ backgroundColor: cor }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap">
			{nome}{acao.modo && acao.modo !== 'sempre' ? ` · ${MODO_LABEL[acao.modo] ?? acao.modo}` : ''}
			{msg && <span className="ml-0.5 text-[8px]" title={msgTxt}>●</span>}
		</span>
	);
}

function TabelaFaixa({ titulo, passos, personas, nota }: { titulo: string; passos: Passos; personas: PersonaUsuario[]; nota?: string }) {
	const { dias, lanes } = lanesDeFaixa(passos, personas);
	if (dias.length === 0) {
		return (
			<section data-ficha-section className="mb-6">
				<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">{titulo}</h2>
				<p className="text-xs italic text-slate-400">Seguindo o padrão MotorCX.</p>
				{nota && <p className="mt-1 text-xs text-slate-500">{nota}</p>}
			</section>
		);
	}
	return (
		<section data-ficha-section className="mb-6">
			<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">{titulo}</h2>
			{nota && <p className="mb-2 text-xs text-slate-500">{nota}</p>}
			<table className="w-full border-collapse text-[11px]">
				<thead>
					<tr>
						<th className="border border-[#c9dadd] bg-[#eaf2f3] px-2 py-1.5 text-left font-semibold text-[#0F4C5C]" style={{ minWidth: 120 }}>Raia \ Dia</th>
						{dias.map(d => <th key={d} className="border border-[#c9dadd] bg-[#eaf2f3] px-2 py-1.5 text-center font-semibold text-[#0F4C5C]">{diaLabel(d)}</th>)}
					</tr>
				</thead>
				<tbody>
					{lanes.map(lane => (
						<tr key={lane.id}>
							<td className="border border-[#c9dadd] px-2 py-1.5 align-top font-semibold" style={{ color: lane.cor }}>{lane.nome}</td>
							{dias.map(d => {
								const acts = lane.cells[d] ?? [];
								return (
									<td key={d} className="border border-[#c9dadd] px-1.5 py-1 align-top">
										{acts.length === 0 ? <span className="text-slate-300">—</span> : (
											<div className="flex flex-col items-start gap-1">
												{acts.map((a, i) => <ChipCanal key={i} acao={a} />)}
											</div>
										)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}

function FrasesPorDiaFicha({ def, frasesPorId }: { def: Definicao; frasesPorId?: Map<string, Frase> }) {
	const faixas: { titulo: string; passos: Passos; prefixo: string }[] = [
		{ titulo: 'Cliente novo', passos: normPassos(def.localizacao?.passos), prefixo: 'D+' },
		{ titulo: 'Não CPC', passos: normPassos(def.giro?.passos), prefixo: 'D+' },
		{ titulo: 'Preventivo', passos: normPassos(def.preventivo?.passos), prefixo: 'D' },
		{ titulo: 'Quebra', passos: normPassos(def.quebra?.passos), prefixo: 'D+' },
	];
	const linhas: { faixa: string; dia: string; canal: string; frase: string }[] = [];
	for (const f of faixas) {
		const dias = Object.keys(f.passos).map(Number).sort((a, b) => a - b);
		for (const d of dias) {
			const arr = f.passos[String(d)] ?? [];
			for (const a of arr) {
				if (a.canal === 'sem_acao' || a.canal === 'enriquecimento') continue;
				if (!hasMensagem(a)) continue;
				const label = frasesPorId ? mensagemLabel(a, frasesPorId) : 'frase configurada';
				linhas.push({ faixa: f.titulo, dia: `${f.prefixo}${d}`, canal: canalNome[a.canal] ?? a.canal, frase: label });
			}
		}
	}
	// CPC
	const cpcOrdem = (def.cpc?.ordem ?? []).filter(a => a.canal && hasMensagem(a));
	const cpcJunto = (def.cpc?.junto ?? []).filter(a => a.canal && hasMensagem(a));
	return (
		<>
			<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">Frases por dia</h2>
			{linhas.length === 0 && cpcOrdem.length === 0 && cpcJunto.length === 0 ? <p className="text-xs italic text-slate-400">Sem frases configuradas nos dias.</p> : (
				<table className="w-full border-collapse text-[11px]">
					<thead>
						<tr>
							<th className="border border-[#c9dadd] bg-[#eaf2f3] px-2 py-1.5 text-left font-semibold text-[#0F4C5C]">Faixa</th>
							<th className="border border-[#c9dadd] bg-[#eaf2f3] px-2 py-1.5 text-left font-semibold text-[#0F4C5C]">Dia</th>
							<th className="border border-[#c9dadd] bg-[#eaf2f3] px-2 py-1.5 text-left font-semibold text-[#0F4C5C]">Canal</th>
							<th className="border border-[#c9dadd] bg-[#eaf2f3] px-2 py-1.5 text-left font-semibold text-[#0F4C5C]">Frase</th>
						</tr>
					</thead>
					<tbody>
						{linhas.map((l, i) => (
							<tr key={i}>
								<td className="border border-[#c9dadd] px-2 py-1.5 font-semibold text-[#163943]">{l.faixa}</td>
								<td className="border border-[#c9dadd] px-2 py-1.5">{l.dia}</td>
								<td className="border border-[#c9dadd] px-2 py-1.5">{l.canal}</td>
								<td className="border border-[#c9dadd] px-2 py-1.5 text-slate-600">{l.frase}</td>
							</tr>
						))}
						{cpcOrdem.map((a, i) => (
							<tr key={`cpc-${i}`}>
								<td className="border border-[#c9dadd] px-2 py-1.5 font-semibold text-[#163943]">CPC</td>
								<td className="border border-[#c9dadd] px-2 py-1.5">—</td>
								<td className="border border-[#c9dadd] px-2 py-1.5">{canalNome[a.canal] ?? a.canal}</td>
								<td className="border border-[#c9dadd] px-2 py-1.5 text-slate-600">{frasesPorId ? mensagemLabel(a, frasesPorId) : 'frase'}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</>
	);
}

export const FichaEstrategia = ({ dados }: { dados: FichaDados }) => {
	const { nome, empresaNome, credorNome, segmentos, def, personas, calendar, resumo } = dados;
	const locPassos = normPassos(def.localizacao?.passos);
	const giroPassos = normPassos(def.giro?.passos);
	const prevPassos = normPassos(def.preventivo?.passos);
	const quebraPassos = normPassos(def.quebra?.passos);
	const ncp = def.localizacao?.dias_sem_contato_para_ncp ?? 8;
	const ciclo = def.giro?.ciclo_dias ?? 8;
	const maxCiclos = def.giro?.max_ciclos ?? 3;
	const tentCpc = def.cpc?.tentativas_por_canal ?? 3;
	const intervaloCpa = def.cpc?.intervalo_cpa ?? 1;
	const intervaloCpb = def.cpc?.intervalo_cpb ?? 1;
	const cpcOrdem = (def.cpc?.ordem ?? []).filter(a => a.canal);
	const prioCriterios = def.prioridade_contatos?.criterios ?? [];

	const dataExport = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

	return (
		<div id="ficha-estrategia-root" style={{ width: 1123, backgroundColor: '#ffffff', color: '#163943', padding: 40, fontFamily: 'Inter, sans-serif' }}>
			{/* Capa / cabeçalho */}
			<section data-ficha-section className="mb-6 border-b-2 border-[#0F4C5C] pb-4">
				<div className="flex items-start justify-between">
					<div>
						<p className="text-[11px] font-bold uppercase tracking-wider text-[#0F4C5C]">Ficha da estratégia</p>
						<h1 className="mt-1 text-2xl font-bold text-[#163943]">{nome}</h1>
						<p className="mt-1 text-sm text-slate-500">Empresa: <strong className="text-[#163943]">{empresaNome}</strong>{credorNome ? <> · Credor: <strong className="text-[#163943]">{credorNome}</strong></> : null}</p>
						{segmentos.length > 0 && <p className="mt-1 text-sm text-slate-500">Segmentos: <span className="text-[#163943]">{segmentos.join(', ')}</span></p>}
					</div>
					<div className="text-right">
						<p className="text-xs text-slate-500">Exportado em {dataExport}</p>
						<p className="text-xs font-semibold text-[#0F4C5C]">Gerado pelo MotorCX</p>
					</div>
				</div>
			</section>

			<TabelaFaixa titulo="Cliente novo · ainda não deu CPC" passos={locPassos} personas={personas} nota={`Vira Não CPC no dia D+${ncp}.`} />
			<TabelaFaixa titulo="Não CPC · ciclo que se repete" passos={giroPassos} personas={personas} nota={`Ciclo de ${ciclo} dias repetido ${maxCiclos} vezes; depois aguarda enriquecimento.`} />
			<TabelaFaixa titulo="Acordo · preventivo" passos={prevPassos} personas={personas} nota="Dias antes do vencimento de cada parcela." />
			<TabelaFaixa titulo="Acordo · quebra" passos={quebraPassos} personas={personas} nota="Dias depois da quebra do acordo." />

			{/* Deu CPC */}
			<section data-ficha-section className="mb-6">
				<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">Deu CPC · CPC A e CPC B</h2>
				<p className="mb-2 text-xs text-slate-500">O primeiro é sempre o canal em que o cliente deu CPC, no contato principal. Depois segue a ordem de reserva.</p>
				<div className="mb-2 flex flex-wrap items-center gap-2">
					<span className="rounded-full bg-[#e9a23b] px-3 py-1 text-[11px] font-semibold text-white">★ Canal do CPC · contato principal</span>
					{cpcOrdem.map((a, i) => (
						<span key={i} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
							{i > 0 && <span className="text-slate-300">→</span>}
							<span style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }} className="rounded-full px-2 py-0.5 font-semibold text-white">{canalNome[a.canal] ?? a.canal}</span>
						</span>
					))}
				</div>
				<p className="text-xs text-slate-600">Tentativas por canal antes de trocar: <strong>{tentCpc}</strong> · CPC A a cada <strong>{intervaloCpa}</strong> dia{intervaloCpa > 1 ? 's' : ''} · CPC B a cada <strong>{intervaloCpb}</strong> dia{intervaloCpb > 1 ? 's' : ''}.</p>
			</section>

			{/* Frases por dia */}
			<section data-ficha-section className="mb-6">
				<FrasesPorDiaFicha def={def} />
			</section>

			{/* Prioridade dos telefones */}
			<section data-ficha-section className="mb-6">
				<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">Prioridade dos telefones</h2>
				{prioCriterios.length === 0 ? <p className="text-xs italic text-slate-400">Sem regra personalizada (segue o padrão MotorCX).</p> : (
					<p className="text-xs text-slate-600">{prioCriterios.map(c => `${c.campo} (${c.sentido === 'asc' ? 'menor primeiro' : 'maior primeiro'})`).join(', depois ')}</p>
				)}
				{def.prioridade_contatos?.score_minimo != null && <p className="mt-1 text-xs text-slate-600">Descartar score abaixo de <strong>{def.prioridade_contatos.score_minimo}</strong>.</p>}
				{def.prioridade_contatos?.ranking_maximo != null && <p className="text-xs text-slate-600">Descartar ranking acima de <strong>{def.prioridade_contatos.ranking_maximo}</strong>.</p>}
			</section>

			{/* Travas + calendário */}
			<section data-ficha-section className="mb-6">
				<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">Regras e calendário</h2>
				<div className="mb-3 rounded-lg border border-[#e2eaec] bg-[#f7fafb] p-3 text-xs text-[#365661]">
					<strong>Travas que valem sempre:</strong> contato inválido ou que não pertence ao cliente nunca recebe; WhatsApp só em número confiável; horário, domingo e feriado; 48h entre ações massivas.
				</div>
				<div className="rounded-lg border border-[#e2eaec] p-3">
					<p className="mb-1 text-xs font-semibold text-slate-600">Calendário de exportação</p>
					{calendar ? (
						calendar.seguirPadrao ? <p className="text-xs text-slate-600">Segue o padrão do credor ({credorNome}).</p> : (
							<div className="flex flex-wrap gap-1.5">
								{DIAS_SEMANA.map((d, i) => (
									<span key={d} className={`rounded px-2 py-0.5 text-[11px] font-semibold ${calendar.diasSemana.includes(i) ? 'bg-[#0F4C5C] text-white' : 'bg-slate-200 text-slate-400'}`}>{d}</span>
								))}
								{calendar.feriados && <span className="ml-2 text-[11px] text-slate-500">Não exporta em feriado nacional</span>}
							</div>
						)
					) : <p className="text-xs text-slate-500">Segue o padrão do credor.</p>}
				</div>
			</section>

			{/* Como vai funcionar */}
			{resumo.length > 0 && (
				<section data-ficha-section className="mb-2">
					<h2 className="mb-2 text-base font-bold text-[#0F4C5C]">Como vai funcionar</h2>
					<ul className="space-y-1">
						{resumo.map((l, i) => <li key={i} className="text-xs leading-relaxed text-slate-600">• {l}</li>)}
					</ul>
				</section>
			)}
		</div>
	);
};
