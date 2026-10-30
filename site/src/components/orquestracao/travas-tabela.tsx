import { type Definicao, type TravasEstrategia, type TravasFase } from '@/lib/estrategia';
import { FASES, TRAVAS_FASE, TRAVAS_ESTRATEGIA, getTravasFase, type FaseId } from './fases-config';
import { Info } from '@/components/glossario/info';

function travasEstrategia(def: Definicao): TravasEstrategia {
	return def.travas ?? {};
}

function setTravasEstrategia(def: Definicao, patch: Partial<TravasEstrategia>): Definicao {
	const cur = def.travas ?? {};
	const next = { ...cur, ...patch };
	// limpa vazios
	for (const k of Object.keys(next)) {
		const v = (next as Record<string, unknown>)[k];
		if (v === '' || v === null || v === undefined) delete (next as Record<string, unknown>)[k];
	}
	return { ...def, travas: Object.keys(next).length ? next : undefined };
}

function setTravaFase(def: Definicao, fase: FaseId, patch: Partial<TravasFase>): Definicao {
	const obj = (def[fase] ?? { passos: {} }) as Record<string, unknown>;
	const cur = (obj.travas ?? {}) as TravasFase;
	const next = { ...cur, ...patch };
	for (const k of Object.keys(next)) {
		const v = (next as Record<string, unknown>)[k];
		if (v === '' || v === null || v === undefined) delete (next as Record<string, unknown>)[k];
	}
	const cleaned = Object.keys(next).length ? next : undefined;
	const faseObj = { ...obj, travas: cleaned } as Record<string, unknown>;
	return { ...def, [fase]: faseObj } as Definicao;
}

function NumCell({ value, placeholder, onChange, disabled, sufixo }: { value: number | '' ; placeholder: string; onChange: (v: number | null) => void; disabled?: boolean; sufixo?: string }) {
	return (
		<div className="flex items-center justify-center gap-0.5">
			<input
				type="number"
				value={value}
				disabled={disabled}
				placeholder={placeholder}
				onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
				className="h-8 w-16 rounded border border-[#d8e3e5] bg-white px-2 text-center text-xs outline-none focus:border-[#0F4C5C] disabled:bg-transparent disabled:text-slate-400"
			/>
			{sufixo && <span className="text-[10px] text-slate-400">{sufixo}</span>}
		</div>
	);
}

function HorarioCell({ de, ate, onChange, disabled }: { de: string | null; ate: string | null; onChange: (de: string | null, ate: string | null) => void; disabled?: boolean }) {
	return (
		<div className="flex items-center justify-center gap-1">
			<input type="time" value={de ?? ''} disabled={disabled} onChange={e => onChange(e.target.value || null, ate)} className="h-8 w-[72px] rounded border border-[#d8e3e5] bg-white px-1 text-center text-xs outline-none focus:border-[#0F4C5C] disabled:bg-transparent disabled:text-slate-400" />
			<span className="text-[10px] text-slate-400">às</span>
			<input type="time" value={ate ?? ''} disabled={disabled} onChange={e => onChange(de, e.target.value || null)} className="h-8 w-[72px] rounded border border-[#d8e3e5] bg-white px-1 text-center text-xs outline-none focus:border-[#0F4C5C] disabled:bg-transparent disabled:text-slate-400" />
		</div>
	);
}

function BoolCell({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
	return (
		<button type="button" role="switch" aria-checked={value} disabled={disabled} onClick={() => onChange(!value)} className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${value ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}>
			<span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? 'left-[18px]' : 'left-0.5'}`} />
		</button>
	);
}

export function TravasTabela({ def, setDef, canEdit }: { def: Definicao; setDef: (d: Definicao) => void; canEdit: boolean }) {
	const te = travasEstrategia(def);

	return (
		<div className="rounded-xl border border-[#dfe8ea] bg-white p-5">
			<p className="mb-1 text-sm font-bold text-[#163943]">Travas da estratégia <Info slug="travas" /></p>
			<p className="mb-4 text-xs text-slate-500">Intervalo, ações por dia e horário aceitam valor próprio por fase. As demais travas valem para todas as fases.</p>
			<div className="overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr>
							<th className="sticky left-0 z-10 bg-white border border-[#c9dadd] bg-[#eaf2f3] px-3 py-2 text-left text-xs font-semibold text-[#0F4C5C]" style={{ minWidth: 180 }}>Trava</th>
							<th className="border border-[#c9dadd] bg-[#eaf2f3] px-3 py-2 text-center text-xs font-semibold text-[#0F4C5C]" style={{ minWidth: 130 }}>Estratégia</th>
							{FASES.map(f => <th key={f.id} className="border border-[#c9dadd] bg-[#eaf2f3] px-3 py-2 text-center text-xs font-semibold text-[#0F4C5C]" style={{ minWidth: 130 }}>{f.nome}</th>)}
						</tr>
					</thead>
					<tbody>
						{TRAVAS_FASE.map(t => (
							<tr key={t.id} className="border-t border-[#eef3f4]">
								<td className="sticky left-0 z-10 bg-white border border-[#c9dadd] px-3 py-2 text-xs font-medium text-[#163943]">{t.label}</td>
								<td className="border border-[#c9dadd] px-2 py-2 text-center">
									{t.tipo === 'horario'
										? <HorarioCell de={te.de ?? null} ate={te.ate ?? null} disabled={!canEdit} onChange={(de, ate) => setDef(setTravasEstrategia(def, { de, ate }))} />
										: <NumCell value={(te as Record<string, number | null>)[t.id] ?? ''} placeholder="—" sufixo={t.sufixo} disabled={!canEdit} onChange={v => setDef(setTravasEstrategia(def, { [t.id]: v }))} />}
								</td>
								{FASES.map(f => {
									const tf = getTravasFase(def, f.id) ?? {};
									const temPropria = t.tipo === 'horario' ? !!(tf.de || tf.ate) : (tf as Record<string, number | null>)[t.id] != null;
									return (
										<td key={f.id} className="border border-[#c9dadd] px-2 py-2 text-center align-middle">
											<div className="flex flex-col items-center gap-1">
												{t.tipo === 'horario'
													? <HorarioCell de={tf.de ?? null} ate={tf.ate ?? null} disabled={!canEdit} onChange={(de, ate) => setDef(setTravaFase(def, f.id, { de, ate }))} />
													: <NumCell value={(tf as Record<string, number | null>)[t.id] ?? ''} placeholder="—" sufixo={t.sufixo} disabled={!canEdit} onChange={v => setDef(setTravaFase(def, f.id, { [t.id]: v }))} />}
												{temPropria && canEdit && (
													<button type="button" onClick={() => setDef(setTravaFase(def, f.id, t.tipo === 'horario' ? { de: null, ate: null } : { [t.id]: null }))} className="text-[9px] font-semibold text-[#0F4C5C] hover:underline" title="Voltar ao da estratégia">desta fase · voltar</button>
												)}
												{temPropria && !canEdit && <span className="rounded bg-[#fff3df] px-1.5 py-0.5 text-[9px] font-bold text-[#9a631b]">desta fase</span>}
											</div>
										</td>
									);
								})}
							</tr>
						))}
						{TRAVAS_ESTRATEGIA.map(t => (
							<tr key={t.id} className="border-t border-[#eef3f4] bg-[#fafcfc]">
								<td className="sticky left-0 z-10 bg-[#fafcfc] border border-[#c9dadd] px-3 py-2 text-xs font-medium text-[#163943]">{t.label}</td>
								<td className="border border-[#c9dadd] px-2 py-2 text-center">
									{t.tipo === 'bool'
										? <BoolCell value={!!(te as Record<string, boolean>)[t.id]} disabled={!canEdit} onChange={v => setDef(setTravasEstrategia(def, { [t.id]: v }))} />
										: <NumCell value={(te as Record<string, number | null>)[t.id] ?? ''} placeholder="—" sufixo={t.sufixo} disabled={!canEdit} onChange={v => setDef(setTravasEstrategia(def, { [t.id]: v }))} />}
								</td>
								{FASES.map(f => <td key={f.id} className="border border-[#c9dadd] px-2 py-2 text-center text-[10px] text-slate-300">—</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="mt-4 rounded-lg bg-[#f5f8f9] px-4 py-3 text-xs leading-relaxed text-[#365661]">
				<strong>Faixas de segurança valem sempre:</strong> 08:00–20:00, intervalo mínimo de 12 h, freio do WhatsApp até 5%.
			</div>
		</div>
	);
}
