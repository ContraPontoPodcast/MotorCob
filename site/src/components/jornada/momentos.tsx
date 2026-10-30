import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Copy, Lock, Plus, Route as RouteIcon, Trash2, X } from 'lucide-react';
import { Empty, Loading, Notice, useAllowed } from '@/components/app-shell';
import { useJornadaCarteira, JornadaHeading } from '@/components/jornada/jornada-shell';
import { friendlyError, supabase, type Credor, type Row } from '@/lib/supabase';
import { canalTipoMensagem, carregarFrases, frasePreview, type Frase } from '@/lib/frases';
import {
	MOMENTOS, MOMENTO_NOME, JORNADA_CANAIS, CANAL_NOME, DEFAULT_PASSOS, diaLabel, diaTexto, diaValido,
	hierarquiaEfetiva, normalizarDefinicao, definicaoPadrao, momentoPersonalizado, momentoAtivo, validarDias,
	type DefinicaoJornada, type MomentoId, type PassoJornada, type PassosJornada, type TravasJornada,
} from '@/lib/jornada';

type Estrategia = { id: string; nome: string; padrao: boolean; definicao: unknown };
type Vista = 'desenho' | 'etapas' | 'travas' | 'visao';

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const SENAO_OPTS = JORNADA_CANAIS.filter(c => c.id !== 'melhor');
const OPCOES_OPTS = JORNADA_CANAIS.filter(c => c.id !== 'melhor');

/** Conta quantos momentos têm alterações não salvas (personalizados ou com orcamento/dias). */
function contarAlteracoes(def: DefinicaoJornada, base: DefinicaoJornada): number {
	let n = 0;
	for (const m of MOMENTOS) {
		const a = def.momentos[m.id];
		const b = base.momentos[m.id];
		if (JSON.stringify(a) !== JSON.stringify(b)) n++;
	}
	if (JSON.stringify(def.hierarquia) !== JSON.stringify(base.hierarquia)) n++;
	if (JSON.stringify(def.travas) !== JSON.stringify(base.travas)) n++;
	if (def.recencia_horas !== base.recencia_horas) n++;
	return n;
}

/** Prévia curta do texto de uma frase, com variáveis em destaque. */
function textoDestaque(f: Frase): string {
	const prev = frasePreview(f);
	return prev.length > 60 ? prev.slice(0, 60) + '…' : prev;
}

function PassoRow({ passo, momento, frases, canEdit, onChange, onRemove }: {
	passo: PassoJornada; momento: MomentoId; frases: Frase[]; canEdit: boolean;
	onChange: (p: PassoJornada) => void; onRemove: () => void;
}) {
	function setOpcao(id: string, on: boolean) {
		const arr = new Set(passo.opcoes ?? []);
		if (on) arr.add(id); else arr.delete(id);
		const opcoes = Array.from(arr);
		onChange({ ...passo, opcoes: opcoes.length ? opcoes : undefined });
	}
	const temMensagem = canalTipoMensagem(passo.canal) !== 'nenhuma';
	const frasesDoCanal = useMemo(
		() => frases.filter(f => f.canal === passo.canal && f.ativo && (f.estagio === momento || f.estagio === 'qualquer' || f.estagio == null)),
		[frases, passo.canal, momento],
	);
	const fraseSel = passo.frase_id ? frasesDoCanal.find(f => f.id === passo.frase_id) : null;

	return (
		<div className="rounded-lg border border-[#E5E5EA] bg-[#FAFAFC] p-3">
			<div className="flex flex-wrap items-center gap-2">
				<select value={passo.canal} disabled={!canEdit} onChange={e => onChange({ ...passo, canal: e.target.value, senao: e.target.value === 'melhor' ? undefined : passo.senao, frase_id: e.target.value === passo.canal ? passo.frase_id : undefined })} className="h-8 rounded border border-[#D2D2D7] bg-white px-2 text-[12px] outline-none disabled:bg-[#F5F5F7]">
					{JORNADA_CANAIS.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
				</select>
				{passo.canal !== 'melhor' && (
					<>
						<span className="text-[11px] text-[#8E8E93]">senão</span>
						<select value={passo.senao ?? ''} disabled={!canEdit} onChange={e => onChange({ ...passo, senao: e.target.value || undefined })} className="h-8 rounded border border-[#D2D2D7] bg-white px-2 text-[12px] outline-none disabled:bg-[#F5F5F7]">
							<option value="">—</option>
							{SENAO_OPTS.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
						</select>
					</>
				)}
				{passo.canal === 'melhor' && (
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[11px] text-[#8E8E93]">escolhe pelo resultado do momento</span>
						{OPCOES_OPTS.map(c => (
							<label key={c.id} className="flex items-center gap-1 text-[12px] text-[#1D1D1F]"><input type="checkbox" disabled={!canEdit} checked={(passo.opcoes ?? []).includes(c.id)} onChange={e => setOpcao(c.id, e.target.checked)} className="accent-[#1D1D1F]" /> {c.nome}</label>
						))}
					</div>
				)}
				<button onClick={onRemove} disabled={!canEdit} aria-label="Remover passo" className="ml-auto grid h-7 w-7 place-items-center rounded text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#FF3B30] disabled:opacity-40"><Trash2 size={13} /></button>
			</div>
			{temMensagem && (
				<div className="mt-2 border-t border-[#ECF0F1] pt-2">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[11px] font-semibold text-[#6E6E73]">Mensagem</span>
						<select value={passo.frase_id ?? ''} disabled={!canEdit} onChange={e => onChange({ ...passo, frase_id: e.target.value || undefined })} className="h-8 min-w-[180px] flex-1 rounded border border-[#D2D2D7] bg-white px-2 text-[12px] outline-none disabled:bg-[#F5F5F7]">
							<option value="">Template padrão do canal</option>
							{frasesDoCanal.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
						</select>
					</div>
					{fraseSel && (
						<p className="mt-1 text-[11px] text-[#6E6E73]">
							{textoDestaque(fraseSel).split(/(\{[^}]+\})/g).map((part, i) =>
								/^\{.+\}$/.test(part) ? <span key={i} className="font-semibold text-[#0A60D0]">{part}</span> : <span key={i}>{part}</span>,
							)}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function DiaBloco({ momento, dia, passos, frases, canEdit, onChange, onRemoveDia }: {
	momento: MomentoId; dia: string; passos: PassoJornada[]; frases: Frase[]; canEdit: boolean;
	onChange: (p: PassoJornada[]) => void; onRemoveDia: () => void;
}) {
	function upd(i: number, p: PassoJornada) { onChange(passos.map((x, idx) => idx === i ? p : x)); }
	function del(i: number) { onChange(passos.filter((_, idx) => idx !== i)); }
	function add() { onChange([...passos, { canal: 'whatsapp' }]); }
	return (
		<div className="rounded-lg border border-[#E5E5EA] bg-white p-3">
			<div className="mb-2 flex items-center justify-between">
				<div>
					<span className="text-[12px] font-bold text-[#1D1D1F]">{diaTexto(momento, Number(dia))}</span>
					<span className="ml-2 text-[10px] font-mono text-[#8E8E93]">{diaLabel(momento, Number(dia))}</span>
				</div>
				<button onClick={onRemoveDia} disabled={!canEdit} className="text-[11px] text-[#8E8E93] hover:text-[#FF3B30] disabled:opacity-40">remover dia</button>
			</div>
			<div className="space-y-1.5">
				{passos.map((p, i) => <PassoRow key={i} passo={p} momento={momento} frases={frases} canEdit={canEdit} onChange={x => upd(i, x)} onRemove={() => del(i)} />)}
			</div>
			{canEdit && <button onClick={add} className="mt-2 flex items-center gap-1 rounded-lg border border-dashed border-[#1D1D1F] px-2.5 py-1 text-[11px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Plus size={12} /> passo</button>}
		</div>
	);
}

function OrcamentoEditor({ orc, canEdit, onChange }: { orc: Record<string, number | null> | undefined; canEdit: boolean; onChange: (o: Record<string, number | null>) => void }) {
	const canais = JORNADA_CANAIS.filter(c => c.id !== 'melhor');
	const cur = orc ?? {};
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			{canais.map(c => (
				<label key={c.id} className="flex items-center gap-2 text-[12px] text-[#1D1D1F]">
					<span className="w-28 shrink-0">{c.nome}</span>
					<input type="number" min={0} disabled={!canEdit} value={cur[c.id] ?? ''} placeholder="sem limite" onChange={e => { const v = e.target.value; const next = { ...cur }; if (v === '') delete next[c.id]; else next[c.id] = Number(v); onChange(next); }} className="h-8 w-24 rounded border border-[#D2D2D7] px-2 text-[12px] outline-none disabled:bg-[#F5F5F7]" />
				</label>
			))}
		</div>
	);
}

function DiasSemanaEditor({ dias, canEdit, onChange }: { dias: number[] | undefined; canEdit: boolean; onChange: (d: number[]) => void }) {
	const cur = dias ?? [0, 1, 2, 3, 4];
	function toggle(d: number) {
		if (!canEdit) return;
		onChange(cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort());
	}
	return (
		<div className="flex flex-wrap gap-1.5">
			{DIAS_SEMANA.map((d, i) => {
				const on = cur.includes(i);
				return (
					<button key={d} type="button" disabled={!canEdit} onClick={() => toggle(i)} className={`h-8 w-11 rounded-lg border text-[11px] font-semibold transition disabled:opacity-50 ${on ? 'border-[#1D1D1F] bg-[#1D1D1F] text-white' : 'border-[#D2D2D7] bg-white text-[#8E8E93] hover:bg-[#F5F5F7]'}`}>{d}</button>
				);
			})}
		</div>
	);
}

function MomentoBloco({ momento, ordem, total, def, setDef, frases, canEdit }: {
	momento: MomentoId; ordem: number; total: number; def: DefinicaoJornada; setDef: (d: DefinicaoJornada) => void; frases: Frase[]; canEdit: boolean;
}) {
	const m = MOMENTOS.find(x => x.id === momento)!;
	const personalizado = momentoPersonalizado(def, momento);
	const ativo = momentoAtivo(def, momento);
	const mdef = def.momentos[momento];
	const passos = (mdef?.passos ?? {}) as PassosJornada;
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);

	function mover(dir: -1 | 1) {
		const h = hierarquiaEfetiva(def);
		const idx = h.indexOf(momento);
		const j = idx + dir;
		if (j < 0 || j >= h.length) return;
		const next = [...h];
		[next[idx], next[j]] = [next[j], next[idx]];
		setDef({ ...def, hierarquia: next });
	}
	function toggleAtivo() {
		const cur = def.momentos[momento] ?? { ativo: true };
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ...cur, ativo: !ativo } } });
	}
	function personalizar() {
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ativo: true, passos: JSON.parse(JSON.stringify(DEFAULT_PASSOS[momento])) } } });
	}
	function voltarPadrao() {
		const cur = def.momentos[momento] ?? { ativo: true };
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ativo: cur.ativo !== false, passos: {} } } });
	}
	function setPassos(dia: string, p: PassoJornada[]) {
		const next = { ...passos };
		if (p.length === 0) delete next[dia]; else next[dia] = p;
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ...(mdef ?? { ativo: true }), passos: next } } });
	}
	function addDia() {
		const n = Number(prompt(`Novo dia para ${m.nome} (faixa ${m.min} a ${m.max}):`));
		if (Number.isNaN(n)) return;
		if (!diaValido(momento, n)) { toast(`${m.nome}: dia fora da faixa (${m.min} a ${m.max}).`); return; }
		const key = String(n);
		if (passos[key]) { toast(`O dia ${diaLabel(momento, n)} já existe.`); return; }
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ...(mdef ?? { ativo: true }), passos: { ...passos, [key]: [{ canal: 'whatsapp' }] } } } });
	}
	function setOrcamento(o: Record<string, number | null>) {
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ...(mdef ?? { ativo: true }), orcamento: Object.keys(o).length ? o : undefined } } });
	}
	function setDias(d: number[]) {
		setDef({ ...def, momentos: { ...def.momentos, [momento]: { ...(mdef ?? { ativo: true }), dias_semana: d } } });
	}

	return (
		<div className={`rounded-2xl border p-5 ${ativo ? 'border-[#E5E5EA] bg-white' : 'border-[#E5E5EA] bg-[#F5F5F7] opacity-80'}`} style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<div className="mb-4 flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					{canEdit && (
						<div className="flex flex-col">
							<button onClick={() => mover(-1)} disabled={ordem === 0} aria-label="Subir" className="grid h-5 w-6 place-items-center rounded text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#1D1D1F] disabled:opacity-30"><ArrowUp size={13} /></button>
							<button onClick={() => mover(1)} disabled={ordem === total - 1} aria-label="Descer" className="grid h-5 w-6 place-items-center rounded text-[#8E8E93] hover:bg-[#F5F5F7] hover:text-[#1D1D1F] disabled:opacity-30"><ArrowDown size={13} /></button>
						</div>
					)}
					<div>
						<div className="flex items-center gap-2">
							<span className="rounded-full bg-[#1D1D1F] px-2 py-0.5 text-[10px] font-bold text-white">{ordem + 1}º</span>
							<h3 className="text-[15px] font-semibold text-[#1D1D1F]">{m.nome}</h3>
						</div>
						<p className="mt-0.5 text-[11px] text-[#8E8E93]">{m.descricao} · faixa {m.min} a {m.max}</p>
					</div>
				</div>
				<label className="flex items-center gap-2 text-[12px] font-medium text-[#6E6E73]">{ativo ? 'Ligado' : 'Desligado'}
					<button role="switch" aria-checked={ativo} disabled={!canEdit} onClick={toggleAtivo} className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${ativo ? 'bg-[#34C759]' : 'bg-[#D2D2D7]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${ativo ? 'left-[18px]' : 'left-0.5'}`} /></button>
				</label>
			</div>

			{!personalizado ? (
				<div className="rounded-lg border border-dashed border-[#D2D2D7] bg-[#FAFAFC] p-4">
					<p className="text-[12px] text-[#8E8E93]">Padrão da Jornada do Cliente:</p>
					<p className="mt-1 text-[13px] text-[#8E8E93]">{Object.keys(DEFAULT_PASSOS[momento]).map(Number).sort((a, b) => a - b).map(d => `${diaTexto(momento, d)}: ${DEFAULT_PASSOS[momento][String(d)].map(p => p.canal === 'melhor' ? 'Melhor canal' : (CANAL_NOME[p.canal] ?? p.canal) + (p.senao ? ` senão ${CANAL_NOME[p.senao]}` : '')).join(' + ')}`).join('  ·  ')}</p>
					{canEdit && <button onClick={personalizar} className="mt-3 rounded-lg bg-[#1D1D1F] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-85">Personalizar</button>}
				</div>
			) : (
				<div className="space-y-3">
					{dias.map(d => <DiaBloco key={d} momento={momento} dia={String(d)} passos={passos[String(d)]} frases={frases} canEdit={canEdit} onChange={p => setPassos(String(d), p)} onRemoveDia={() => setPassos(String(d), [])} />)}
					{canEdit && <button onClick={addDia} className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#1D1D1F] px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Plus size={13} /> Adicionar dia</button>}

					<div className="rounded-lg border border-[#E5E5EA] bg-[#FAFAFC] p-3">
						<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">Orçamento por dia</p>
						<OrcamentoEditor orc={mdef?.orcamento} canEdit={canEdit} onChange={setOrcamento} />
						<p className="mt-2 text-[11px] text-[#8E8E93]">Passou do limite no dia, o cliente concorre de novo amanhã.</p>
					</div>

					<div className="rounded-lg border border-[#E5E5EA] bg-[#FAFAFC] p-3">
						<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">Dias permitidos</p>
						<DiasSemanaEditor dias={mdef?.dias_semana} canEdit={canEdit} onChange={setDias} />
					</div>

					{canEdit && <button onClick={voltarPadrao} className="text-[11px] text-[#8E8E93] underline hover:text-[#FF3B30]">Voltar ao padrão</button>}
				</div>
			)}
		</div>
	);
}

function TravasEditor({ def, setDef, canEdit }: { def: DefinicaoJornada; setDef: (d: DefinicaoJornada) => void; canEdit: boolean }) {
	const t = def.travas ?? {};
	function set(patch: Partial<TravasJornada>) {
		const next = { ...t, ...patch };
		for (const k of Object.keys(next)) { const v = (next as Record<string, unknown>)[k]; if (v === '' || v === null || v === undefined) delete (next as Record<string, unknown>)[k]; }
		setDef({ ...def, travas: Object.keys(next).length ? next : undefined });
	}
	return (
		<div className="rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
			<p className="mb-1 text-[14px] font-bold text-[#1D1D1F]">Travas da jornada</p>
			<p className="mb-4 text-[12px] text-[#8E8E93]">Valem para todos os momentos. Faixas de segurança sempre aplicadas: 08:00–20:00, intervalo mínimo de 12 h.</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="block">
					<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Intervalo entre ações (h)</span>
					<input type="number" min={0} disabled={!canEdit} value={t.intervalo_horas ?? ''} onChange={e => set({ intervalo_horas: e.target.value ? Number(e.target.value) : null })} className="h-9 w-28 rounded border border-[#D2D2D7] px-2 text-[13px] outline-none disabled:bg-[#F5F5F7]" />
				</label>
				<label className="block">
					<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Máximo por semana</span>
					<input type="number" min={0} disabled={!canEdit} value={t.por_semana ?? ''} onChange={e => set({ por_semana: e.target.value ? Number(e.target.value) : null })} className="h-9 w-28 rounded border border-[#D2D2D7] px-2 text-[13px] outline-none disabled:bg-[#F5F5F7]" />
				</label>
				<div>
					<span className="mb-1 block text-[12px] font-semibold text-[#6E6E73]">Horário</span>
					<div className="flex items-center gap-2">
						<input type="time" disabled={!canEdit} value={t.de ?? ''} onChange={e => set({ de: e.target.value || null })} className="h-9 w-28 rounded border border-[#D2D2D7] px-2 text-[13px] outline-none disabled:bg-[#F5F5F7]" />
						<span className="text-[11px] text-[#8E8E93]">até</span>
						<input type="time" disabled={!canEdit} value={t.ate ?? ''} onChange={e => set({ ate: e.target.value || null })} className="h-9 w-28 rounded border border-[#D2D2D7] px-2 text-[13px] outline-none disabled:bg-[#F5F5F7]" />
					</div>
				</div>
				<label className="flex items-center gap-2 text-[13px] text-[#1D1D1F]">
					<input type="checkbox" disabled={!canEdit} checked={!!t.domingo} onChange={e => set({ domingo: e.target.checked || null })} className="accent-[#1D1D1F]" /> Acionar no domingo
				</label>
			</div>
		</div>
	);
}

function VisaoGeralJornada({ def, carteiraNome }: { def: DefinicaoJornada; carteiraNome: string }) {
	const h = hierarquiaEfetiva(def);
	return (
		<div className="space-y-4">
			<section className="rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8E8E93]">Carteira</p>
				<p className="text-[14px] font-semibold text-[#1D1D1F]">{carteiraNome || '—'}</p>
				<p className="mt-1 text-[12px] text-[#8E8E93]">Visão somente leitura da estratégia em vigor.</p>
			</section>
			<section className="rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<p className="mb-3 text-[14px] font-bold text-[#1D1D1F]">Como vai funcionar</p>
				<p className="mb-3 text-[12px] text-[#8E8E93]">Quando o cliente está em dois momentos no mesmo dia, vale o de cima.</p>
				<div className="space-y-2">
					{h.map((mid, i) => {
						const m = MOMENTOS.find(x => x.id === mid)!;
						const ativo = momentoAtivo(def, mid);
						const personalizado = momentoPersonalizado(def, mid);
						return (
							<div key={mid} className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${ativo ? 'border-[#E5E5EA] bg-[#FAFAFC]' : 'border-[#E5E5EA] bg-[#F5F5F7] opacity-60'}`}>
								<span className="mt-0.5 rounded-full bg-[#1D1D1F] px-2 py-0.5 text-[10px] font-bold text-white">{i + 1}º</span>
								<div className="min-w-0">
									<span className="text-[13px] font-semibold text-[#1D1D1F]">{m.nome}</span>
									{ativo ? (
										personalizado ? (
											<p className="text-[11px] text-[#6E6E73]">{Object.keys(def.momentos[mid]?.passos ?? {}).map(Number).sort((a, b) => a - b).map(d => `${diaTexto(mid, d)}: ${(def.momentos[mid]!.passos![String(d)] ?? []).map(p => p.canal === 'melhor' ? 'Melhor canal' : (CANAL_NOME[p.canal] ?? p.canal) + (p.senao ? ` senão ${CANAL_NOME[p.senao]}` : '')).join(' + ')}`).join('  ·  ') || 'Sem passos'}</p>
										) : <p className="text-[11px] italic text-[#8E8E93]">Padrão da Jornada do Cliente</p>
									) : <p className="text-[11px] text-[#8E8E93]">Desligado</p>}
								</div>
							</div>
						);
					})}
				</div>
			</section>
		</div>
	);
}

export function JornadaMomentos() {
	const { empresa, carteira, carteiras, loading: cartLoading } = useJornadaCarteira();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [estrategias, setEstrategias] = useState<Estrategia[]>([]);
	const [frases, setFrases] = useState<Frase[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [def, setDef] = useState<DefinicaoJornada>(definicaoPadrao());
	const [baseDef, setBaseDef] = useState<DefinicaoJornada>(definicaoPadrao());
	const [estrId, setEstrId] = useState<string | null>(null);
	const [estrNome, setEstrNome] = useState('');
	const [padrao, setPadrao] = useState(false);
	const [compartilhada, setCompartilhada] = useState(false);
	const [outrasCarteiras, setOutrasCarteiras] = useState<string>('');
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [busy, setBusy] = useState('');
	const [vista, setVista] = useState<Vista>('desenho');
	const [copiarOpen, setCopiarOpen] = useState(false);

	async function reload() {
		if (!supabase || !empresa) return;
		setLoading(true); setError('');
		const [e, f] = await Promise.all([
			supabase.from('estrategias').select('id,nome,padrao,definicao,frente').eq('empresa_id', empresa.id).order('nome'),
			carregarFrases(empresa.id),
		]);
		if (e.error) { setError(friendlyError()); setLoading(false); return; }
		const items = ((e.data ?? []) as Row[]).filter(r => r.frente === 'motorcli') as unknown as Estrategia[];
		setEstrategias(items);
		setFrases(f.frases);
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id]);

	// Estratégia em vigor: a do credor, ou a padrão da frente motorcli.
	const estrategiaAtual = useMemo(() => {
		if (!carteira) return null;
		if (carteira.estrategia_id) return estrategias.find(e => e.id === carteira.estrategia_id) ?? null;
		return estrategias.find(e => e.padrao) ?? estrategias[0] ?? null;
	}, [carteira, estrategias]);

	useEffect(() => {
		if (estrategiaAtual) {
			const nd = normalizarDefinicao(estrategiaAtual.definicao);
			setDef(nd); setBaseDef(nd);
			setEstrId(estrategiaAtual.id); setEstrNome(estrategiaAtual.nome); setPadrao(estrategiaAtual.padrao);
		} else {
			const nd = definicaoPadrao();
			setDef(nd); setBaseDef(nd); setEstrId(null); setEstrNome(''); setPadrao(false);
		}
		setDirty(false); setCompartilhada(false); setOutrasCarteiras('');
	}, [estrategiaAtual?.id]);

	// Carteiras que compartilham a estratégia.
	useEffect(() => {
		if (!supabase || !carteira || !estrId) { setCompartilhada(false); setOutrasCarteiras(''); return; }
		let active = true;
		(async () => {
			const { data } = await supabase.rpc('carteiras_da_estrategia', { estrategia: estrId });
			if (!active) return;
			const nomes = (Array.isArray(data) ? (data as Row[]) : []).map(r => String(r.nome ?? r.codigo ?? '')).filter(Boolean);
			const outras = nomes.filter(n => n !== carteira.nome);
			setCompartilhada(outras.length > 0);
			setOutrasCarteiras(outras.join(', '));
		})();
		return () => { active = false; };
	}, [estrId, carteira?.id]);

	const alteracoes = useMemo(() => contarAlteracoes(def, baseDef), [def, baseDef]);
	useEffect(() => { setDirty(alteracoes > 0); }, [alteracoes]);

	async function separar() {
		if (!supabase || !carteira) return;
		setBusy('separar');
		const { data, error } = await supabase.rpc('separar_estrategia_jornada', { credor: carteira.id });
		if (error || !data) { setError(friendlyError()); setBusy(''); return; }
		toast.success('Estratégia separada só para esta carteira.');
		setBusy(''); void reload();
	}

	async function salvar() {
		if (!supabase || !estrId) return;
		const err = validarDias(def);
		if (err) { toast.error(err); return; }
		setSaving(true); setError('');
		const { error } = await supabase.from('estrategias').update({ nome: estrNome.trim() || 'Estratégia', definicao: def as unknown as Record<string, unknown> }).eq('id', estrId);
		if (error) setError(friendlyError()); else { setDirty(false); setBaseDef(JSON.parse(JSON.stringify(def))); toast.success('Momentos da jornada salvos.'); }
		setSaving(false);
	}

	if (!empresa) return <><JornadaHeading title="Momentos da jornada" /><Notice variant="warning">Escolha a empresa no topo.</Notice></>;
	if (cartLoading || loading) return <><JornadaHeading title="Momentos da jornada" /><Loading /></>;
	if (!carteira) return <><JornadaHeading title="Momentos da jornada" /><Empty>Nenhuma carteira da Jornada. Crie uma em Carteiras.</Empty></>;
	if (!estrategiaAtual) return <><JornadaHeading title="Momentos da jornada" /><Empty>Nenhuma estratégia da Jornada. {canEdit && 'Crie a primeira em Carteiras.'}</Empty></>;

	const VISTAS: { id: Vista; label: string }[] = [
		{ id: 'desenho', label: 'Desenho' },
		{ id: 'etapas', label: 'Momentos e fases' },
		{ id: 'travas', label: 'Travas' },
		{ id: 'visao', label: 'Visão geral' },
	];
	const hierarquia = hierarquiaEfetiva(def);

	return (
		<>
			<JornadaHeading title="Momentos da jornada" linha="Defina os passos de cada momento da jornada do cliente." />

			{compartilhada && (
				<div className="mb-5 rounded-xl border border-[#f0d49a] bg-[#FFF7E8] p-5">
					<p className="text-[13px] font-medium text-[#9a631b]">Estratégia compartilhada. <strong>{carteira.nome}</strong> também vale para {outrasCarteiras}. Mudar aqui muda todas.</p>
					<div className="mt-3 flex flex-wrap gap-2">
						{canEdit && <button onClick={separar} disabled={busy === 'separar'} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#1D1D1F] px-4 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy === 'separar' ? 'Separando...' : 'Separar só para esta carteira'}</button>}
						<button onClick={() => setCompartilhada(false)} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#9a631b] px-4 text-[12px] font-semibold text-[#9a631b] hover:bg-[#FFF1D8]">Editar para todas</button>
					</div>
				</div>
			)}
			{error && <div className="mb-5"><Notice>{error}</Notice></div>}

			{/* Barra única (prompt 41) */}
			<section className="sticky top-0 z-20 mb-5 rounded-xl border border-[#E5E5EA] bg-white p-3" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-wrap gap-1 rounded-lg bg-[#F5F5F7] p-1">
						{VISTAS.map(v => (
							<button key={v.id} onClick={() => setVista(v.id)} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold transition ${vista === v.id ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#8E8E93] hover:text-[#1D1D1F]'}`}>{v.label}</button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${dirty ? 'bg-[#FFF3DF] text-[#9a631b]' : 'bg-[#E8F8EC] text-[#248A3D]'}`}>
							<span className={`h-2 w-2 rounded-full ${dirty ? 'bg-[#FF9500]' : 'bg-[#34C759]'}`} />
							{dirty ? `Alterações não salvas: ${alteracoes}` : 'Tudo salvo'}
						</span>
						{!canEdit && <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-2.5 py-1 text-[11px] font-medium text-[#8E8E93]"><Lock size={12} /> Somente leitura</span>}
						{canEdit && estrId && <button onClick={() => setCopiarOpen(true)} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#D2D2D7] px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"><Copy size={14} /> Copiar de outra carteira</button>}
						{canEdit && estrId && <button onClick={salvar} disabled={saving} className="flex h-9 items-center gap-2 rounded-lg bg-[#1D1D1F] px-5 text-[12px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{dirty && <span className="h-2 w-2 rounded-full bg-[#FF9500]" />}{saving ? 'Salvando...' : 'Salvar'}</button>}
					</div>
				</div>
			</section>

			{vista === 'desenho' && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E5E5EA] bg-white p-4" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
						<RouteIcon size={18} className="text-[#8E8E93]" />
						<input value={estrNome} disabled={!canEdit} onChange={e => { setEstrNome(e.target.value); setDirty(true); }} className="h-9 flex-1 min-w-[180px] rounded-lg border border-[#D2D2D7] px-3 text-[14px] font-medium outline-none focus:border-[#1D1D1F] disabled:bg-transparent disabled:border-transparent" />
						{padrao && <span className="rounded-full bg-[#FFF3DF] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#9a631b]">Padrão</span>}
						<label className="flex items-center gap-2 text-[12px] font-medium text-[#6E6E73]">Horas entre ações
							<input type="number" min={1} disabled={!canEdit} value={def.recencia_horas} onChange={e => { setDef({ ...def, recencia_horas: Number(e.target.value) || 48 }); setDirty(true); }} className="h-9 w-20 rounded border border-[#D2D2D7] px-2 text-[14px] outline-none disabled:bg-[#F5F5F7]" />
						</label>
					</div>
					<p className="text-[12px] text-[#8E8E93]">Quando o cliente está em dois momentos no mesmo dia, vale o de cima.</p>
					{hierarquia.map((mid, i) => (
						<MomentoBloco key={mid} momento={mid} ordem={i} total={hierarquia.length} def={def} setDef={d => { setDef(d); setDirty(true); }} frases={frases} canEdit={canEdit} />
					))}
				</div>
			)}

			{vista === 'etapas' && (
				<div className="space-y-4">
					{hierarquia.map((mid, i) => {
						const m = MOMENTOS.find(x => x.id === mid)!;
						const ativo = momentoAtivo(def, mid);
						const personalizado = momentoPersonalizado(def, mid);
						const passos = def.momentos[mid]?.passos ?? {};
						return (
							<div key={mid} className="rounded-2xl border border-[#E5E5EA] bg-white p-5" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
								<div className="mb-3 flex items-center gap-2">
									<span className="rounded-full bg-[#1D1D1F] px-2 py-0.5 text-[10px] font-bold text-white">{i + 1}º</span>
									<h3 className="text-[15px] font-semibold text-[#1D1D1F]">{m.nome}</h3>
									{!ativo && <span className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-bold uppercase text-[#8E8E93]">Desligado</span>}
								</div>
								{personalizado ? (
									<div className="space-y-1.5">
										{Object.keys(passos).map(Number).sort((a, b) => a - b).map(d => (
											<div key={d} className="flex items-start gap-2 text-[12px] text-[#6E6E73]">
												<span className="min-w-[200px] font-semibold text-[#1D1D1F]">{diaTexto(mid, d)} <span className="font-mono text-[10px] text-[#8E8E93]">{diaLabel(mid, d)}</span></span>
												<span>{(passos[String(d)] ?? []).map(p => p.canal === 'melhor' ? 'Melhor canal' : (CANAL_NOME[p.canal] ?? p.canal) + (p.senao ? ` senão ${CANAL_NOME[p.senao]}` : '')).join(' + ')}</span>
											</div>
										))}
									</div>
								) : <p className="text-[12px] italic text-[#8E8E93]">Padrão da Jornada do Cliente</p>}
							</div>
						);
					})}
				</div>
			)}

			{vista === 'travas' && <TravasEditor def={def} setDef={d => { setDef(d); setDirty(true); }} canEdit={canEdit} />}

			{vista === 'visao' && <VisaoGeralJornada def={def} carteiraNome={carteira.nome} />}

			{copiarOpen && <CopiarModal carteiras={carteiras} atualId={carteira.id} onClose={() => setCopiarOpen(false)} onCopiado={() => { setCopiarOpen(false); void reload(); }} />}
		</>
	);
}

function CopiarModal({ carteiras, atualId, onClose, onCopiado }: { carteiras: Credor[]; atualId: string; onClose: () => void; onCopiado: () => void }) {
	const { carteira } = useJornadaCarteira();
	const [origem, setOrigem] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const outras = carteiras.filter(c => c.id !== atualId);

	async function copiar() {
		if (!supabase || !carteira || !origem) return;
		setBusy(true); setError('');
		const { error } = await supabase.rpc('copiar_estrategia_jornada', { credor: carteira.id, origem });
		if (error) { setError(friendlyError()); setBusy(false); return; }
		toast.success('Estratégia copiada (cópia independente).');
		setBusy(false); onCopiado();
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 24px 60px -20px rgba(0,0,0,.4)' }} onClick={e => e.stopPropagation()}>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-[16px] font-semibold text-[#1D1D1F]">Copiar de outra carteira</h2>
					<button onClick={onClose} aria-label="Fechar"><X size={18} className="text-[#8E8E93]" /></button>
				</div>
				<p className="mb-3 text-[12px] text-[#8E8E93]">Cria uma cópia independente só para esta carteira.</p>
				{error && <div className="mb-3"><Notice>{error}</Notice></div>}
				{outras.length === 0 ? (
					<p className="py-4 text-center text-[13px] text-[#8E8E93]">Nenhuma outra carteira da Jornada.</p>
				) : (
					<select value={origem} onChange={e => setOrigem(e.target.value)} className="h-10 w-full rounded-lg border border-[#D2D2D7] bg-white px-3 text-[14px] outline-none focus:border-[#1D1D1F]">
						<option value="">Escolha a carteira de origem</option>
						{outras.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
					</select>
				)}
				<div className="mt-5 flex justify-end gap-2">
					<button onClick={onClose} className="h-9 rounded-lg border border-[#D2D2D7] px-4 text-[13px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Cancelar</button>
					<button onClick={copiar} disabled={busy || !origem} className="h-9 rounded-lg bg-[#1D1D1F] px-5 text-[13px] font-semibold text-white hover:opacity-85 disabled:opacity-50">{busy ? 'Copiando...' : 'Copiar'}</button>
				</div>
			</div>
		</div>
	);
}
