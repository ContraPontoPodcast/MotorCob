import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ChevronDown, FileText, MessageCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Users, X } from 'lucide-react';
import {
	canalLabel, diaFrase, playbookDefinicao,
	type Acao, type CriterioPrioridade, type Definicao, type MensagemAcao, type Passos, type PrioridadeContatos,
} from '@/lib/estrategia';
import type { PersonaUsuario } from '@/lib/supabase';
import { numberBR, supabase } from '@/lib/supabase';
import { type Persona, type PersonaResumo, resumoDePersona } from '@/lib/personas';
import { useMotorAuth } from '@/components/auth-provider';
import { PersonaCanalPopover } from '@/components/personas/persona-canal-popover';
import { MensagemDiaEditor } from '@/components/estrategias/mensagem-dia-editor';
import { EscolherMensagem, EscolherMensagemCpc } from '@/components/estrategias/escolher-mensagem';
import { AcaoCard } from '@/components/estrategias/estrategia-editor-core';
import { carregarFrases, salvarFrase, canalTipoMensagem, type Frase } from '@/lib/frases';
import {
	hasMensagem, mensagemStatus, mensagemLabel, faixaTemFraseDesativada, contagemFrasesFaixa,
	migrarMensagensParaDias, cpcHotStatus, cpcMensagemStatus, cpcMensagemLabel,
} from '@/lib/mensagem-dia';
import { FrasesDaFaixa, FrasesCpcFaixa } from '@/components/estrategias/frases-da-faixa';

/** Personas da inteligência (tabela `personas`) para o popover ★/☆. */
const PersonasIntelContext = createContext<PersonaResumo[]>([]);

/** Canal + cor do chip, conforme o prompt de Desenho da Esteira. */
const CANAIS = [
	{ id: 'whatsapp', label: 'WhatsApp', cor: '#1F8A4C' },
	{ id: 'rcs', label: 'RCS', cor: '#3B5BA9' },
	{ id: 'sms', label: 'SMS', cor: '#7A4FB0' },
	{ id: 'email', label: 'E-mail', cor: '#A2552B' },
	{ id: 'agente_voz', label: 'Agente virtual', cor: '#0E7C86' },
	{ id: 'discador', label: 'Discador', cor: '#475569' },
] as const;
/** Canal especial de enriquecimento (bureau) — cinza, ícone de lupa, sem modo. */
const ENRIQ = { id: 'enriquecimento', label: 'Enriquecimento (bureau)', cor: '#64748b' };
const canalCor: Record<string, string> = Object.fromEntries([...CANAIS.map(c => [c.id, c.cor]), [ENRIQ.id, ENRIQ.cor]]);
const canalNome: Record<string, string> = { ...canalLabel, ...Object.fromEntries(CANAIS.map(c => [c.id, c.label])), enriquecimento: 'Enviar ao bureau', persona_1: '★ Melhor da persona', persona_2: '☆ 2º da persona' };

/** Canais de persona — chips com borda tracejada âmbar na barra. */
const PERSONA_CANAIS = [
	{ id: 'persona_1', label: '★ Melhor canal da persona' },
	{ id: 'persona_2', label: '☆ 2º melhor da persona' },
] as const;

/** Critérios de prioridade de telefones disponíveis. */
const CRITERIOS_OPTS = [
	{ campo: 'ranking', label: 'Ranking do bureau', sentido: 'asc' as const },
	{ campo: 'score', label: 'Score do bureau', sentido: 'desc' as const },
	{ campo: 'whatsapp', label: 'Tem WhatsApp', sentido: 'desc' as const },
	{ campo: 'rcs', label: 'Tem RCS', sentido: 'desc' as const },
	{ campo: 'bureau', label: 'Veio do bureau', sentido: 'desc' as const },
];

const MODO_ORDEM = ['senao', 'junto', 'reserva'] as const;
const MODO_LABEL: Record<string, string> = { senao: 'senão', junto: '+ junto', reserva: 'reserva' };

/** Rótulo do conector na célula (item 1.2). */
function conectorLabel(modo: string | undefined): string {
	if (modo === 'junto') return '+ junto';
	if (modo === 'reserva') return '↻ reserva';
	if (modo === 'sempre') return 'e sempre';
	return '↳ senão';
}

/** Lista de ações de uma célula no novo formato: 1º canal em destaque, demais recuadas com conector. */
function AcoesCelula({ acoes, canEdit, onCycle, onRemove, onChipDrag, highlightCanal, dupIdx, frasesPorId, onEditMensagem }: {
	acoes: Acao[]; canEdit: boolean;
	onCycle: (i: number) => void; onRemove: (i: number) => void; onChipDrag: (e: React.DragEvent, i: number) => void;
	highlightCanal?: string | null; dupIdx: Set<number>;
	frasesPorId: Map<string, Frase>; onEditMensagem: (i: number) => void;
}) {
	return (
		<div className="flex flex-1 flex-col items-stretch gap-1">
			{acoes.map((a, i) => {
				const isEnriq = a.canal === 'enriquecimento';
				const cor = canalCor[a.canal] ?? '#475569';
				const isPrimeiro = i === 0;
				const showConector = !isPrimeiro && !isEnriq;
				const modo = a.modo ?? 'senao';
				const mStatus = mensagemStatus(a, frasesPorId);
				const mLabel = mensagemLabel(a, frasesPorId);
				const dim = dupIdx.has(i);
				const hl = highlightCanal === a.canal;
				return (
					<div key={i} className={isPrimeiro ? '' : 'ml-[9px] border-l-[1.5px] border-[var(--base-borda)] pl-2'}>
						<div className={`flex items-center gap-1.5 ${dim ? 'opacity-40' : ''} ${hl ? 'ring-1 ring-[#e9a23b] rounded' : ''}`}>
							{showConector && (
								canEdit ? (
									<button type="button" onClick={e => { e.stopPropagation(); onCycle(i); }} className="shrink-0 rounded-full bg-[var(--base-fill)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill-2)]">{conectorLabel(modo)}</button>
								) : (
									<span className="shrink-0 rounded-full bg-[var(--base-fill)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--base-texto-2)]">{conectorLabel(modo)}</span>
								)
							)}
							<span draggable={canEdit} onDragStart={e => onChipDrag(e, i)} className="flex min-w-0 items-center gap-1.5">
								<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
								<span className={`truncate ${isPrimeiro ? 'text-[12px] font-bold' : 'text-[11.5px] font-semibold'} text-[#163943]`}>{canalNome[a.canal] ?? a.canal}</span>
							</span>
							{canalTipoMensagem(a.canal) !== 'nenhuma' && (
								<button type="button" onClick={e => { e.stopPropagation(); onEditMensagem(i); }} title={mLabel || (canalTipoMensagem(a.canal) === 'template' ? 'Sem template' : 'Sem frase')} aria-label="Editar mensagem"
									className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full transition ${mStatus === 'desativada' ? 'bg-[#C62828] text-white' : mStatus !== 'nenhuma' ? 'bg-[var(--base-fill)] text-[#0F4C5C]' : 'border border-[var(--base-borda)] text-[var(--base-texto-3)]'}`}>
									<MessageCircle size={10} strokeWidth={2.5} />
								</button>
							)}
							{canEdit && (
								<button type="button" onClick={e => { e.stopPropagation(); onRemove(i); }} className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[var(--base-texto-3)] hover:bg-[var(--base-fill)] hover:text-[#C62828]" aria-label="Tirar canal"><X size={10} strokeWidth={2.5} /></button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

type Track = 'localizacao' | 'giro' | 'preventivo' | 'quebra';

/** Aceita o formato antigo (lista de nomes de canal) e normaliza em Acao. */
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

/** Divide ações com várias personas em uma ação por persona (para edição/save). */
function splitMultiPersona(arr: Acao[]): Acao[] {
	const out: Acao[] = [];
	for (const a of arr) {
		if (a.personas && a.personas.length > 1) {
			for (const id of a.personas) out.push({ ...a, personas: [id] });
		} else {
			out.push(a);
		}
	}
	return out;
}

function isPublico(a: Acao): boolean {
	return !a.personas || a.personas.length === 0;
}
function acoesPublico(arr: Acao[]): Acao[] {
	return arr.filter(isPublico);
}
function acoesPersona(arr: Acao[], pid: string): Acao[] {
	return arr.filter(a => a.personas?.includes(pid));
}

function diaLabel(d: number): string {
	if (d === 0) return 'D0';
	if (d > 0) return `D+${d}`;
	return `D${d}`;
}

function getTrackObj(def: Definicao, track: Track) {
	return track === 'localizacao' ? def.localizacao : track === 'giro' ? def.giro : track === 'preventivo' ? def.preventivo : def.quebra;
}
function applyTrack(def: Definicao, track: Track, passos: Passos): Definicao {
	if (track === 'localizacao') return { ...def, localizacao: { ...(def.localizacao ?? { passos: {}, dias_sem_contato_para_ncp: 8 }), passos } };
	if (track === 'giro') return { ...def, giro: { ...(def.giro ?? { passos: {}, ciclo_dias: 8, max_ciclos: 3 }), passos } };
	if (track === 'preventivo') return { ...def, preventivo: { ...(def.preventivo ?? { passos: {} }), passos } };
	return { ...def, quebra: { ...(def.quebra ?? { passos: {}, dias_para_estoque: 6 }), passos } };
}

/** Reconstrói a lista de ações de um dia: público geral primeiro, depois cada persona na ordem. */
function rebuildDay(arr: Acao[], lane: string, newLaneActs: Acao[], personaOrder: string[]): Acao[] {
	const pub = lane === 'pub' ? newLaneActs : acoesPublico(arr);
	const out = [...pub];
	for (const pid of personaOrder) {
		const acts = lane === pid ? newLaneActs : acoesPersona(arr, pid);
		out.push(...acts);
	}
	return out;
}

// ---- resumo "Como vai funcionar" ----
function laneFrase(acts: Acao[]): string {
	const ativas = acts.filter(a => a.canal !== 'sem_acao');
	if (!ativas.length) return 'sem ação';
	return diaFrase(ativas);
}

function resumoFaixa(passos: Passos, prefixo: string, personas: PersonaUsuario[]): string[] {
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	const lines: string[] = [];
	for (const d of dias) {
		const acts = passos[String(d)] ?? [];
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

function faixaGeralVazia(passos: Passos): boolean {
	for (const arr of Object.values(passos)) {
		if (acoesPublico(arr).length > 0) return false;
	}
	return true;
}
function faixaTemPersona(passos: Passos): boolean {
	for (const arr of Object.values(passos)) {
		if (arr.some(a => a.personas && a.personas.length > 0)) return true;
	}
	return false;
}

function ChipCanal({ canal, onRemove, size = 'md', draggable, onDragStart, highlight, dimmed, msgStatus, msgLabel, onEditMsg }: { canal: string; onRemove?: () => void; size?: 'sm' | 'md'; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; highlight?: boolean; dimmed?: boolean; msgStatus?: 'nenhuma' | 'texto' | 'frase' | 'desativada'; msgLabel?: string; onEditMsg?: () => void }) {
	const cor = canalCor[canal] ?? '#475569';
	const personasIntel = useContext(PersonasIntelContext);
	const ehPersona = canal === 'persona_1' || canal === 'persona_2';
	const tipo = canalTipoMensagem(canal);
	const temDot = tipo !== 'nenhuma'; // WhatsApp, RCS, SMS, Agente virtual
	const DotIcon = tipo === 'template' ? FileText : MessageCircle;
	const hasMsg = !!msgStatus && msgStatus !== 'nenhuma';
	const dotTitle = !msgStatus || msgStatus === 'nenhuma'
		? (tipo === 'template' ? 'Sem template' : 'Sem frase')
		: (tipo === 'template' ? `Template: ${msgLabel || '—'}` : `Frase: ${msgLabel || '—'}`);
	const dot = (temDot && onEditMsg) ? (
		<button type="button" onClick={e => { e.stopPropagation(); onEditMsg(); }} title={dotTitle} aria-label="Editar mensagem"
			className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full transition ${msgStatus === 'desativada' ? 'bg-[#C62828] text-white' : hasMsg ? 'bg-white' : 'border border-white/70 text-white/70'}`}
			style={hasMsg && msgStatus !== 'desativada' ? { color: cor } : undefined}>
			<DotIcon size={10} strokeWidth={2.5} />
		</button>
	) : null;
	const chip = (
		<span
			draggable={draggable}
			onDragStart={onDragStart}
			className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white transition-transform ${highlight ? 'scale-110 ring-2 ring-[#e9a23b] ring-offset-1' : ''} ${dimmed ? 'opacity-40' : ''}`}
			style={{ backgroundColor: cor }}
		>
			{canal === 'enriquecimento' && <Search size={11} strokeWidth={2.5} />}
			<span className={size === 'sm' ? 'max-w-[88px] truncate' : 'max-w-[120px] truncate'}>{canalNome[canal] ?? canal}</span>
			{dot}
			{onRemove && (
				<button type="button" onClick={e => { e.stopPropagation(); onRemove(); }} className="grid h-4 w-4 place-items-center rounded-full bg-white/25 hover:bg-white/45" aria-label="Tirar canal">
					<X size={10} strokeWidth={2.5} />
				</button>
			)}
		</span>
	);
	// Canais de persona mantêm o balão antigo (mensagem por canal da persona).
	const balao = (ehPersona && onEditMsg && msgStatus) ? (
		<button type="button" onClick={e => { e.stopPropagation(); onEditMsg(); }} title={msgLabel ?? 'Sem frase'} aria-label="Editar frase do dia"
			className={`grid h-4 w-4 shrink-0 place-items-center rounded-full transition ${msgStatus === 'desativada' ? 'bg-[#C62828] text-white' : msgStatus === 'nenhuma' ? 'border border-slate-300 text-slate-400 hover:text-[#0F4C5C]' : 'bg-[#0F4C5C] text-white hover:bg-[#0d4252]'}`}>
			<MessageCircle size={9} strokeWidth={2.5} />
		</button>
	) : null;
	const withBalao = balao ? <span className="inline-flex items-center gap-1">{chip}{balao}</span> : chip;
	if (ehPersona && personasIntel.length > 0) {
		return <PersonaCanalPopover personas={personasIntel}>{withBalao}</PersonaCanalPopover>;
	}
	return withBalao;
}

function Stepper({ label, value, min, max, onChange, disabled }: {
	label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean;
}) {
	function step(dir: number) {
		const n = Math.min(max, Math.max(min, value + dir));
		if (n !== value) onChange(n);
	}
	return (
		<div className="flex items-center gap-3">
			<span className="text-xs font-medium text-slate-600">{label}</span>
			<div className="flex items-center gap-1">
				<button type="button" onClick={() => step(-1)} disabled={disabled || value <= min} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40" aria-label="Diminuir">−</button>
				<span className="w-7 text-center text-sm font-bold text-[#0F4C5C]">{value}</span>
				<button type="button" onClick={() => step(1)} disabled={disabled || value >= max} className="grid h-8 w-8 place-items-center rounded-lg border border-[#c9dadd] text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-40" aria-label="Aumentar">+</button>
			</div>
		</div>
	);
}

type DragPayload =
	| { kind: 'canal'; canal: string }
	| { kind: 'persona'; pid: string }
	| { kind: 'move'; track: Track; day: number; lane: string; index: number };

function readPayload(e: React.DragEvent): DragPayload | null {
	const raw = e.dataTransfer.getData('text/plain');
	if (!raw) return null;
	try { return JSON.parse(raw) as DragPayload; } catch { return null; }
}

/** Célula da raia do público geral num dia. */
function CelulaPublico({ day, acoes, canEdit, onDropPayload, onTap, onRemove, onCycle, onClear, onChipDrag, highlightCanal, onDragOverCell, frasesPorId, onEditMensagem, onOpenQuadro }: {
	day: number; acoes: Acao[]; canEdit: boolean;
	onDropPayload: (e: React.DragEvent) => void; onTap: () => void;
	onRemove: (i: number) => void; onCycle: (i: number) => void; onClear: () => void; onChipDrag: (e: React.DragEvent, i: number) => void;
	highlightCanal?: string | null; onDragOverCell?: () => void;
	frasesPorId: Map<string, Frase>; onEditMensagem: (index: number) => void; onOpenQuadro: () => void;
}) {
	const vazia = acoes.length === 0;
	const firstSeen = new Set<string>();
	const dupIdx = new Set<number>();
	acoes.forEach((a, i) => { if (firstSeen.has(a.canal)) dupIdx.add(i); else firstSeen.add(a.canal); });
	const hasDup = dupIdx.size > 0;
	return (
		<div
			className={`group flex w-[168px] shrink-0 cursor-pointer flex-col rounded-lg border p-2 transition hover:border-[#0F4C5C] ${vazia ? 'border-dashed border-[#bcd2d7] bg-[#fafcfc]' : 'border-[#e2eaec] bg-white'}`}
			onDragOver={e => { if (canEdit) { e.preventDefault(); onDragOverCell?.(); } }}
			onDrop={e => { if (canEdit) { e.preventDefault(); onDropPayload(e); } }}
			onClick={onTap}
		>
			<div className="mb-1.5 flex items-center justify-between">
				<span className="text-[10px] font-bold text-[#0F4C5C]">{diaLabel(day)}</span>
				<div className="flex items-center gap-1">
					<button type="button" onClick={e => { e.stopPropagation(); onOpenQuadro(); }} className="rounded text-[var(--base-texto-3)] opacity-0 transition hover:text-[#0F4C5C] focus:opacity-100 group-hover:opacity-100" aria-label="Editar célula" title="Editar"><Pencil size={11} /></button>
					{canEdit && !vazia && (
						<button type="button" onClick={e => { e.stopPropagation(); onClear(); }} className="text-slate-300 hover:text-[#C62828]" aria-label="Limpar dia" title="Limpar público geral"><RotateCcw size={11} /></button>
					)}
				</div>
			</div>
			{vazia ? (
				<p className="grid flex-1 place-items-center py-3 text-center text-[10px] text-slate-400">solte um canal aqui</p>
			) : (
				<div className="flex flex-1 flex-col gap-1.5">
					<AcoesCelula acoes={acoes} canEdit={canEdit} onCycle={onCycle} onRemove={onRemove} onChipDrag={onChipDrag} highlightCanal={highlightCanal} dupIdx={dupIdx} frasesPorId={frasesPorId} onEditMensagem={onEditMensagem} />
					{hasDup && <span className="rounded bg-[#fff3df] px-1.5 py-0.5 text-center text-[9px] font-semibold text-[#9a631b]">Canal repetido: só o 1º vale</span>}
				</div>
			)}
		</div>
	);
}

/** Célula da raia de uma persona num dia. */
function CelulaPersona({ day, persona, acoesProprias, acoesPub, canEdit, onDropPayload, onTap, onRemove, onCycle, onMenu, onChipDrag, highlightCanal, onDragOverCell, frasesPorId, onEditMensagem, onOpenQuadro }: {
	day: number; persona: PersonaUsuario; acoesProprias: Acao[]; acoesPub: Acao[]; canEdit: boolean;
	onDropPayload: (e: React.DragEvent) => void; onTap: () => void;
	onRemove: (i: number) => void; onCycle: (i: number) => void; onMenu: (acao: 'semao' | 'geral' | 'copiar' | 'copiarPub') => void; onChipDrag: (e: React.DragEvent, i: number) => void;
	highlightCanal?: string | null; onDragOverCell?: () => void;
	frasesPorId: Map<string, Frase>; onEditMensagem: (index: number) => void; onOpenQuadro: () => void;
}) {
	const temPropria = acoesProprias.length > 0;
	const semAcao = acoesProprias.some(a => a.canal === 'sem_acao');
	const ativas = acoesProprias.filter(a => a.canal !== 'sem_acao');
	const [menuOpen, setMenuOpen] = useState(false);
	const firstSeen = new Set<string>();
	const dupIdx = new Set<number>();
	ativas.forEach((a, i) => { if (firstSeen.has(a.canal)) dupIdx.add(i); else firstSeen.add(a.canal); });
	const hasDup = dupIdx.size > 0;

	return (
		<div
			className={`group relative flex w-[168px] shrink-0 cursor-pointer flex-col rounded-lg border p-2 transition hover:border-[#0F4C5C] ${temPropria ? 'bg-white' : 'border-dashed border-[#d8e3e5] bg-[#fafcfc]'}`}
			style={temPropria ? { borderColor: persona.cor } : undefined}
			onDragOver={e => { if (canEdit) { e.preventDefault(); onDragOverCell?.(); } }}
			onDrop={e => { if (canEdit) { e.preventDefault(); onDropPayload(e); } }}
			onClick={onTap}
		>
			{(canEdit || temPropria) && (
				<div className="absolute right-1 top-1 z-10 flex items-center gap-0.5">
					<button type="button" onClick={e => { e.stopPropagation(); onOpenQuadro(); }} className="grid h-5 w-5 place-items-center rounded text-[var(--base-texto-3)] opacity-0 transition hover:text-[#0F4C5C] focus:opacity-100 group-hover:opacity-100" aria-label="Editar célula" title="Editar"><Pencil size={11} /></button>
					{canEdit && temPropria && (
						<button type="button" onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }} className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-[#edf4f5] hover:text-[#0F4C5C]" aria-label="Opções da célula">
							<MoreHorizontal size={14} />
						</button>
					)}
				</div>
			)}
			{menuOpen && (
				<>
					<button className="fixed inset-0 z-20 cursor-default" onClick={e => { e.stopPropagation(); setMenuOpen(false); }} aria-hidden />
					<div onClick={e => e.stopPropagation()} className="absolute right-1 top-6 z-30 w-44 rounded-lg border border-[#d8e3e5] bg-white p-1 shadow-lg">
						<button type="button" onClick={() => { setMenuOpen(false); onMenu('semao'); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-[#edf4f5]">⦸ Sem ação neste dia</button>
						<button type="button" onClick={() => { setMenuOpen(false); onMenu('geral'); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-[#edf4f5]">Voltar a seguir o geral</button>
						<button type="button" onClick={() => { setMenuOpen(false); onMenu('copiar'); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-[#edf4f5]">Copiar para os outros dias da faixa</button>
						<button type="button" onClick={() => { setMenuOpen(false); onMenu('copiarPub'); }} className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-[#edf4f5]">Copiar do público geral</button>
					</div>
				</>
			)}
			{temPropria ? (
				ativas.length === 0 ? (
					<div className="grid flex-1 place-items-center py-3 text-center text-[10px] font-semibold text-slate-400">⦸ sem ação neste dia</div>
				) : (
					<div className="flex flex-1 flex-col gap-1.5 pt-4">
						<AcoesCelula acoes={ativas} canEdit={canEdit} onCycle={onCycle} onRemove={onRemove} onChipDrag={onChipDrag} highlightCanal={highlightCanal} dupIdx={dupIdx} frasesPorId={frasesPorId} onEditMensagem={onEditMensagem} />
						{hasDup && <span className="rounded bg-[#fff3df] px-1.5 py-0.5 text-center text-[9px] font-semibold text-[#9a631b]">Canal repetido: só o 1º vale</span>}
					</div>
				)
			) : (
				<div className="flex flex-1 flex-col items-center gap-1 py-2 opacity-60">
					{acoesPub.length > 0 ? (
						<>
							{acoesPub.map((a, i) => <span key={i} className="max-w-[100px] truncate text-[9px] text-slate-400">{canalNome[a.canal] ?? a.canal}</span>)}
							<span className="text-[9px] italic text-slate-400">segue o geral</span>
						</>
					) : (
						<span className="text-[9px] italic text-slate-400">segue o geral</span>
					)}
					{canEdit && <span className="text-[9px] font-semibold text-[#0F4C5C]">+ raia</span>}
				</div>
			)}
		</div>
	);
}

function ColunaFinal({ label }: { label: string }) {
	return (
		<div className="flex w-[150px] shrink-0 flex-col items-center justify-center rounded-lg border border-[#f0d49a] bg-[#fff7e8] p-3 text-center">
			<span className="text-[11px] font-semibold leading-snug text-[#80520f]">{label}</span>
		</div>
	);
}

/** Coluna de dia fora da janela da quebra — cinza com aviso. */
function CelulaDesativada({ aviso }: { aviso: string }) {
	return (
		<div className="flex w-[168px] shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-[#e2c9a0] bg-[#faf3e8] p-2 text-center">
			<span className="text-[9px] font-semibold leading-tight text-[#9a631b]">{aviso}</span>
		</div>
	);
}

/** Controle "+ dia" com input livre do número do dia. */
function AddDiaButton({ prefixo, max, onAdd, disabled }: { prefixo: string; max: number; onAdd: (n: number) => void; disabled?: boolean }) {
	const [val, setVal] = useState('');
	function add() {
		const n = Number(val);
		if (val === '' || Number.isNaN(n) || n < 1 || n > max) return;
		onAdd(n);
		setVal('');
	}
	return (
		<div className="flex items-center gap-2">
			<span className="text-xs font-semibold text-slate-400">{prefixo}</span>
			<input type="number" min={1} max={max} value={val} disabled={disabled} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="nº" className="h-9 w-20 rounded border border-[#d8e3e5] px-2 text-xs outline-none focus:border-[#0F4C5C] disabled:opacity-50" />
			<button type="button" onClick={add} disabled={disabled} className="flex items-center gap-1.5 rounded-lg border border-[#0F4C5C] px-3 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3] disabled:opacity-40"><Plus size={14} /> dia</button>
		</div>
	);
}

/** Grade de uma faixa com raias (público geral + personas). */
function GradeFaixa({ track, dias, finalLabel, def, setDef, canEdit, selectedCanal, selectedPersona, personas, contagens, expanded, setExpanded, setDragOverCell, onRemoveDay, disabledDays, disabledLabel, frasesPorId, onEditMensagem }: {
	track: Track; dias: number[]; finalLabel?: string;
	def: Definicao; setDef: (d: Definicao) => void; canEdit: boolean;
	selectedCanal: string | null; selectedPersona: string | null;
	personas: PersonaUsuario[]; contagens: Record<string, number>;
	expanded: Set<string>; setExpanded: (s: Set<string>) => void;
	setDragOverCell: React.Dispatch<React.SetStateAction<{ track: Track; day: number; lane: string } | null>>;
	onRemoveDay?: (day: number) => void;
	disabledDays?: Set<number>; disabledLabel?: string;
	frasesPorId: Map<string, Frase>;
	onEditMensagem: (day: number, lane: string, index: number) => void;
}) {
	const personaOrder = personas.map(p => p.id);
	const [dupHighlight, setDupHighlight] = useState<{ day: number; lane: string; canal: string } | null>(null);
	const [quadro, setQuadro] = useState<{ day: number; lane: string } | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	function rejectDup(day: number, canal: string, lane: string) {
		setDupHighlight({ day, lane, canal });
		window.setTimeout(() => setDupHighlight(null), 1000);
		toast(`${canalNome[canal]} já está no ${diaLabel(day)} desta raia`);
	}
	const personaNome = (id: string) => personas.find(p => p.id === id)?.nome ?? id;
	const passos = useMemo(() => normPassos(getTrackObj(def, track)?.passos), [def, track]);

	function getPassos(): Passos { return normPassos(getTrackObj(def, track)?.passos); }
	function setPassos(p: Passos) { setDef(applyTrack(def, track, p)); }

	// personas com raia nesta faixa (ações em algum dia) OU expandidas
	const lanePersonas = personas.filter(p => {
		const hasActs = Object.values(passos).some(arr => arr.some(a => a.personas?.includes(p.id)));
		return hasActs || expanded.has(`${track}:${p.id}`);
	});

	function addCanal(day: number, canal: string, lane: string) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		const laneActs = lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane);
		if (laneActs.some(a => a.canal === canal)) { rejectDup(day, canal, lane); return; }
		const novo: Acao = (laneActs.length === 0 || canal === 'enriquecimento') ? { canal, modo: 'sempre' } : { canal, modo: 'senao' };
		if (lane !== 'pub') novo.personas = [lane];
		setPassos({ ...ps, [key]: rebuildDay(arr, lane, [...laneActs, novo], personaOrder) });
	}
	function criarRaiaPersona(day: number, pid: string) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		if (acoesPersona(arr, pid).length > 0) { toast(`${personaNome(pid)} já tem raia no ${diaLabel(day)}`); return; }
		const pub = acoesPublico(arr);
		const novas = pub.map(a => ({ ...a, personas: [pid] }));
		setPassos({ ...ps, [key]: rebuildDay(arr, pid, novas, personaOrder) });
	}
	function removeCanal(day: number, lane: string, index: number) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		const laneActs = (lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane)).filter((_, i) => i !== index);
		const fixed = laneActs.map((a, i) => i === 0 && a.modo !== 'sempre' ? { ...a, modo: 'sempre' as const } : a);
		setPassos({ ...ps, [key]: rebuildDay(arr, lane, fixed, personaOrder) });
	}
	function cycleModo(day: number, lane: string, index: number) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		const laneActs = (lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane)).map((a, i) => {
			if (i !== index) return a;
			const cur = MODO_ORDEM.indexOf((a.modo ?? 'senao') as typeof MODO_ORDEM[number]);
			return { ...a, modo: MODO_ORDEM[(cur + 1) % MODO_ORDEM.length] };
		});
		setPassos({ ...ps, [key]: rebuildDay(arr, lane, laneActs, personaOrder) });
	}
	function clearLane(day: number, lane: string) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		setPassos({ ...ps, [key]: rebuildDay(arr, lane, [], personaOrder) });
	}
	function semAcao(day: number, pid: string) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		setPassos({ ...ps, [key]: rebuildDay(arr, pid, [{ canal: 'sem_acao', modo: 'sempre', personas: [pid] }], personaOrder) });
	}
	function copiarParaOutrosDias(day: number, pid: string) {
		const ps = getPassos();
		const src = acoesPersona(ps[String(day)] ?? [], pid).map(a => ({ ...a }));
		const np: Passos = { ...ps };
		for (const d of dias) {
			if (d === day) continue;
			const arr = splitMultiPersona(np[String(d)] ?? []);
			np[String(d)] = rebuildDay(arr, pid, src.map(a => ({ ...a })), personaOrder);
		}
		setPassos(np);
	}
	function copiarDoPublico(day: number, pid: string) {
		const ps = getPassos();
		const key = String(day);
		const arr = splitMultiPersona(ps[key] ?? []);
		const novas = acoesPublico(arr).map(a => ({ ...a, personas: [pid] }));
		setPassos({ ...ps, [key]: rebuildDay(arr, pid, novas, personaOrder) });
	}
	function moverCanal(payload: Extract<DragPayload, { kind: 'move' }>, targetDay: number, targetLane: string, copy: boolean) {
		if (payload.track === track && payload.day === targetDay && payload.lane === targetLane) return;
		const srcPs = normPassos(getTrackObj(def, payload.track)?.passos);
		const srcKey = String(payload.day);
		const srcArr = splitMultiPersona(srcPs[srcKey] ?? []);
		const srcLaneActs = payload.lane === 'pub' ? acoesPublico(srcArr) : acoesPersona(srcArr, payload.lane);
		const action = srcLaneActs[payload.index];
		if (!action) return;
		let newSrcPs = srcPs;
		if (!copy) {
			const newSrcLane = srcLaneActs.filter((_, i) => i !== payload.index).map((a, i) => i === 0 && a.modo !== 'sempre' ? { ...a, modo: 'sempre' as const } : a);
			newSrcPs = { ...srcPs, [srcKey]: rebuildDay(srcArr, payload.lane, newSrcLane, personaOrder) };
		}
		const tgtPs = payload.track === track ? newSrcPs : normPassos(getTrackObj(def, track)?.passos);
		const tgtKey = String(targetDay);
		const tgtArr = splitMultiPersona(tgtPs[tgtKey] ?? []);
		const tgtLaneActs = targetLane === 'pub' ? acoesPublico(tgtArr) : acoesPersona(tgtArr, targetLane);
		if (tgtLaneActs.some(a => a.canal === action.canal)) { rejectDup(targetDay, action.canal, targetLane); return; }
		const novoAction: Acao = { ...action };
		if (targetLane === 'pub') delete novoAction.personas; else novoAction.personas = [targetLane];
		if (tgtLaneActs.length === 0) novoAction.modo = 'sempre'; else if (novoAction.modo === 'sempre') novoAction.modo = 'senao';
		const newTgtPs = { ...tgtPs, [tgtKey]: rebuildDay(tgtArr, targetLane, [...tgtLaneActs, novoAction], personaOrder) };
		let nd = applyTrack(def, payload.track, newSrcPs);
		nd = applyTrack(nd, track, newTgtPs);
		setDef(nd);
	}
	function onCellDrop(e: React.DragEvent, day: number, lane: string) {
		const p = readPayload(e);
		if (!p) return;
		if (p.kind === 'persona') criarRaiaPersona(day, p.pid);
		else if (p.kind === 'canal') addCanal(day, p.canal, lane);
		else if (p.kind === 'move') moverCanal(p, day, lane, e.altKey);
	}
	function onCellTap(day: number, lane: string) {
		if (selectedCanal) { addCanal(day, selectedCanal, lane); return; }
		if (selectedPersona) { criarRaiaPersona(day, selectedPersona); return; }
		setQuadro({ day, lane });
	}
	function onChipDrag(e: React.DragEvent, day: number, lane: string, index: number) {
		e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'move', track, day, lane, index } as DragPayload));
		e.dataTransfer.effectAllowed = 'copyMove';
	}
	function removerPersonaFaixa(pid: string) {
		if (!window.confirm(`Tirar ${personaNome(pid)} de todos os dias desta faixa? Ela volta a seguir o público geral.`)) return;
		const ps = getPassos();
		const np: Passos = {};
		for (const [k, arr] of Object.entries(ps)) {
			const filtered = splitMultiPersona(arr).filter(a => !a.personas?.includes(pid));
			if (filtered.length) np[k] = filtered;
		}
		setPassos(np);
		const ne = new Set(expanded); ne.delete(`${track}:${pid}`); setExpanded(ne);
	}
	function expandPersona(pid: string) {
		const ne = new Set(expanded); ne.add(`${track}:${pid}`); setExpanded(ne);
	}
	function onLabelDrop(e: React.DragEvent) {
		const p = readPayload(e);
		if (p?.kind === 'persona') expandPersona(p.pid);
	}

	const geralVazio = faixaGeralVazia(passos);
	const temPersona = faixaTemPersona(passos);

	return (
		<div>
			{quadro && (
				<QuadroCelula track={track} day={quadro.day} lane={quadro.lane} def={def} setDef={setDef} canEdit={canEdit} personas={personas} frasesPorId={frasesPorId} onEditMensagem={onEditMensagem} onClose={() => setQuadro(null)} />
			)}
			{geralVazio && temPersona && (
				<div className="mb-3 rounded-lg border border-[#f0d49a] bg-[#fff7e8] px-4 py-2.5 text-xs font-medium text-[#9a631b]">Só personas nesta faixa: quem não tem persona não recebe nada.</div>
			)}
			<div className="flex items-stretch gap-1">
				<button type="button" onClick={() => scrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })} className="grid h-8 w-6 shrink-0 place-items-center self-center rounded-lg border border-[#d8e3e5] bg-white text-[#0F4C5C] hover:bg-[#edf4f5]" aria-label="Dias anteriores">‹</button>
				<div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto pb-2">
				<div className="inline-flex flex-col gap-2 min-w-max">
					{/* cabeçalho de dias */}
					<div className="flex gap-2">
						<div className="w-[150px] shrink-0 sticky left-0 z-20 bg-white" />
						{dias.map(d => (
							<div key={d} data-scroll-target={`${track}:${d}`} className="flex w-[168px] shrink-0 items-center justify-center gap-1">
								<span className="text-[11px] font-bold text-[#0F4C5C]">{diaLabel(d)}</span>
								{onRemoveDay && canEdit && <button type="button" onClick={() => onRemoveDay(d)} className="text-slate-300 hover:text-[#C62828]" aria-label={`Remover ${diaLabel(d)}`}><X size={11} /></button>}
							</div>
						))}
						{finalLabel && <div className="w-[150px] shrink-0" />}
					</div>
					{/* raia público geral */}
					<div className="flex gap-2 items-stretch">
						<div
							className="flex w-[150px] shrink-0 sticky left-0 z-20 items-center gap-2 rounded-lg border border-[#0F4C5C] bg-[#eaf2f3] px-3 py-2"
							onDragOver={e => { if (canEdit) e.preventDefault(); }}
							onDrop={e => { if (canEdit) { e.preventDefault(); onLabelDrop(e); } }}
						>
							<Users size={15} className="text-[#0F4C5C]" />
							<span className="text-xs font-bold text-[#0F4C5C]">Público geral</span>
						</div>
						{dias.map(d => {
							if (disabledDays?.has(d)) return <CelulaDesativada key={d} aviso={disabledLabel ?? ''} />;
							const acts = acoesPublico(passos[String(d)] ?? []);
							return (
								<CelulaPublico
									key={d}
									day={d}
									acoes={acts}
									canEdit={canEdit}
									onDropPayload={e => onCellDrop(e, d, 'pub')}
									onTap={() => onCellTap(d, 'pub')}
									onRemove={i => removeCanal(d, 'pub', i)}
									onCycle={i => cycleModo(d, 'pub', i)}
									onClear={() => clearLane(d, 'pub')}
									onChipDrag={(e, i) => onChipDrag(e, d, 'pub', i)}
									highlightCanal={dupHighlight && dupHighlight.day === d && dupHighlight.lane === 'pub' ? dupHighlight.canal : null}
									onDragOverCell={() => setDragOverCell(prev => prev?.track === track && prev?.day === d && prev?.lane === 'pub' ? prev : { track, day: d, lane: 'pub' })}
									frasesPorId={frasesPorId}
									onEditMensagem={i => onEditMensagem(d, 'pub', i)}
									onOpenQuadro={() => setQuadro({ day: d, lane: 'pub' })}
								/>
							);
						})}
						{finalLabel && <ColunaFinal label={finalLabel} />}
					</div>
					{/* raias de personas */}
					{lanePersonas.map(p => (
						<div key={p.id} className="flex gap-2 items-stretch">
							<div className="flex w-[150px] shrink-0 sticky left-0 z-20 items-center gap-1.5 rounded-lg border bg-white px-3 py-2" style={{ borderColor: p.cor }}>
								<span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} />
								<div className="min-w-0 flex-1">
									<div className="truncate text-xs font-semibold text-[#163943]">{p.nome}</div>
									<div className="text-[9px] text-slate-400">{numberBR(contagens[p.nome] ?? 0)} clientes</div>
								</div>
								{canEdit && (
									<button type="button" onClick={() => removerPersonaFaixa(p.id)} className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:bg-white hover:text-[#C62828]" aria-label={`Tirar ${p.nome} da faixa`}><X size={13} /></button>
								)}
							</div>
							{dias.map(d => {
								if (disabledDays?.has(d)) return <CelulaDesativada key={d} aviso={disabledLabel ?? ''} />;
								const arr = passos[String(d)] ?? [];
								const proprias = acoesPersona(arr, p.id);
								const pub = acoesPublico(arr);
								return (
									<CelulaPersona
										key={d}
										day={d}
										persona={p}
										acoesProprias={proprias}
										acoesPub={pub}
										canEdit={canEdit}
										onDropPayload={e => onCellDrop(e, d, p.id)}
										onTap={() => onCellTap(d, p.id)}
										onRemove={i => removeCanal(d, p.id, i)}
										onCycle={i => cycleModo(d, p.id, i)}
										onMenu={acao => {
											if (acao === 'semao') semAcao(d, p.id);
											else if (acao === 'geral') clearLane(d, p.id);
											else if (acao === 'copiar') copiarParaOutrosDias(d, p.id);
											else if (acao === 'copiarPub') copiarDoPublico(d, p.id);
										}}
										onChipDrag={(e, i) => onChipDrag(e, d, p.id, i)}
										highlightCanal={dupHighlight && dupHighlight.day === d && dupHighlight.lane === p.id ? dupHighlight.canal : null}
										onDragOverCell={() => setDragOverCell(prev => prev?.track === track && prev?.day === d && prev?.lane === p.id ? prev : { track, day: d, lane: p.id })}
									frasesPorId={frasesPorId}
									onEditMensagem={i => onEditMensagem(d, p.id, i)}
									onOpenQuadro={() => setQuadro({ day: d, lane: p.id })}
									/>
								);
							})}
							{finalLabel && <div className="w-[150px] shrink-0" />}
						</div>
					))}
				</div>
				</div>
				<button type="button" onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })} className="grid h-8 w-6 shrink-0 place-items-center self-center rounded-lg border border-[#d8e3e5] bg-white text-[#0F4C5C] hover:bg-[#edf4f5]" aria-label="Próximos dias">›</button>
			</div>
		</div>
	);
}

const FAIXA_NOME: Record<Track, string> = { localizacao: 'Cliente novo', giro: 'Não CPC', preventivo: 'Preventivo', quebra: 'Quebra' };

/** Quadro de edição de uma célula (item 2). Popover em portal; folha de baixo no celular. */
function QuadroCelula({ track, day, lane, def, setDef, canEdit, personas, frasesPorId, onEditMensagem, onClose }: {
	track: Track; day: number; lane: string; def: Definicao; setDef: (d: Definicao) => void; canEdit: boolean; personas: PersonaUsuario[]; frasesPorId: Map<string, Frase>; onEditMensagem: (day: number, lane: string, index: number) => void; onClose: () => void;
}) {
	const personaOrder = personas.map(p => p.id);
	const isPersona = lane !== 'pub';
	const persona = isPersona ? personas.find(p => p.id === lane) ?? null : null;
	const passos = normPassos(getTrackObj(def, track)?.passos);
	const arr = splitMultiPersona(passos[String(day)] ?? []);
	const laneActs = (isPersona ? acoesPersona(arr, lane) : acoesPublico(arr)).filter(a => a.canal !== 'sem_acao');
	const primeiroCanal = laneActs[0]?.canal;
	useEffect(() => {
		function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
		window.addEventListener('keydown', onEsc);
		return () => window.removeEventListener('keydown', onEsc);
	}, [onClose]);

	function commit(newActs: Acao[]) {
		const key = String(day);
		const ps = normPassos(getTrackObj(def, track)?.passos);
		const a = splitMultiPersona(ps[key] ?? []);
		setDef(applyTrack(def, track, { ...ps, [key]: rebuildDay(a, lane, newActs, personaOrder) }));
	}
	function setPrimeiro(canal: string) {
		if (!canEdit) return;
		if (canal === 'sem_acao') { if (isPersona) commit([{ canal: 'sem_acao', modo: 'sempre', personas: [lane] }]); else commit([]); return; }
		const resto = laneActs.slice(1).filter(a => a.canal !== canal);
		const novo: Acao = { canal, modo: 'sempre', ...(isPersona ? { personas: [lane] } : {}) };
		commit([novo, ...resto]);
	}
	function updateCanal(i: number, acao: Acao) { if (canEdit) commit(laneActs.map((a, idx) => idx === i ? acao : a)); }
	function removeCanal(i: number) { if (!canEdit) return; const next = laneActs.filter((_, idx) => idx !== i).map((a, idx) => idx === 0 && a.modo !== 'sempre' && a.canal !== 'enriquecimento' ? { ...a, modo: 'sempre' as const } : a); commit(next); }
	function moveCanal(i: number, dir: -1 | 1) { if (!canEdit) return; const j = i + dir; if (j < 0 || j >= laneActs.length) return; const next = [...laneActs]; [next[i], next[j]] = [next[j], next[i]]; commit(next); }
	function addCanal() { if (!canEdit) return; const base: Acao = { canal: 'whatsapp', modo: 'senao', ...(isPersona ? { personas: [lane] } : {}) }; commit([...laneActs, base]); }
	function semAcao() { if (!canEdit || !isPersona) return; commit([{ canal: 'sem_acao', modo: 'sempre', personas: [lane] }]); }
	function voltarGeral() { if (!canEdit || !isPersona) return; commit([]); }
	function copiarParaOutrosDias() {
		if (!canEdit || !isPersona) return;
		const src = laneActs.map(a => ({ ...a }));
		const ps = normPassos(getTrackObj(def, track)?.passos);
		const np = { ...ps };
		for (const d of Object.keys(ps)) { if (Number(d) === day) continue; const a = splitMultiPersona(ps[d] ?? []); np[d] = rebuildDay(a, lane, src.map(x => ({ ...x })), personaOrder); }
		setDef(applyTrack(def, track, np)); onClose();
	}
	function copiarDoPublico() { if (!canEdit || !isPersona) return; const pub = acoesPublico(arr).map(a => ({ ...a, personas: [lane] })); commit(pub); }

	const canaisPills = isPersona ? [...CANAIS, ENRIQ, ...PERSONA_CANAIS] : [...CANAIS, ENRIQ];
	const titulo = `${FAIXA_NOME[track]} · ${isPersona ? persona?.nome ?? lane : 'Público geral'} · ${diaLabel(day)}`;
	const paraQuem = isPersona ? `Vale só para clientes da persona ${persona?.nome ?? lane} neste dia.` : 'Vale para todos os clientes deste segmento neste dia.';
	const temMsg0 = laneActs.length > 0 && canalTipoMensagem(laneActs[0].canal) !== 'nenhuma';

	return (
		<div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" onClick={onClose}>
			<div role="dialog" aria-modal="true" className="max-h-[100dvh] w-full overflow-auto rounded-t-2xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-5 shadow-xl sm:max-h-[90vh] sm:w-[340px] sm:rounded-xl" onClick={e => e.stopPropagation()}>
				<div className="mb-1 flex items-start justify-between gap-2">
					<div className="min-w-0">
						<h3 className="text-sm font-bold text-[#163943]">{titulo}</h3>
						<p className="mt-0.5 text-[11px] text-[var(--base-texto-2)]">{paraQuem}</p>
					</div>
					<button type="button" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--base-texto-3)] hover:bg-[var(--base-fill)]"><X size={16} /></button>
				</div>

				{!canEdit ? (
					<div className="mt-3"><AcoesCelula acoes={laneActs} canEdit={false} onCycle={() => {}} onRemove={() => {}} onChipDrag={() => {}} dupIdx={new Set()} frasesPorId={frasesPorId} onEditMensagem={i => onEditMensagem(day, lane, i)} /></div>
				) : (
					<>
						<div className="mt-4">
							<div className="mb-2 flex items-center justify-between">
								<p className="text-[11px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Primeiro canal</p>
								{temMsg0 && <button type="button" onClick={() => onEditMensagem(day, lane, 0)} className="flex h-7 items-center gap-1 rounded-lg border border-[#c9dadd] px-2 text-[11px] font-semibold text-[#0F4C5C] hover:bg-[#edf4f5]"><MessageCircle size={12} /> Frase</button>}
							</div>
							<div role="radiogroup" className="flex flex-wrap gap-1.5">
								{canaisPills.map(c => {
									const sel = primeiroCanal === c.id;
									return (
										<button key={c.id} type="button" role="radio" aria-checked={sel} onClick={() => setPrimeiro(c.id)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${sel ? 'text-white' : 'border border-[var(--base-borda)] text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]'}`} style={sel ? { backgroundColor: canalCor[c.id] ?? '#475569' } : undefined}>
											<span className="h-2 w-2 rounded-full" style={{ backgroundColor: sel ? '#fff' : canalCor[c.id] ?? '#475569' }} />
											{c.label}
										</button>
									);
								})}
								<button type="button" role="radio" aria-checked={!laneActs.length} onClick={() => setPrimeiro('sem_acao')} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${!laneActs.length ? 'bg-[var(--base-texto)] text-[var(--base-cartao)]' : 'border border-[var(--base-borda)] text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]'}`}>Sem ação</button>
							</div>
						</div>

						{laneActs.length > 1 && (
							<div className="mt-4">
								<p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Depois</p>
								<div className="space-y-2">
									{laneActs.slice(1).map((a, idx) => {
										const realIdx = idx + 1;
										return (
											<AcaoCard key={realIdx} acao={a} index={realIdx} total={laneActs.length} comModo hideSempre
												onChange={acao => updateCanal(realIdx, acao)} onMove={d => moveCanal(realIdx, d)} onRemove={() => removeCanal(realIdx)}
												onEditFrase={() => onEditMensagem(day, lane, realIdx)} />
										);
									})}
								</div>
							</div>
						)}

						<div className="mt-3">
							<button type="button" onClick={addCanal} className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#0F4C5C] px-3 py-2 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]"><Plus size={14} /> adicionar canal</button>
						</div>

						<div className="mt-4 space-y-1 border-t border-[var(--base-borda)] pt-3">
							<button type="button" onClick={isPersona ? semAcao : () => commit([])} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">⦸ Sem ação neste dia</button>
							{isPersona && <button type="button" onClick={copiarParaOutrosDias} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Copiar para os outros dias da faixa</button>}
							{isPersona && <button type="button" onClick={copiarDoPublico} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Copiar do público geral</button>}
							{isPersona && <button type="button" onClick={voltarGeral} className="block w-full rounded px-2 py-1.5 text-left text-xs text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Voltar a seguir o geral</button>}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

/** Dias com canal de uma faixa, em uma linha: "D+1 WhatsApp › SMS · D+3 RCS". */
function diasResumo(passos: Passos, prefixo: string): string {
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	const parts: string[] = [];
	for (const d of dias) {
		const ativas = acoesPublico(passos[String(d)] ?? []).filter(a => a.canal !== 'sem_acao');
		if (!ativas.length) continue;
		parts.push(`${prefixo}${d} ${ativas.map(a => canalNome[a.canal] ?? a.canal).join(' › ')}`);
	}
	return parts.join(' · ');
}
function personasComRaia(passos: Passos): number {
	const pids = new Set<string>();
	for (const arr of Object.values(passos)) for (const a of arr) a.personas?.forEach(p => pids.add(p));
	return pids.size;
}
function hasDupInLane(arr: Acao[]): boolean {
	const seen = new Set<string>();
	for (const a of arr) { if (seen.has(a.canal)) return true; seen.add(a.canal); }
	return false;
}
function passosHasDup(passos: Passos): boolean {
	for (const arr of Object.values(passos)) {
		const lane = splitMultiPersona(arr);
		if (hasDupInLane(acoesPublico(lane))) return true;
		const pids = new Set<string>();
		lane.forEach(a => a.personas?.forEach(p => pids.add(p)));
		for (const pid of pids) if (hasDupInLane(acoesPersona(lane, pid))) return true;
	}
	return false;
}

const FAIXA_KEYS = ['localizacao', 'cpc', 'giro', 'acordo', 'prioridade'] as const;
const FAIXA_STORAGE = 'motorcob.esteira.faixas';

/** Faixa recolhível — mesmo padrão dos blocos "Clientes em acordo" e "Prioridade dos telefones". */
function FaixaColapsivel({ titulo, resumo, warning, open, onToggle, ativo, onToggleAtivo, canEdit, desligadoMsg, dataFaixa, children }: {
	titulo: React.ReactNode; resumo?: string; warning?: boolean; open: boolean; onToggle: () => void;
	ativo?: boolean; onToggleAtivo?: () => void; canEdit?: boolean; desligadoMsg?: string; dataFaixa?: string; children: React.ReactNode;
}) {
	const desligado = ativo === false;
	const timerRef = useRef<number | null>(null);
	function clearTimer() { if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; } }
	function handleDragOver(e: React.DragEvent) {
		if (open || desligado) return;
		e.preventDefault();
		if (timerRef.current === null) timerRef.current = window.setTimeout(() => { clearTimer(); onToggle(); }, 600);
	}
	return (
		<div data-faixa={dataFaixa} className={`rounded-xl border ${desligado ? 'border-[#e2c9a0] bg-[#faf3e8]' : 'border-[#dfe8ea] bg-white'}`}>
			<div className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left" role="button" tabIndex={0} aria-expanded={open && !desligado} onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }} onDragOver={handleDragOver} onDragLeave={clearTimer} onDrop={clearTimer} onDragEnd={clearTimer}>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						{warning && <span className="h-2 w-2 shrink-0 rounded-full bg-[#e9a23b]" />}
						<span className={`text-sm font-bold ${desligado ? 'text-[#9a631b]' : 'text-[#163943]'}`}>{titulo}</span>
					</div>
					{resumo && <p className="mt-0.5 truncate text-[11px] text-slate-500">{resumo}</p>}
				</div>
				<div className="flex shrink-0 items-center gap-3">
					{onToggleAtivo && canEdit && (
						<label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#163943]" onClick={e => e.stopPropagation()}>
							{desligado ? 'Desligado' : 'Ligado'}
							<button type="button" role="switch" aria-checked={!desligado} onClick={e => { e.stopPropagation(); onToggleAtivo(); }} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${desligado ? 'bg-slate-300' : 'bg-[#2E7D32]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${desligado ? 'left-0.5' : 'left-[18px]'}`} /></button>
						</label>
					)}
					<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: open && !desligado ? 'rotate(180deg)' : 'none' }} />
				</div>
			</div>
			{desligado && desligadoMsg ? (
				<div className="border-t border-[#ecf0f1] p-5">
					<p className="rounded-lg bg-[#fff7e8] px-4 py-3 text-xs leading-relaxed text-[#9a631b]">{desligadoMsg}</p>
				</div>
			) : open && <div className="border-t border-[#ecf0f1] p-5">{children}</div>}
		</div>
	);
}

export function DesenhoDaEsteira({ def, setDef, canEdit, onSalvar, saving, personas, contagens, estrId, dirty, stickyTop = 0, forma = 'raias', onFormaChange, focusFaixa }: {
	def: Definicao;
	setDef: (d: Definicao) => void;
	canEdit: boolean;
	onSalvar: () => void;
	saving: boolean;
	personas: PersonaUsuario[];
	contagens: Record<string, number>;
	estrId?: string | null;
	dirty?: boolean;
	stickyTop?: number;
	forma?: 'raias' | 'fluxo';
	onFormaChange?: (f: 'raias' | 'fluxo') => void;
	focusFaixa?: string | null;
}) {
	const [selectedCanal, setSelectedCanal] = useState<string | null>(null);
	const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
	const [openFaixas, setOpenFaixas] = useState<Set<string>>(() => {
		if (typeof window === 'undefined') return new Set(['localizacao']);
		try { const raw = localStorage.getItem(FAIXA_STORAGE); if (raw) return new Set(JSON.parse(raw) as string[]); } catch { /* noop */ }
		return new Set(['localizacao']);
	});
	useEffect(() => {
		if (!focusFaixa) return;
		setOpenFaixas(prev => { const n = new Set(prev); n.add(focusFaixa); return n; });
		const t = window.setTimeout(() => document.querySelector(`[data-faixa="${focusFaixa}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
		return () => window.clearTimeout(t);
	}, [focusFaixa]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [dragOverCell, setDragOverCell] = useState<{ track: Track; day: number; lane: string } | null>(null);
	const personaNome = (id: string) => personas.find(p => p.id === id)?.nome ?? id;
	const { empresa, credor } = useMotorAuth();
	const [personasIntel, setPersonasIntel] = useState<PersonaResumo[]>([]);
	useEffect(() => {
		if (!supabase || !empresa || !credor) { setPersonasIntel([]); return; }
		let active = true;
		(async () => {
			const { data } = await supabase.from('personas').select('nome,clientes,ranking,maturidade').eq('empresa_id', empresa.id).eq('credor_id', credor.id);
			if (!active) return;
			setPersonasIntel(((data ?? []) as unknown as Persona[]).map(resumoDePersona));
		})();
		return () => { active = false; };
	}, [empresa?.id, credor?.id]);
	useEffect(() => {
		const clear = () => setDragOverCell(null);
		window.addEventListener('dragend', clear);
		return () => window.removeEventListener('dragend', clear);
	}, []);
	const dragOverCanais = useMemo(() => {
		if (!dragOverCell) return new Set<string>();
		const passos = normPassos(getTrackObj(def, dragOverCell.track)?.passos);
		const arr = splitMultiPersona(passos[String(dragOverCell.day)] ?? []);
		const laneActs = dragOverCell.lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, dragOverCell.lane);
		return new Set(laneActs.map(a => a.canal));
	}, [dragOverCell, def]);

	// ---- frases do playbook (para balões 💬 e editor) ----
	const [frases, setFrases] = useState<Frase[]>([]);
	const [editingMsg, setEditingMsg] = useState<{ track: Track; day: number; lane: string; index: number } | null>(null);
	const [editingCpc, setEditingCpc] = useState<{ tipo: 'hot' | 'reserva' | 'junto'; canal?: string; index?: number } | null>(null);
	const [openFrases, setOpenFrases] = useState<Set<string>>(() => {
		if (typeof window === 'undefined') return new Set();
		try { const raw = localStorage.getItem('motorcob.esteira.frases'); if (raw) return new Set(JSON.parse(raw) as string[]); } catch { /* noop */ }
		return new Set();
	});
	useEffect(() => { try { localStorage.setItem('motorcob.esteira.frases', JSON.stringify([...openFrases])); } catch { /* noop */ } }, [openFrases]);
	async function reloadFrases() {
		if (!empresa) { setFrases([]); return; }
		const { frases } = await carregarFrases(empresa.id);
		setFrases(frases);
	}
	useEffect(() => { void reloadFrases(); }, [empresa?.id]);
	const frasesPorId = useMemo(() => {
		const m = new Map<string, Frase>();
		for (const f of frases) m.set(f.id, f);
		return m;
	}, [frases]);
	const canaisEmpresaAtivos = useMemo(() => {
		const ids = new Set(frases.map(f => f.canal));
		return CANAIS.filter(c => ids.has(c.id)).map(c => c.id);
	}, [frases]);

	function toggleFrasesFaixa(key: string) { setOpenFrases(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; }); }

	// ---- handler para editar mensagem de uma ação ----
	const estagioFaixa: Record<Track, string> = { localizacao: 'localizacao', giro: 'giro', preventivo: 'preventivo', quebra: 'quebra' };
	function getAcaoEditing(): { acao: Acao; canal: string; isCpc: boolean; isPersona: boolean; titulo: string } | null {
		if (!editingMsg) return null;
		const { track, day, lane, index } = editingMsg;
		const passos = normPassos(getTrackObj(def, track)?.passos);
		const arr = splitMultiPersona(passos[String(day)] ?? []);
		const laneActs = lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane);
		const acao = laneActs[index];
		if (!acao) return null;
		const isPersona = acao.canal === 'persona_1' || acao.canal === 'persona_2';
		const titulo = `${diaLabel(day)} · ${canalNome[acao.canal] ?? acao.canal}${lane !== 'pub' ? ` · ${personaNome(lane)}` : ''}`;
		return { acao, canal: acao.canal, isCpc: false, isPersona, titulo };
	}
	function setMensagemEditing(m: MensagemAcao | null) {
		if (!editingMsg) return;
		const { track, day, lane, index } = editingMsg;
		const passos = normPassos(getTrackObj(def, track)?.passos);
		const arr = splitMultiPersona(passos[String(day)] ?? []);
		const laneActs = lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane);
		const newLaneActs = laneActs.map((a, i) => i === index ? { ...a, mensagem: m ?? undefined } : a);
		const fixed = newLaneActs.map((a, i) => i === 0 && a.modo !== 'sempre' && a.canal !== 'enriquecimento' ? { ...a, modo: 'sempre' as const } : a);
		const newPassos = { ...passos, [String(day)]: rebuildDay(arr, lane, fixed, personas.map(p => p.id)) };
		setDef(applyTrack(def, track, newPassos));
	}
	async function onSalvarNoPlaybook(texto: string, nome: string): Promise<string | null> {
		if (!empresa || !editingMsg) return null;
		const { acao } = getAcaoEditing() ?? {};
		const canal = acao?.canal ?? '';
		const { track } = editingMsg;
		const { frase, error } = await salvarFrase({ empresa_id: empresa.id, canal, nome, estagio: estagioFaixa[track], texto, origem: 'criado', ativo: true });
		if (error || !frase) { toast.error(error || 'Erro ao salvar.'); return null; }
		toast.success('Frase salva no playbook.');
		void reloadFrases();
		return frase.id;
	}
	function onEditMensagem(track: Track, day: number, lane: string, index: number) {
		setEditingMsg({ track, day, lane, index });
	}
	function clearMensagem(track: Track, day: number, lane: string, index: number) {
		const passos = normPassos(getTrackObj(def, track)?.passos);
		const arr = splitMultiPersona(passos[String(day)] ?? []);
		const laneActs = lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane);
		const newLaneActs = laneActs.map((a, i) => i === index ? { ...a, mensagem: undefined } : a);
		const newPassos = { ...passos, [String(day)]: rebuildDay(arr, lane, newLaneActs, personas.map(p => p.id)) };
		setDef(applyTrack(def, track, newPassos));
	}

	// ---- migração de mensagens antigas (por estágio) para os dias ----
	const temMensagensAntigas = !!def.mensagens && Object.keys(def.mensagens).length > 0;
	function levarMensagensParaDias() {
		setDef(migrarMensagensParaDias(def));
		toast('Frases por estágio levadas para os dias. Revise e salve.');
	}

	// --- leitura normalizada ---
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

	// --- mutações de faixa (campos escalares) ---
	function updateLocalizacao(patch: Partial<NonNullable<Definicao['localizacao']>>) {
		const cur = def.localizacao ?? { passos: {}, dias_sem_contato_para_ncp: 8 };
		setDef({ ...def, localizacao: { ...cur, ...patch } });
	}
	function updateGiro(patch: Partial<NonNullable<Definicao['giro']>>) {
		const cur = def.giro ?? { passos: {}, ciclo_dias: 8, max_ciclos: 3 };
		setDef({ ...def, giro: { ...cur, ...patch } });
	}
	function updateCpc(patch: Partial<NonNullable<Definicao['cpc']>>) {
		const cur = def.cpc ?? { ordem: [], junto: [], tentativas_por_canal: 3 };
		setDef({ ...def, cpc: { ...cur, ...patch } });
	}

	function updatePreventivo(patch: Partial<NonNullable<Definicao['preventivo']>>) {
		const cur = def.preventivo ?? { passos: {} };
		setDef({ ...def, preventivo: { ...cur, ...patch } });
	}
	function updateQuebra(patch: Partial<NonNullable<Definicao['quebra']>>) {
		const cur = def.quebra ?? { passos: {}, dias_para_estoque: 6 };
		setDef({ ...def, quebra: { ...cur, ...patch } });
	}
	function addDiaPreventivo(n: number) {
		const key = String(-n);
		const cur = def.preventivo ?? { passos: {} };
		if (normPassos(cur.passos)[key] !== undefined) { toast(`D-${n} já existe.`); return; }
		setDef({ ...def, preventivo: { ...cur, passos: { ...normPassos(cur.passos), [key]: [] } } });
	}
	function removeDiaPreventivo(day: number) {
		const arr = prevPassos[String(day)] ?? [];
		const temAcao = acoesPublico(arr).length > 0 || arr.some(a => a.personas?.length);
		if (temAcao && !window.confirm(`Remover a coluna ${diaLabel(day)}? As ações desenhadas nela serão apagadas.`)) return;
		const cur = def.preventivo ?? { passos: {} };
		const np = { ...normPassos(cur.passos) };
		delete np[String(day)];
		setDef({ ...def, preventivo: { ...cur, passos: np } });
	}
	function addDiaQuebra(n: number) {
		const key = String(n);
		const cur = def.quebra ?? { passos: {}, dias_para_estoque: 6 };
		if (normPassos(cur.passos)[key] !== undefined) { toast(`D+${n} já existe.`); return; }
		setDef({ ...def, quebra: { ...cur, passos: { ...normPassos(cur.passos), [key]: [] } } });
	}
	function removeDiaQuebra(day: number) {
		const arr = quebraPassos[String(day)] ?? [];
		const temAcao = acoesPublico(arr).length > 0 || arr.some(a => a.personas?.length);
		if (temAcao && !window.confirm(`Remover a coluna D+${day}? As ações desenhadas nela serão apagadas.`)) return;
		const cur = def.quebra ?? { passos: {}, dias_para_estoque: 6 };
		const np = { ...normPassos(cur.passos) };
		delete np[String(day)];
		setDef({ ...def, quebra: { ...cur, passos: np } });
	}

	// --- CPC ---
	function addCpcReserva(canal: string) {
		if (cpcOrdem.some(a => a.canal === canal)) { toast(`${canalNome[canal]} já está na fila de reserva`); return; }
		updateCpc({ ordem: [...cpcOrdem, { canal }] });
	}
	function removeCpcReserva(i: number) {
		updateCpc({ ordem: cpcOrdem.filter((_, idx) => idx !== i) });
	}
	function moveCpcReserva(i: number, dir: number) {
		const j = i + dir;
		if (j < 0 || j >= cpcOrdem.length) return;
		const next = [...cpcOrdem];
		[next[i], next[j]] = [next[j], next[i]];
		updateCpc({ ordem: next });
	}
	const cpcJunto = (def.cpc?.junto ?? []).filter(a => a.canal);
	function addCpcJunto(canal: string) {
		if (cpcJunto.some(a => a.canal === canal)) { toast(`${canalNome[canal]} já está no reforço junto`); return; }
		updateCpc({ junto: [...cpcJunto, { canal }] });
	}
	function removeCpcJunto(i: number) {
		updateCpc({ junto: cpcJunto.filter((_, idx) => idx !== i) });
	}
	// --- frases do Deu CPC (mensagem_hot + mensagem de reserva/junto) ---
	function setCpcHot(canal: string, m: MensagemAcao | null) {
		const cur = def.cpc?.mensagem_hot ?? {};
		const next = { ...cur };
		if (m == null) delete next[canal]; else next[canal] = m;
		updateCpc({ mensagem_hot: Object.keys(next).length ? next : undefined });
	}
	function setCpcReservaMensagem(i: number, m: MensagemAcao | null) {
		updateCpc({ ordem: cpcOrdem.map((a, idx) => idx === i ? { ...a, mensagem: m ?? undefined } : a) });
	}
	function setCpcJuntoMensagem(i: number, m: MensagemAcao | null) {
		updateCpc({ junto: cpcJunto.map((a, idx) => idx === i ? { ...a, mensagem: m ?? undefined } : a) });
	}

	// --- barra de canais / personas ---
	function pickCanal(canal: string) {
		if (!canEdit) return;
		setSelectedPersona(null);
		setSelectedCanal(prev => (prev === canal ? null : canal));
	}
	function pickPersona(pid: string) {
		if (!canEdit) return;
		setSelectedCanal(null);
		setSelectedPersona(prev => (prev === pid ? null : pid));
	}
	function onChipDragStart(e: React.DragEvent, canal: string) {
		e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'canal', canal } as DragPayload));
		e.dataTransfer.effectAllowed = 'copy';
	}
	function onPersonaDragStart(e: React.DragEvent, pid: string) {
		e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'persona', pid } as DragPayload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	const diasLoc = Array.from({ length: Math.max(1, ncp - 1) }, (_, i) => i + 1);
	const diasGiro = Array.from({ length: Math.max(1, ciclo) }, (_, i) => i + 1);
	const diasPrev = useMemo(() => Object.keys(prevPassos).map(Number).filter(d => d <= 0).sort((a, b) => a - b), [prevPassos]);
	const diasQuebra = useMemo(() => Object.keys(quebraPassos).map(Number).filter(d => d > 0).sort((a, b) => a - b), [quebraPassos]);
	const locAtivo = def.localizacao?.ativo !== false;
	const cpcAtivo = def.cpc?.ativo !== false;
	const giroAtivo = def.giro?.ativo !== false;
	const prevAtivo = def.preventivo?.ativo !== false;
	const quebraAtivo = def.quebra?.ativo !== false;
	const carencia = def.quebra?.carencia ?? 0;
	const diasEstoque = def.quebra?.dias_para_estoque ?? 6;
	const quebraDisabledDays = useMemo(() => {
		const s = new Set<number>();
		for (const d of diasQuebra) if (d <= carencia || d >= diasEstoque) s.add(d);
		return s;
	}, [diasQuebra, carencia, diasEstoque]);

	// --- resumo "Como vai funcionar" ---
	const resumoLoc = resumoFaixa(locPassos, 'D+', personas);
	const resumoGiro = resumoFaixa(giroPassos, 'D+', personas);
	const resumoPrev = resumoFaixa(prevPassos, 'D', personas);
	const resumoQuebra = resumoFaixa(quebraPassos, 'D+', personas);
	const quebraCarenciaFrase = carencia > 0 ? `Quebra a partir do D+${carencia + 1} (carência de ${carencia} dia${carencia > 1 ? 's' : ''}).` : '';
	const quebraDesligadaFrase = `Desligada: acordo quebrado não recebe ação e volta ao estoque como CPC A em ${diasEstoque} dia${diasEstoque > 1 ? 's' : ''}${carencia > 0 ? ` (a partir do D+${carencia + 1})` : ''}.`;
	const cpcOrdemNomes = cpcOrdem.map(a => canalNome[a.canal] ?? a.canal).join(' → ');

	// --- faixas recolhíveis: persistência + atalhos ---
	useEffect(() => { try { localStorage.setItem(FAIXA_STORAGE, JSON.stringify([...openFaixas])); } catch { /* noop */ } }, [openFaixas]);
	function toggleFaixa(key: string) { setOpenFaixas(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; }); }
	const dragOpenTimer = useRef<number | null>(null);
	function handleDragOverFaixa(key: string) {
		return (e: React.DragEvent) => {
			if (openFaixas.has(key)) return;
			e.preventDefault();
			if (dragOpenTimer.current === null) dragOpenTimer.current = window.setTimeout(() => { setOpenFaixas(prev => { const n = new Set(prev); n.add(key); return n; }); dragOpenTimer.current = null; }, 600);
		};
	}

	// --- resumos de uma linha por faixa (sempre visíveis) ---
	const locDiasResumo = diasResumo(locPassos, 'D+');
	const locRaia = personasComRaia(locPassos);
	const resumoLocTopo = !locAtivo ? 'Desligada: clientes novos não recebem ação.' : [locDiasResumo, `vira Não CPC no D+${ncp}`, locRaia ? `${locRaia} personas com raia` : ''].filter(Boolean).join(' · ');
	const resumoCpcTopo = !cpcAtivo ? 'Desligada: quem deu CPC não recebe ação.' : `CPC A a cada ${intervaloCpa} dia${intervaloCpa > 1 ? 's' : ''} · CPC B a cada ${intervaloCpb} dia${intervaloCpb > 1 ? 's' : ''} · Ordem: ${cpcOrdemNomes || 'só o canal do CPC'} · ${tentCpc} tentativas por canal`;
	const giroDiasResumo = diasResumo(giroPassos, 'G-dia');
	const resumoGiroTopo = !giroAtivo ? 'Desligada: clientes Não CPC não recebem ação.' : [`Ciclo de ${ciclo} dias × ${maxCiclos} ciclos`, giroDiasResumo].filter(Boolean).join(' · ');
	const prevDiasLabel = Object.keys(prevPassos).map(Number).sort((a, b) => a - b).map(d => diaLabel(d)).join(', ');
	const quebraDiasLabel = Object.keys(quebraPassos).map(Number).sort((a, b) => a - b).map(d => diaLabel(d)).join(', ');
	const prevTopo = !prevAtivo ? 'Preventivo desligado' : `Preventivo ${prevDiasLabel || '—'}`;
	const quebraTopo = !quebraAtivo
		? `Quebra desligada (volta ao estoque em ${diasEstoque} dias${carencia > 0 ? `, a partir do D+${carencia + 1}` : ''})`
		: `Quebra ${quebraDiasLabel || '—'}${carencia > 0 ? ` · a partir do D+${carencia + 1}` : ''}`;
	const resumoAcordoTopo = `${prevTopo} · ${quebraTopo}`;
	const prioCriterios = def.prioridade_contatos?.criterios ?? [];
	const resumoPrioTopo = prioCriterios.length
		? prioCriterios.map(c => `${CRITERIOS_OPTS.find(o => o.campo === c.campo)?.label ?? c.campo} ${c.sentido === 'asc' ? 'menor primeiro' : 'maior primeiro'}`).join(', depois ')
		: 'Sem regra';

	// --- avisos (ponto âmbar + auto-abrir ao carregar) ---
	const warnLoc = passosHasDup(locPassos) || (faixaGeralVazia(locPassos) && faixaTemPersona(locPassos));
	const warnCpc = new Set(cpcOrdem.map(a => a.canal)).size !== cpcOrdem.length;
	const warnGiro = passosHasDup(giroPassos) || (faixaGeralVazia(giroPassos) && faixaTemPersona(giroPassos));
	const warnAcordo = passosHasDup(prevPassos) || passosHasDup(quebraPassos);
	const autoOpenedRef = useRef<string | null>(null);
	useEffect(() => {
		if (!estrId || autoOpenedRef.current === estrId) return;
		autoOpenedRef.current = estrId;
		setOpenFaixas(prev => {
			const n = new Set(prev);
			if (warnLoc) n.add('localizacao');
			if (warnCpc) n.add('cpc');
			if (warnGiro) n.add('giro');
			if (warnAcordo) n.add('acordo');
			return n;
		});
	}, [estrId, warnLoc, warnCpc, warnGiro, warnAcordo]);

	const [pendingScroll, setPendingScroll] = useState<string | null>(null);
	useEffect(() => {
		if (!pendingScroll) return;
		const t = window.setTimeout(() => {
			const el = document.querySelector(`[data-scroll-target="${pendingScroll}"]`);
			if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-[#e9a23b]'); window.setTimeout(() => el.classList.remove('ring-2', 'ring-[#e9a23b]'), 1500); }
			setPendingScroll(null);
		}, 150);
		return () => window.clearTimeout(t);
	}, [pendingScroll]);

	const contadores = useMemo(() => {
		const faixas: { passos: Passos }[] = [
			{ passos: locPassos }, { passos: giroPassos }, { passos: prevPassos }, { passos: quebraPassos },
		];
		let diasComAcao = 0; let semTemplate = 0; let semFrase = 0;
		const canaisUsados = new Set<string>(); const personasRaia = new Set<string>();
		const contar = (a: Acao) => {
			const t = canalTipoMensagem(a.canal);
			if (t === 'nenhuma') return; // discador, e-mail, enriquecimento não entram na conta
			if (hasMensagem(a)) return;
			if (t === 'template') semTemplate++; else semFrase++;
		};
		for (const f of faixas) {
			for (const arr of Object.values(f.passos)) {
				const split = splitMultiPersona(arr);
				const pub = acoesPublico(split).filter(a => a.canal !== 'sem_acao' && a.canal !== 'enriquecimento');
				if (pub.length) diasComAcao++;
				for (const a of pub) { canaisUsados.add(a.canal); contar(a); }
				const pids = new Set<string>(); split.forEach(a => a.personas?.forEach(p => pids.add(p)));
				for (const pid of pids) {
					personasRaia.add(pid);
					const pa = acoesPersona(split, pid).filter(a => a.canal !== 'sem_acao' && a.canal !== 'enriquecimento');
					if (pa.length) diasComAcao++;
					for (const a of pa) { canaisUsados.add(a.canal); contar(a); }
				}
			}
		}
		for (const a of cpcOrdem) { if (a.canal) { canaisUsados.add(a.canal); contar(a); } }
		for (const a of cpcJunto) { if (a.canal) { canaisUsados.add(a.canal); contar(a); } }
		const avisos = [warnLoc, warnCpc, warnGiro, warnAcordo].filter(Boolean).length;
		return { diasComAcao, semTemplate, semFrase, avisos, canaisUsados: [...canaisUsados], personasRaia: personasRaia.size };
	}, [locPassos, giroPassos, prevPassos, quebraPassos, cpcOrdem, cpcJunto, warnLoc, warnCpc, warnGiro, warnAcordo]);

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canEdit && !saving) onSalvar(); }
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [canEdit, saving, onSalvar]);

	function irParaAviso() {
		const order: [string, boolean][] = [['localizacao', warnLoc], ['cpc', warnCpc], ['giro', warnGiro], ['acordo', warnAcordo]];
		const first = order.find(([, w]) => w)?.[0];
		if (!first) return;
		setOpenFaixas(prev => { const n = new Set(prev); n.add(first); return n; });
		requestAnimationFrame(() => document.querySelector(`[data-faixa="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	}

	return (
		<PersonasIntelContext.Provider value={personasIntel}>
		<div className="space-y-4">
			<div className="min-w-0 space-y-5">
				{forma === 'fluxo' ? (
					<FluxoView def={def} setDef={setDef} canEdit={canEdit} personas={personas} frasesPorId={frasesPorId} onEditMensagem={onEditMensagem} onIrParaRaias={(faixaKey) => { setOpenFaixas(prev => { const n = new Set(prev); n.add(faixaKey); return n; }); onFormaChange?.('raias'); }} />
				) : (
				<>
				{/* Paleta fixa no topo: canais + personas */}
				<div className="sticky z-20 -mx-1 space-y-2 rounded-xl border border-[#dfe8ea] bg-white px-3 py-2.5 shadow-sm" style={{ top: stickyTop }}>
					<div className="flex flex-wrap items-center gap-2">
						<span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Canais</span>
						{CANAIS.map(c => {
							const active = selectedCanal === c.id;
							return (
								<button key={c.id} type="button" draggable={canEdit} onDragStart={e => onChipDragStart(e, c.id)} onDragEnd={() => setSelectedCanal(null)} onClick={() => pickCanal(c.id)} disabled={!canEdit}
									className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${active ? 'ring-2 ring-[#e9a23b] ring-offset-1' : ''} ${dragOverCanais.has(c.id) ? 'opacity-40' : ''}`}
									style={{ backgroundColor: c.cor }}>{c.label}</button>
							);
						})}
						<button type="button" draggable={canEdit} onDragStart={e => onChipDragStart(e, ENRIQ.id)} onDragEnd={() => setSelectedCanal(null)} onClick={() => pickCanal(ENRIQ.id)} disabled={!canEdit}
							className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white transition ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${selectedCanal === ENRIQ.id ? 'ring-2 ring-[#e9a23b] ring-offset-1' : ''} ${dragOverCanais.has(ENRIQ.id) ? 'opacity-40' : ''}`}
							style={{ backgroundColor: ENRIQ.cor }}><Search size={13} /> {ENRIQ.label}</button>
						{PERSONA_CANAIS.map(c => {
							const active = selectedCanal === c.id;
							return (
								<PersonaCanalPopover key={c.id} personas={personasIntel}>
									<button type="button" draggable={canEdit} onDragStart={e => onChipDragStart(e, c.id)} onDragEnd={() => setSelectedCanal(null)} onClick={() => pickCanal(c.id)} disabled={!canEdit}
										className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#e9a23b] bg-[#fff7e8] px-3 py-1.5 text-xs font-semibold text-[#9a631b] transition ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${active ? 'ring-2 ring-[#e9a23b] ring-offset-1' : ''} ${dragOverCanais.has(c.id) ? 'opacity-40' : ''}`}>{c.label}</button>
								</PersonaCanalPopover>
							);
						})}
					</div>
					<div className="flex flex-wrap items-center gap-2 border-t border-[#e2eaec] pt-2">
						<span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Personas desta carteira</span>
						{personas.length === 0 ? (
							<Link to="/personas" className="text-xs font-semibold text-[#0F4C5C] underline hover:text-[#0d4252]">Criar personas</Link>
						) : personas.map(p => {
							const active = selectedPersona === p.id;
							return (
								<button key={p.id} type="button" draggable={canEdit} onDragStart={e => onPersonaDragStart(e, p.id)} onDragEnd={() => setSelectedPersona(null)} onClick={() => pickPersona(p.id)} disabled={!canEdit}
									className={`inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 text-xs font-semibold transition ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${active ? 'ring-2 ring-[#e9a23b] ring-offset-1' : ''}`}
									style={{ borderColor: p.cor, color: p.cor }}>
									<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.cor }} />
									{p.nome}
									<span className="font-normal text-slate-400">{numberBR(contagens[p.nome] ?? 0)}</span>
								</button>
							);
						})}
					</div>
					{(selectedCanal || selectedPersona) && (
						<p className="text-[11px] font-medium text-[#9a631b]">
							{selectedCanal ? <>Toque num dia/célula para soltar <strong>{canalNome[selectedCanal]}</strong>.</> : <>Toque num dia para criar a raia de <strong>{personaNome(selectedPersona!)}</strong> copiando o público geral.</>}
						</p>
					)}
					<p className="text-[11px] text-[#9a631b]">Arraste uma persona para um dia para tratá-la diferente; nos dias em que ela não está, segue o público geral.</p>
				</div>

				{/* Atalhos de expandir/recolher */}
				<div className="flex justify-end gap-4">
					<button type="button" onClick={() => { setOpenFaixas(new Set([...FAIXA_KEYS, 'comofunciona'])); setOpenFrases(new Set(FAIXA_KEYS.filter(k => k !== 'prioridade'))); }} className="text-xs font-semibold text-[#0F4C5C] hover:underline">Expandir tudo</button>
					<button type="button" onClick={() => { setOpenFaixas(new Set()); setOpenFrases(new Set()); }} className="text-xs font-semibold text-[#0F4C5C] hover:underline">Recolher tudo</button>
				</div>

				{/* Migração de frases por estágio (modelo antigo) */}
				{temMensagensAntigas && (
					<div className="flex items-center justify-between gap-3 rounded-lg border border-[#f0d49a] bg-[#fff7e8] px-4 py-3">
						<p className="text-xs leading-relaxed text-[#9a631b]">Esta estratégia tem frases por estágio (modelo antigo). Elas valem só onde o dia não tem frase.</p>
						{canEdit && <button type="button" onClick={levarMensagensParaDias} className="shrink-0 rounded-lg border border-[#9a631b] bg-white px-3 py-1.5 text-xs font-semibold text-[#9a631b] hover:bg-[#fff1d8]">Levar para os dias</button>}
					</div>
				)}

				{/* Faixa 1 — Cliente novo */}
				<FaixaColapsivel titulo="Cliente novo · ainda não deu CPC" resumo={resumoLocTopo} warning={warnLoc} open={openFaixas.has('localizacao')} onToggle={() => toggleFaixa('localizacao')} ativo={locAtivo} onToggleAtivo={() => updateLocalizacao({ ativo: !locAtivo })} canEdit={canEdit} desligadoMsg="Cliente novo desligada neste segmento: os clientes desta fase não recebem ação." dataFaixa="localizacao">
					<p className="mb-4 text-xs leading-relaxed text-slate-500">Cada dia conta desde a entrada do cliente na carga. A cada passagem o MotorCX usa o próximo telefone (1, 2, 3, 4…), até alguém dar CPC.</p>
					<div className="mb-3">
						<Stepper label="Vira Não CPC no dia" value={ncp} min={2} max={30} disabled={!canEdit} onChange={v => updateLocalizacao({ dias_sem_contato_para_ncp: v })} />
					</div>
					<GradeFaixa track="localizacao" setDragOverCell={setDragOverCell} dias={diasLoc} finalLabel={`D+${ncp} · sem CPC → Não CPC`} def={def} setDef={setDef} canEdit={canEdit} selectedCanal={selectedCanal} selectedPersona={selectedPersona} personas={personas} contagens={contagens} expanded={expanded} setExpanded={setExpanded} frasesPorId={frasesPorId} onEditMensagem={(d, l, i) => onEditMensagem('localizacao', d, l, i)} />
					<FrasesDaFaixa faixaKey="localizacao" passos={locPassos} frasesPorId={frasesPorId} canEdit={canEdit} open={openFrases.has('localizacao')} onToggle={() => toggleFrasesFaixa('localizacao')} onEdit={(d, l, i) => onEditMensagem('localizacao', d, l, i)} onClear={(d, l, i) => clearMensagem('localizacao', d, l, i)} />
				</FaixaColapsivel>

				{/* Faixa 2 — Deu CPC */}
				<FaixaColapsivel titulo="Deu CPC · CPC A e CPC B" resumo={resumoCpcTopo} warning={warnCpc} open={openFaixas.has('cpc')} onToggle={() => toggleFaixa('cpc')} ativo={cpcAtivo} onToggleAtivo={() => updateCpc({ ativo: !cpcAtivo })} canEdit={canEdit} desligadoMsg="Deu CPC desligada neste segmento: os clientes desta fase não recebem ação." dataFaixa="cpc">
					<p className="mb-4 text-xs leading-relaxed text-slate-500">O primeiro é sempre o canal em que o cliente deu CPC, no contato principal. Se ele parar de responder, o MotorCX segue a ordem de reserva abaixo.</p>
				<div className="mb-4 grid gap-4 sm:grid-cols-2">
					<Stepper label="CPC A: acionar a cada" value={intervaloCpa} min={1} max={30} disabled={!canEdit} onChange={v => updateCpc({ intervalo_cpa: v })} />
					<Stepper label="CPC B: acionar a cada" value={intervaloCpb} min={1} max={30} disabled={!canEdit} onChange={v => updateCpc({ intervalo_cpb: v })} />
				</div>
				<p className="mb-4 text-xs leading-relaxed text-slate-500">Conta a partir da última ação de CPC enviada para o cliente. Ex.: 3 = acionou na segunda, volta na quinta.{intervaloCpa === 1 && ' CPC A: todo dia de lista.'}{intervaloCpb === 1 && ' CPC B: todo dia de lista.'}</p>
					<div className="flex items-center gap-2 overflow-x-auto pb-2" onDragOver={e => { if (canEdit) e.preventDefault(); }} onDrop={e => { if (canEdit) { e.preventDefault(); const p = readPayload(e); if (p?.kind === 'canal') addCpcReserva(p.canal); } }}>
						<span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e9a23b] px-3 py-1.5 text-xs font-semibold text-white">★ Canal do CPC · contato principal</span>
						{(() => { const hs = cpcHotStatus(def.cpc?.mensagem_hot, frasesPorId); const hl = Object.keys(def.cpc?.mensagem_hot ?? {}).map(c => cpcMensagemLabel(def.cpc?.mensagem_hot?.[c], frasesPorId, c)).join(' · '); return (canEdit || hs !== 'nenhuma') ? <button type="button" onClick={e => { e.stopPropagation(); setEditingCpc({ tipo: 'hot' }); }} title={hl || 'Sem frase'} aria-label="Editar frase do canal do CPC" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition ${hs === 'desativada' ? 'bg-[#C62828] text-white' : hs === 'nenhuma' ? 'border border-white/70 text-white/90 hover:bg-white/25' : 'bg-white text-[#0F4C5C] hover:bg-white/90'}`}><MessageCircle size={11} strokeWidth={2.5} /></button> : null; })()}
						{cpcOrdem.map((a, i) => (
							<div key={i} className="flex shrink-0 items-center gap-1">
								{canEdit && (
									<div className="flex flex-col">
										<button type="button" onClick={() => moveCpcReserva(i, -1)} disabled={i === 0} className="grid h-4 w-5 place-items-center text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-30" aria-label="Anterior">‹</button>
										<button type="button" onClick={() => moveCpcReserva(i, 1)} disabled={i === cpcOrdem.length - 1} className="grid h-4 w-5 place-items-center text-[#0F4C5C] hover:bg-[#edf4f5] disabled:opacity-30" aria-label="Próximo">›</button>
									</div>
								)}
								<ChipCanal canal={a.canal} onRemove={canEdit ? () => removeCpcReserva(i) : undefined} msgStatus={cpcMensagemStatus(a.mensagem, frasesPorId)} msgLabel={cpcMensagemLabel(a.mensagem, frasesPorId, a.canal)} onEditMsg={canEdit ? () => setEditingCpc({ tipo: 'reserva', index: i }) : undefined} />
							</div>
						))}
						{canEdit && (
							<button type="button" onClick={() => { if (selectedCanal) { addCpcReserva(selectedCanal); setSelectedCanal(null); } }} className="inline-flex shrink-0 items-center rounded-lg border border-dashed border-[#0F4C5C] px-3 py-1.5 text-[11px] font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]">solte um canal aqui</button>
						)}
					</div>
					<div className="mt-3">
						<Stepper label="Tentativas em cada canal antes de trocar" value={tentCpc} min={1} max={6} disabled={!canEdit} onChange={v => updateCpc({ tentativas_por_canal: v })} />
					</div>
				<div className="mt-4">
					<p className="mb-2 text-xs font-semibold text-slate-600">Reforço junto (acompanha o canal da vez)</p>
					<div className="flex flex-wrap items-center gap-2">
						{cpcJunto.length === 0 && <span className="text-[11px] italic text-slate-400">Sem reforço junto.</span>}
						{cpcJunto.map((a, i) => (
							<ChipCanal key={i} canal={a.canal} onRemove={canEdit ? () => removeCpcJunto(i) : undefined} msgStatus={cpcMensagemStatus(a.mensagem, frasesPorId)} msgLabel={cpcMensagemLabel(a.mensagem, frasesPorId, a.canal)} onEditMsg={canEdit ? () => setEditingCpc({ tipo: 'junto', index: i }) : undefined} />
						))}
						{canEdit && (
							<button type="button" onClick={() => { if (selectedCanal) { addCpcJunto(selectedCanal); setSelectedCanal(null); } }} className="inline-flex shrink-0 items-center rounded-lg border border-dashed border-[#0F4C5C] px-3 py-1.5 text-[11px] font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]">+ canal</button>
						)}
					</div>
				</div>
				<FrasesCpcFaixa cpc={{ ordem: cpcOrdem, junto: cpcJunto, mensagem_hot: def.cpc?.mensagem_hot }} frasesPorId={frasesPorId} canEdit={canEdit} open={openFrases.has('cpc')} onToggle={() => toggleFrasesFaixa('cpc')} onEditHot={c => setEditingCpc({ tipo: 'hot', canal: c })} onClearHot={c => setCpcHot(c, null)} onEditReserva={i => setEditingCpc({ tipo: 'reserva', index: i })} onClearReserva={i => setCpcReservaMensagem(i, null)} onEditJunto={i => setEditingCpc({ tipo: 'junto', index: i })} onClearJunto={i => setCpcJuntoMensagem(i, null)} />
			</FaixaColapsivel>

				{/* Faixa 3 — Não CPC */}
				<FaixaColapsivel titulo="Não CPC · ciclo que se repete" resumo={resumoGiroTopo} warning={warnGiro} open={openFaixas.has('giro')} onToggle={() => toggleFaixa('giro')} ativo={giroAtivo} onToggleAtivo={() => updateGiro({ ativo: !giroAtivo })} canEdit={canEdit} desligadoMsg="Não CPC desligada neste segmento: os clientes desta fase não recebem ação." dataFaixa="giro">
					<p className="mb-4 text-xs leading-relaxed text-slate-500">Quem passou do prazo sem CPC entra num ciclo. Ao fim dos ciclos, o cliente espera um novo enriquecimento.</p>
					<div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
						<Stepper label="Ciclo de N dias" value={ciclo} min={2} max={15} disabled={!canEdit} onChange={v => updateGiro({ ciclo_dias: v })} />
						<Stepper label="repetido N vezes" value={maxCiclos} min={1} max={6} disabled={!canEdit} onChange={v => updateGiro({ max_ciclos: v })} />
					</div>
					<GradeFaixa track="giro" setDragOverCell={setDragOverCell} dias={diasGiro} finalLabel={`↻ × ${maxCiclos} · repete o ciclo; depois aguarda enriquecimento`} def={def} setDef={setDef} canEdit={canEdit} selectedCanal={selectedCanal} selectedPersona={selectedPersona} personas={personas} contagens={contagens} expanded={expanded} setExpanded={setExpanded} frasesPorId={frasesPorId} onEditMensagem={(d, l, i) => onEditMensagem('giro', d, l, i)} />
					<FrasesDaFaixa faixaKey="giro" passos={giroPassos} frasesPorId={frasesPorId} canEdit={canEdit} open={openFrases.has('giro')} onToggle={() => toggleFrasesFaixa('giro')} onEdit={(d, l, i) => onEditMensagem('giro', d, l, i)} onClear={(d, l, i) => clearMensagem('giro', d, l, i)} />
				</FaixaColapsivel>

				{/* Preventivo e Quebra (recolhido) */}
				<div data-faixa="acordo" className="rounded-xl border border-[#dfe8ea] bg-white">
					<button type="button" aria-expanded={openFaixas.has('acordo')} onClick={() => toggleFaixa('acordo')} onDragOver={handleDragOverFaixa('acordo')} className="flex w-full items-center justify-between px-5 py-4 text-left">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								{warnAcordo && <span className="h-2 w-2 shrink-0 rounded-full bg-[#e9a23b]" />}
								<span className="text-sm font-bold text-[#163943]">Clientes em acordo (preventivo e quebra)</span>
							</div>
							<p className="mt-0.5 truncate text-[11px] text-slate-500">{resumoAcordoTopo}</p>
						</div>
						<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: openFaixas.has('acordo') ? 'rotate(180deg)' : 'none' }} />
					</button>
					{openFaixas.has('acordo') && (
						<div className="space-y-5 border-t border-[#ecf0f1] p-5">
							{/* Preventivo */}
							<section className={`rounded-lg border p-4 ${prevAtivo ? 'border-[#e2eaec] bg-white' : 'border-[#e2c9a0] bg-[#faf3e8]'}`}>
								<div className="mb-3 flex items-center justify-between gap-3">
									<div>
										<h3 className="text-sm font-bold text-[#163943]">Preventivo</h3>
										<p className="mt-0.5 text-xs leading-relaxed text-slate-500">Dias antes do vencimento de cada parcela do acordo. Cada parcela recomeça a contagem.</p>
									</div>
									{canEdit && (
										<label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#163943]">
											{prevAtivo ? 'Ligado' : 'Desligado'}
											<button type="button" role="switch" aria-checked={prevAtivo} onClick={() => updatePreventivo({ ativo: !prevAtivo })} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${prevAtivo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${prevAtivo ? 'left-[18px]' : 'left-0.5'}`} /></button>
										</label>
									)}
								</div>
								{!prevAtivo ? (
									<p className="rounded-lg bg-[#fff7e8] px-4 py-3 text-xs leading-relaxed text-[#9a631b]">Preventivo desligado neste segmento: clientes em acordo não recebem lembrete antes do vencimento. Os passos desenhados continuam salvos, só não valem.</p>
								) : (
									<>
										<GradeFaixa track="preventivo" setDragOverCell={setDragOverCell} dias={diasPrev} def={def} setDef={setDef} canEdit={canEdit} selectedCanal={selectedCanal} selectedPersona={selectedPersona} personas={personas} contagens={contagens} expanded={expanded} setExpanded={setExpanded} onRemoveDay={canEdit ? removeDiaPreventivo : undefined} frasesPorId={frasesPorId} onEditMensagem={(d, l, i) => onEditMensagem('preventivo', d, l, i)} />
									<FrasesDaFaixa faixaKey="preventivo" passos={prevPassos} frasesPorId={frasesPorId} canEdit={canEdit} open={openFrases.has('preventivo')} onToggle={() => toggleFrasesFaixa('preventivo')} onEdit={(d, l, i) => onEditMensagem('preventivo', d, l, i)} onClear={(d, l, i) => clearMensagem('preventivo', d, l, i)} />
										{canEdit && <div className="mt-3"><AddDiaButton prefixo="D-" max={30} onAdd={addDiaPreventivo} /></div>}
									</>
								)}
							</section>

							{/* Quebra */}
							<section className={`rounded-lg border p-4 ${quebraAtivo ? 'border-[#e2eaec] bg-white' : 'border-[#e2c9a0] bg-[#faf3e8]'}`}>
								<div className="mb-3 flex items-center justify-between gap-3">
									<div>
										<h3 className="text-sm font-bold text-[#163943]">Quebra</h3>
										<p className="mt-0.5 text-xs leading-relaxed text-slate-500">Dias depois do vencimento da parcela sem pagamento.</p>
									</div>
									{canEdit && (
										<label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#163943]">
											{quebraAtivo ? 'Ligado' : 'Desligado'}
											<button type="button" role="switch" aria-checked={quebraAtivo} onClick={() => updateQuebra({ ativo: !quebraAtivo })} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${quebraAtivo ? 'bg-[#2E7D32]' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${quebraAtivo ? 'left-[18px]' : 'left-0.5'}`} /></button>
										</label>
									)}
								</div>
								<div className="mb-4 grid gap-4 sm:grid-cols-2">
									<label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Carência (dias após o vencimento sem baixa)</span><input type="number" min={0} max={60} value={carencia} disabled={!canEdit} onChange={e => updateQuebra({ carencia: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })} className="h-10 w-28 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f8f9]" /><span className="mt-1 block text-[11px] leading-snug text-slate-400">Dias depois do vencimento, sem baixa, que ainda não contam como quebra (tempo para o pagamento compensar). A quebra começa no D+{carencia + 1}.</span></label>
									<label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Volta ao estoque depois de</span><input type="number" min={1} max={90} value={diasEstoque} disabled={!canEdit} onChange={e => updateQuebra({ dias_para_estoque: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })} className="h-10 w-28 rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C] disabled:bg-[#f5f8f9]" /><span className="mt-1 block text-[11px] leading-snug text-slate-400">Dias depois do vencimento sem pagamento em que o cliente sai do acordo e volta à esteira como CPC A.</span></label>
								</div>
								{!quebraAtivo ? (
									<p className="rounded-lg bg-[#fff7e8] px-4 py-3 text-xs leading-relaxed text-[#9a631b]">Quebra desligada neste segmento: acordo quebrado não recebe ação e volta ao estoque como CPC A no prazo acima.</p>
								) : (
									<>
										{quebraDisabledDays.size > 0 && <p className="mb-3 rounded-lg bg-[#fff7e8] px-4 py-2 text-[11px] font-medium text-[#9a631b]">Dias fora da janela da quebra (carência ou após o retorno ao estoque) aparecem em cinza e não serão acionados.</p>}
										<GradeFaixa track="quebra" setDragOverCell={setDragOverCell} dias={diasQuebra} def={def} setDef={setDef} canEdit={canEdit} selectedCanal={selectedCanal} selectedPersona={selectedPersona} personas={personas} contagens={contagens} expanded={expanded} setExpanded={setExpanded} onRemoveDay={canEdit ? removeDiaQuebra : undefined} disabledDays={quebraDisabledDays} disabledLabel="fora da janela da quebra — não será acionado" frasesPorId={frasesPorId} onEditMensagem={(d, l, i) => onEditMensagem('quebra', d, l, i)} />
									<FrasesDaFaixa faixaKey="quebra" passos={quebraPassos} frasesPorId={frasesPorId} canEdit={canEdit} open={openFrases.has('quebra')} onToggle={() => toggleFrasesFaixa('quebra')} onEdit={(d, l, i) => onEditMensagem('quebra', d, l, i)} onClear={(d, l, i) => clearMensagem('quebra', d, l, i)} />
										{canEdit && <div className="mt-3"><AddDiaButton prefixo="D+" max={Math.max(1, diasEstoque - 1)} onAdd={addDiaQuebra} /></div>}
									</>
								)}
							</section>
						</div>
					)}
				</div>

				{/* Prioridade dos telefones (recolhível) */}
				<div className="rounded-xl border border-[#dfe8ea] bg-white">
					<button type="button" aria-expanded={openFaixas.has('prioridade')} onClick={() => toggleFaixa('prioridade')} onDragOver={handleDragOverFaixa('prioridade')} className="flex w-full items-center justify-between px-5 py-4 text-left">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="flex items-center gap-2 text-sm font-bold text-[#163943]"><Users size={16} className="text-[#0F4C5C]" /> Prioridade dos telefones</span>
							</div>
							<p className="mt-0.5 truncate text-[11px] text-slate-500">{resumoPrioTopo}</p>
						</div>
						<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: openFaixas.has('prioridade') ? 'rotate(180deg)' : 'none' }} />
					</button>
					{openFaixas.has('prioridade') && (
						<div className="space-y-4 border-t border-[#ecf0f1] p-5">
							<p className="text-xs leading-relaxed text-slate-500">Vale depois do contato principal e do rodízio. Telefone sem Score/Ranking vai depois dos que têm.</p>
							{(() => {
								const prio: PrioridadeContatos = def.prioridade_contatos ?? { criterios: [] };
								const setPrio = (p: PrioridadeContatos) => setDef({ ...def, prioridade_contatos: p });
								const criterios = prio.criterios ?? [];
								const addCrit = () => setPrio({ ...prio, criterios: [...criterios, { campo: 'ranking', sentido: 'asc' }] });
								const updCrit = (i: number, patch: Partial<CriterioPrioridade>) => setPrio({ ...prio, criterios: criterios.map((c, idx) => idx === i ? { ...c, ...patch } : c) });
								const delCrit = (i: number) => setPrio({ ...prio, criterios: criterios.filter((_, idx) => idx !== i) });
								const moveCrit = (i: number, dir: number) => { const j = i + dir; if (j < 0 || j >= criterios.length) return; const next = [...criterios]; [next[i], next[j]] = [next[j], next[i]]; setPrio({ ...prio, criterios: next }); };
								return <>
									<div className="space-y-2">
										{criterios.map((c, i) => (
											<div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-2">
												{canEdit && <div className="flex flex-col"><button type="button" onClick={() => moveCrit(i, -1)} disabled={i === 0} className="text-[#0F4C5C] disabled:opacity-30" aria-label="Subir">‹</button><button type="button" onClick={() => moveCrit(i, 1)} disabled={i === criterios.length - 1} className="text-[#0F4C5C] disabled:opacity-30" aria-label="Descer">›</button></div>}
												<select value={c.campo} disabled={!canEdit} onChange={e => updCrit(i, { campo: e.target.value })} className="h-9 w-[180px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]">{CRITERIOS_OPTS.map(o => <option key={o.campo} value={o.campo}>{o.label}</option>)}</select>
												<select value={c.sentido} disabled={!canEdit} onChange={e => updCrit(i, { sentido: e.target.value as 'asc' | 'desc' })} className="h-9 w-[140px] rounded border border-[#d8e3e5] bg-white px-2 text-xs outline-none focus:border-[#0F4C5C]"><option value="asc">menor primeiro</option><option value="desc">maior primeiro</option></select>
												{canEdit && <button type="button" onClick={() => delCrit(i)} className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-[#C62828]"><X size={15} /></button>}
											</div>
										))}
									</div>
									{canEdit && <button type="button" onClick={addCrit} className="flex items-center gap-1 text-xs font-bold text-[#0F4C5C] hover:underline"><Plus size={14} /> critério</button>}
									<div className="grid gap-4 sm:grid-cols-2">
										<label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Descartar score abaixo de</span><input type="number" value={prio.score_minimo ?? ''} disabled={!canEdit} onChange={e => setPrio({ ...prio, score_minimo: e.target.value ? Number(e.target.value) : null })} placeholder="—" className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]" /></label>
										<label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Descartar ranking acima de</span><input type="number" value={prio.ranking_maximo ?? ''} disabled={!canEdit} onChange={e => setPrio({ ...prio, ranking_maximo: e.target.value ? Number(e.target.value) : null })} placeholder="—" className="h-10 w-full rounded border border-[#d8e3e5] px-3 text-sm outline-none focus:border-[#0F4C5C]" /></label>
									</div>
								</>;
							})()}
						</div>
					)}
				</div>

				

				<ComoVaiFuncionar def={def} personas={personas} contadores={contadores} frasesPorId={frasesPorId} open={openFaixas.has('comofunciona')} onToggle={() => toggleFaixa('comofunciona')} onIrParaDia={(faixa, day) => { setOpenFaixas(prev => { const n = new Set(prev); n.add(faixa); return n; }); setPendingScroll(`${faixa}:${day}`); }} locAtivo={locAtivo} cpcAtivo={cpcAtivo} giroAtivo={giroAtivo} prevAtivo={prevAtivo} quebraAtivo={quebraAtivo} tentCpc={tentCpc} intervaloCpa={intervaloCpa} intervaloCpb={intervaloCpb} cpcOrdem={cpcOrdem} cpcJunto={cpcJunto} />

				<div className="rounded-lg border border-[#e2eaec] bg-[#f5f8f9] px-4 py-3 text-xs text-[#365661]">
					<strong>Travas que valem sempre:</strong> contato inválido ou que não pertence ao cliente nunca recebe; WhatsApp só em número confiável; horário, domingo e feriado; 48h entre ações.
				</div>
				</>
				)}
			</div>
		</div>
		{editingMsg && (() => { const ed = getAcaoEditing(); if (!ed) return null;
			if (ed.isPersona) return (
				<MensagemDiaEditor canal={ed.canal} mensagem={ed.acao.mensagem} frases={frases} estagio={estagioFaixa[editingMsg.track]} isCpc={false} isPersona canaisEmpresa={canaisEmpresaAtivos} titulo={ed.titulo} onClose={() => setEditingMsg(null)} onSet={m => setMensagemEditing(m)} onSalvarNoPlaybook={onSalvarNoPlaybook} />
			);
			const m = ed.acao.mensagem;
			const fraseId = m && typeof m === 'object' && 'frase_id' in m ? (m as { frase_id: string }).frase_id : undefined;
			return <EscolherMensagem canal={ed.canal} fraseId={fraseId} frases={frases} onSet={m2 => setMensagemEditing(m2)} onClose={() => setEditingMsg(null)} tituloExtra={ed.titulo} />;
		})()}
		{editingCpc && (() => {
		if (editingCpc.tipo === 'hot') {
			return <MensagemDiaEditor canal="" mensagem={def.cpc?.mensagem_hot as unknown as MensagemAcao | undefined} frases={frases} estagio="cpc_a" isCpc={false} isPersona={false} isCpcHot canaisEmpresa={canaisEmpresaAtivos} titulo="Canal do CPC · contato principal" onClose={() => setEditingCpc(null)} onSet={m => updateCpc({ mensagem_hot: m && typeof m === 'object' && Object.keys(m).length ? m : undefined })} onSalvarNoPlaybook={onSalvarNoPlaybook} />;
		}
		if (editingCpc.tipo === 'reserva') {
			const i = editingCpc.index ?? 0; const a = cpcOrdem[i];
			return a ? <EscolherMensagemCpc canal={a.canal} mensagem={a.mensagem} frases={frases} tituloExtra={`Reserva ${i + 1} · ${canalNome[a.canal] ?? a.canal}`} onClose={() => setEditingCpc(null)} onSet={m => setCpcReservaMensagem(i, m)} /> : null;
		}
		const i = editingCpc.index ?? 0; const a = cpcJunto[i];
		return a ? <EscolherMensagemCpc canal={a.canal} mensagem={a.mensagem} frases={frases} tituloExtra={`Junto · ${canalNome[a.canal] ?? a.canal}`} onClose={() => setEditingCpc(null)} onSet={m => setCpcJuntoMensagem(i, m)} /> : null;
	})()}
		</PersonasIntelContext.Provider>
	);
}

function laneStr(acts: Acao[]): { text: string; hasMsg: boolean } {
	const ativas = acts.filter(a => a.canal !== 'sem_acao');
	if (!ativas.length) return { text: 'sem ação', hasMsg: false };
	const parts = ativas.map((a, i) => {
		const prefix = i === 0 ? '' : a.modo === 'senao' ? 'senão ' : a.modo === 'junto' ? '+ ' : a.modo === 'reserva' ? 'reserva ' : '';
		return prefix + (canalNome[a.canal] ?? a.canal);
	});
	return { text: parts.join(' → '), hasMsg: ativas.some(a => hasMensagem(a)) };
}

function CardFaixaComo({ titulo, passos, ativo, faixaKey, personas, frasesPorId, onIrParaDia }: {
	titulo: string; passos: Passos; ativo: boolean; faixaKey: string;
	personas: PersonaUsuario[]; frasesPorId: Map<string, Frase>; onIrParaDia: (faixa: string, day: number) => void;
}) {
	if (!ativo) {
		return (
			<div className="rounded-xl border border-[#e2c9a0] bg-[#faf3e8] p-4">
				<h3 className="text-sm font-bold text-[#9a631b]">{titulo}</h3>
				<p className="mt-1 text-xs text-[#9a631b]">Desligada neste segmento.</p>
			</div>
		);
	}
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	const lanePersonas = personas.filter(p => Object.values(passos).some(arr => splitMultiPersona(arr).some(a => a.personas?.includes(p.id))));
	return (
		<div className="rounded-xl border border-[#dfe8ea] bg-white p-4">
			<h3 className="mb-2 text-sm font-bold text-[#163943]">{titulo}</h3>
			{dias.length === 0 ? <p className="text-xs italic text-slate-400">Seguindo o padrão MotorCX.</p> : (
				<div className="space-y-1.5">
					{dias.map(d => {
						const arr = splitMultiPersona(passos[String(d)] ?? []);
						const pub = acoesPublico(arr).filter(a => a.canal !== 'sem_acao');
						const { text, hasMsg } = laneStr(pub);
						return (
							<div key={d}>
								<button type="button" onClick={() => onIrParaDia(faixaKey, d)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-[#edf4f5]">
									<span className="shrink-0 font-bold text-[#0F4C5C]">{diaLabel(d)}</span>
									<span className="text-slate-600">{text}</span>
									{hasMsg && <MessageCircle size={11} className="shrink-0 text-[#0F4C5C]" />}
								</button>
								{lanePersonas.map(p => {
									const pa = acoesPersona(arr, p.id).filter(a => a.canal !== 'sem_acao');
									if (!pa.length) return null;
									const ps = laneStr(pa);
									return (
										<div key={p.id} className="ml-4 flex items-center gap-1.5 py-0.5 text-[11px] text-slate-500">
											<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} />
											<span>{p.nome}: {ps.text}</span>
											{ps.hasMsg && <MessageCircle size={10} className="shrink-0 text-[#0F4C5C]" />}
										</div>
									);
								})}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function ComoVaiFuncionar({ def, personas, contadores, frasesPorId, open, onToggle, onIrParaDia, locAtivo, cpcAtivo, giroAtivo, prevAtivo, quebraAtivo, tentCpc, intervaloCpa, intervaloCpb, cpcOrdem, cpcJunto }: {
	def: Definicao; personas: PersonaUsuario[]; contadores: { diasComAcao: number; semTemplate: number; semFrase: number; avisos: number; canaisUsados: string[]; personasRaia: number };
	frasesPorId: Map<string, Frase>; open: boolean; onToggle: () => void;
	onIrParaDia: (faixa: string, day: number) => void;
	locAtivo: boolean; cpcAtivo: boolean; giroAtivo: boolean; prevAtivo: boolean; quebraAtivo: boolean;
	tentCpc: number; intervaloCpa: number; intervaloCpb: number; cpcOrdem: Acao[]; cpcJunto: Acao[];
}) {
	const locPassos = normPassos(def.localizacao?.passos);
	const giroPassos = normPassos(def.giro?.passos);
	const prevPassos = normPassos(def.preventivo?.passos);
	const quebraPassos = normPassos(def.quebra?.passos);
	const canaisTxt = contadores.canaisUsados.length ? contadores.canaisUsados.map(c => canalNome[c] ?? c).join(', ') : '—';
	const resumoParts = [`${contadores.diasComAcao} dias com ação`];
	if (contadores.semTemplate) resumoParts.push(`${contadores.semTemplate} sem template`);
	if (contadores.semFrase) resumoParts.push(`${contadores.semFrase} sem frase`);
	resumoParts.push(`${contadores.avisos} avisos`, `canais: ${canaisTxt}`);
	const resumo = resumoParts.join(' · ');
	return (
		<div id="como-vai-funcionar-print" className="rounded-xl border border-[#dfe8ea] bg-white">
			<style>{`@media print { body * { visibility: hidden !important; } #como-vai-funcionar-print, #como-vai-funcionar-print * { visibility: visible !important; } #como-vai-funcionar-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
			<div className="flex w-full items-center justify-between gap-3 px-5 py-4">
				<button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
					<div className="min-w-0 flex-1">
						<span className="text-sm font-bold text-[#163943]">Como vai funcionar</span>
						<p className="mt-0.5 truncate text-[11px] text-slate-500">{resumo}</p>
					</div>
					<ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
				</button>
				{open && <button type="button" onClick={() => window.print()} className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[#0F4C5C] px-3 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]">Imprimir / PDF</button>}
			</div>
			{open && (
				<div className="border-t border-[#ecf0f1] p-5">
					<div className="grid gap-4 xl:grid-cols-2">
						<CardFaixaComo titulo="Cliente novo" passos={locPassos} ativo={locAtivo} faixaKey="localizacao" personas={personas} frasesPorId={frasesPorId} onIrParaDia={onIrParaDia} />
						<div className="rounded-xl border border-[#dfe8ea] bg-white p-4">
							<h3 className="mb-2 text-sm font-bold text-[#163943]">Deu CPC</h3>
							{!cpcAtivo ? <p className="text-xs text-[#9a631b]">Desligada neste segmento.</p> : (
								<div className="space-y-1.5 text-xs text-slate-600">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="rounded-full bg-[#e9a23b] px-2 py-0.5 text-[10px] font-semibold text-white">Canal do CPC (Hot)</span>
										{cpcOrdem.map((a, i) => (
											<span key={i} className="inline-flex items-center gap-1">
												<span className="text-slate-300">→</span>
												<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }}>{canalNome[a.canal] ?? a.canal}</span>
											</span>
										))}
									</div>
									<p>{tentCpc} tentativas por canal · CPC A a cada {intervaloCpa} dia{intervaloCpa > 1 ? 's' : ''} · CPC B a cada {intervaloCpb} dia{intervaloCpb > 1 ? 's' : ''}.</p>
									{cpcJunto.length > 0 && <p>Reforço: {cpcJunto.map(a => canalNome[a.canal] ?? a.canal).join(', ')}.</p>}
								</div>
							)}
						</div>
						<CardFaixaComo titulo="Não CPC" passos={giroPassos} ativo={giroAtivo} faixaKey="giro" personas={personas} frasesPorId={frasesPorId} onIrParaDia={onIrParaDia} />
						<CardFaixaComo titulo="Preventivo" passos={prevPassos} ativo={prevAtivo} faixaKey="preventivo" personas={personas} frasesPorId={frasesPorId} onIrParaDia={onIrParaDia} />
						<CardFaixaComo titulo="Quebra" passos={quebraPassos} ativo={quebraAtivo} faixaKey="quebra" personas={personas} frasesPorId={frasesPorId} onIrParaDia={onIrParaDia} />
				</div>
				</div>
			)}
		</div>
	);
}

function ResumoBloco({ titulo, linhas }: { titulo: string; linhas: string[] }) {
	return (
		<div>
			<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{titulo}</p>
			<ul className="space-y-1">
				{linhas.map((l, i) => <li key={i} className="text-xs leading-relaxed text-slate-600">{l}</li>)}
			</ul>
		</div>
	);
}

function InfoTooltip({ text }: { text: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="relative">
			<button type="button" onClick={() => setOpen(v => !v)} className="grid h-6 w-6 place-items-center rounded-full border border-[#c9dadd] text-xs font-bold text-[#0F4C5C] hover:bg-[#edf4f5]" aria-label="Como funciona">i</button>
			{open && (
				<>
					<button className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} aria-hidden />
					<div className="absolute left-0 top-8 z-30 w-72 rounded-lg border border-[#d8e3e5] bg-white p-3 text-[11px] leading-relaxed text-slate-600 shadow-lg">{text}</div>
				</>
			)}
		</div>
	);
}

function FraseDot({ status }: { status: 'nenhuma' | 'texto' | 'frase' | 'desativada' }) {
	if (status === 'nenhuma') return <span className="h-2.5 w-2.5 rounded-full bg-slate-200" title="Sem frase" />;
	if (status === 'desativada') return <span className="h-2.5 w-2.5 rounded-full bg-[#C62828]" title="Frase desativada" />;
	if (status === 'texto') return <span className="h-2.5 w-2.5 rounded-full bg-slate-400" title="Texto próprio" />;
	return <span className="h-2.5 w-2.5 rounded-full bg-[#0F4C5C]" title="Frase do playbook" />;
}

function CardResumo({ label, valor, cor = '#0F4C5C' }: { label: string; valor: number; cor?: string }) {
	return (
		<div className="rounded-lg border border-[#dfe8ea] bg-[#f7fafb] p-3">
			<p className="text-2xl font-bold" style={{ color: cor }}>{valor}</p>
			<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
		</div>
	);
}

function LinhaRaiaVisao({ nome, cor, dias, passos, lane, frasesPorId, faixaKey, onIrParaDesenhar }: { nome: string; cor: string; dias: number[]; passos: Passos; lane: string; frasesPorId: Map<string, Frase>; faixaKey: string; onIrParaDesenhar: (faixa: string, day: number | null) => void; }) {
	return (
		<div className="flex items-stretch gap-2">
			<div className="flex w-[140px] shrink-0 items-center gap-1.5 rounded-lg border bg-white px-3 py-2" style={{ borderColor: cor }}>
				<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
				<span className="truncate text-xs font-semibold text-[#163943]" title={nome}>{nome}</span>
			</div>
			{dias.map(d => {
				const arr = splitMultiPersona(passos[String(d)] ?? []);
				const acts = (lane === 'pub' ? acoesPublico(arr) : acoesPersona(arr, lane)).filter(a => a.canal !== 'sem_acao');
				return (
					<button key={d} type="button" onClick={() => onIrParaDesenhar(faixaKey, d)} className="flex w-[168px] shrink-0 flex-col items-start gap-1 rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-2 text-left hover:ring-1 hover:ring-[#0F4C5C]">
						{acts.length === 0 ? <span className="text-[10px] text-slate-300">—</span> : acts.map((a, i) => (
							<span key={i} className="flex w-full items-center gap-1">
								{i > 0 && <span className="text-[9px] font-semibold text-[#0F4C5C]">{MODO_LABEL[a.modo ?? 'senao']}</span>}
								<span className="truncate rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }}>{canalNome[a.canal] ?? a.canal}</span>
								<FraseDot status={mensagemStatus(a, frasesPorId)} />
							</span>
						))}
					</button>
				);
			})}
		</div>
	);
}

function LinhaFaixaVisao({ titulo, passos, ativo, desligadaMsg, faixaKey, personas, frasesPorId, onIrParaDesenhar }: { titulo: string; passos: Passos; ativo: boolean; desligadaMsg: string; faixaKey: string; personas: PersonaUsuario[]; frasesPorId: Map<string, Frase>; onIrParaDesenhar: (faixa: string, day: number | null) => void; }) {
	const dias = Object.keys(passos).map(Number).sort((a, b) => a - b);
	if (!ativo) return (
		<div className="rounded-xl border border-[#e2c9a0] bg-[#faf3e8] p-4">
			<h3 className="text-sm font-bold text-[#9a631b]">{titulo}</h3>
			<p className="mt-1 text-xs text-[#9a631b]">{desligadaMsg}</p>
		</div>
	);
	if (dias.length === 0) return (
		<div className="rounded-xl border border-[#dfe8ea] bg-white p-4">
			<h3 className="text-sm font-bold text-[#163943]">{titulo}</h3>
			<p className="mt-1 text-xs italic text-slate-400">Seguindo o padrão MotorCX.</p>
		</div>
	);
	const lanePersonas = personas.filter(p => Object.values(passos).some(arr => splitMultiPersona(arr).some(a => a.personas?.includes(p.id))));
	return (
		<div className="rounded-xl border border-[#dfe8ea] bg-white p-4">
			<h3 className="mb-3 text-sm font-bold text-[#163943]">{titulo}</h3>
			<div className="overflow-x-auto pb-2">
				<div className="inline-flex flex-col gap-2 min-w-max">
					<div className="flex gap-2">
						<div className="w-[140px] shrink-0" />
						{dias.map(d => <div key={d} className="w-[168px] shrink-0 text-center text-[11px] font-bold text-[#0F4C5C]">{diaLabel(d)}</div>)}
					</div>
					<LinhaRaiaVisao nome="Público geral" cor="#0F4C5C" dias={dias} passos={passos} lane="pub" frasesPorId={frasesPorId} faixaKey={faixaKey} onIrParaDesenhar={onIrParaDesenhar} />
					{lanePersonas.map(p => <LinhaRaiaVisao key={p.id} nome={p.nome} cor={p.cor} dias={dias} passos={passos} lane={p.id} frasesPorId={frasesPorId} faixaKey={faixaKey} onIrParaDesenhar={onIrParaDesenhar} />)}
				</div>
			</div>
		</div>
	);
}

function VisaoGeral({ def, personas, contadores, frasesPorId, locAtivo, cpcAtivo, giroAtivo, prevAtivo, quebraAtivo, ciclo, maxCiclos, tentCpc, intervaloCpa, intervaloCpb, cpcOrdem, cpcJunto, resumoLoc, resumoGiro, resumoPrev, resumoQuebra, quebraCarenciaFrase, quebraDesligadaFrase, cpcOrdemNomes, onIrParaDesenhar }: {
	def: Definicao; personas: PersonaUsuario[]; contadores: { diasComAcao: number; acoesSemFrase: number; avisos: number; canaisUsados: string[]; personasRaia: number };
	frasesPorId: Map<string, Frase>;
	locAtivo: boolean; cpcAtivo: boolean; giroAtivo: boolean; prevAtivo: boolean; quebraAtivo: boolean;
	ciclo: number; maxCiclos: number; tentCpc: number; intervaloCpa: number; intervaloCpb: number;
	cpcOrdem: Acao[]; cpcJunto: Acao[];
	resumoLoc: string[]; resumoGiro: string[]; resumoPrev: string[]; resumoQuebra: string[];
	quebraCarenciaFrase: string; quebraDesligadaFrase: string; cpcOrdemNomes: string;
	onIrParaDesenhar: (faixa: string, day: number | null) => void;
}) {
	const locPassos = normPassos(def.localizacao?.passos);
	const giroPassos = normPassos(def.giro?.passos);
	const prevPassos = normPassos(def.preventivo?.passos);
	const quebraPassos = normPassos(def.quebra?.passos);
	return (
		<div id="visao-geral-print" className="space-y-4 bg-white">
			<style>{`@media print { body * { visibility: hidden !important; } #visao-geral-print, #visao-geral-print * { visibility: visible !important; } #visao-geral-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
				<CardResumo label="Dias com ação" valor={contadores.diasComAcao} />
				<CardResumo label="Ações sem frase" valor={contadores.acoesSemFrase} cor={contadores.acoesSemFrase ? '#9a631b' : '#0F4C5C'} />
				<CardResumo label="Personas com raia" valor={contadores.personasRaia} />
				<CardResumo label="Avisos" valor={contadores.avisos} cor={contadores.avisos ? '#9a631b' : '#0F4C5C'} />
				<div className="rounded-lg border border-[#dfe8ea] bg-[#f7fafb] p-3">
					<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Canais usados</p>
					<div className="mt-1.5 flex flex-wrap gap-1">
						{contadores.canaisUsados.length === 0 ? <span className="text-[11px] text-slate-400">—</span> : contadores.canaisUsados.map(c => <span key={c} className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: canalCor[c] ?? '#475569' }}>{canalNome[c] ?? c}</span>)}
					</div>
				</div>
			</div>
			<div className="flex justify-end">
				<button type="button" onClick={() => window.print()} className="flex h-9 items-center gap-2 rounded-lg border border-[#0F4C5C] px-4 text-xs font-semibold text-[#0F4C5C] hover:bg-[#eaf2f3]">Imprimir / PDF</button>
			</div>
			<LinhaFaixaVisao titulo="Cliente novo · ainda não deu CPC" passos={locPassos} ativo={locAtivo} desligadaMsg="Desligada: clientes novos não recebem ação." faixaKey="localizacao" personas={personas} frasesPorId={frasesPorId} onIrParaDesenhar={onIrParaDesenhar} />
			<div className="rounded-xl border border-[#dfe8ea] bg-white p-4">
				<h3 className="mb-3 text-sm font-bold text-[#163943]">Deu CPC · CPC A e CPC B</h3>
				{!cpcAtivo ? <p className="text-xs text-[#9a631b]">Desligada: quem deu CPC não recebe ação.</p> : (
					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<span className="rounded-full bg-[#e9a23b] px-3 py-1 text-[11px] font-semibold text-white">★ Canal do CPC · contato principal</span>
							{cpcOrdem.map((a, i) => (
								<span key={i} className="inline-flex items-center gap-1">
									<span className="text-slate-300">→</span>
									<span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }}>{canalNome[a.canal] ?? a.canal}</span>
									<FraseDot status={mensagemStatus(a, frasesPorId)} />
								</span>
							))}
						</div>
						<p className="text-xs text-slate-600">Tentativas por canal: <strong>{tentCpc}</strong> · CPC A a cada <strong>{intervaloCpa}</strong> dia{intervaloCpa > 1 ? 's' : ''} · CPC B a cada <strong>{intervaloCpb}</strong> dia{intervaloCpb > 1 ? 's' : ''}.</p>
						{cpcJunto.length > 0 && (
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-[11px] font-semibold text-slate-500">Reforço junto:</span>
								{cpcJunto.map((a, i) => <span key={i} className="inline-flex items-center gap-1"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }}>{canalNome[a.canal] ?? a.canal}</span><FraseDot status={mensagemStatus(a, frasesPorId)} /></span>)}
							</div>
						)}
					</div>
				)}
			</div>
			<LinhaFaixaVisao titulo="Não CPC · ciclo que se repete" passos={giroPassos} ativo={giroAtivo} desligadaMsg="Desligada: clientes Não CPC não recebem ação." faixaKey="giro" personas={personas} frasesPorId={frasesPorId} onIrParaDesenhar={onIrParaDesenhar} />
			<LinhaFaixaVisao titulo="Preventivo" passos={prevPassos} ativo={prevAtivo} desligadaMsg="Desligado: clientes em acordo não recebem lembrete antes do vencimento." faixaKey="preventivo" personas={personas} frasesPorId={frasesPorId} onIrParaDesenhar={onIrParaDesenhar} />
			<LinhaFaixaVisao titulo="Quebra" passos={quebraPassos} ativo={quebraAtivo} desligadaMsg={quebraDesligadaFrase} faixaKey="quebra" personas={personas} frasesPorId={frasesPorId} onIrParaDesenhar={onIrParaDesenhar} />
			<div className="rounded-xl border border-[#dfe8ea] bg-white p-5">
				<h3 className="text-sm font-bold text-[#163943]">Como vai funcionar</h3>
				<div className="mt-3 space-y-3">
					{!locAtivo ? <ResumoBloco titulo="Cliente novo" linhas={['Desligada: clientes novos não recebem ação.']} /> : resumoLoc.length > 0 && <ResumoBloco titulo="Cliente novo" linhas={resumoLoc} />}
					{!cpcAtivo ? <ResumoBloco titulo="Deu CPC" linhas={['Desligada: quem deu CPC não recebe ação.']} /> : cpcOrdemNomes && <ResumoBloco titulo="Deu CPC" linhas={[`CPC A a cada ${intervaloCpa} dia${intervaloCpa > 1 ? 's' : ''}, CPC B a cada ${intervaloCpb} dia${intervaloCpb > 1 ? 's' : ''}. Canal do CPC no contato principal; depois de ${tentCpc} tentativas, troca na ordem ${cpcOrdemNomes}.`]} />}
					{!giroAtivo ? <ResumoBloco titulo="Não CPC" linhas={['Desligada: clientes Não CPC não recebem ação.']} /> : resumoGiro.length > 0 && <ResumoBloco titulo="Não CPC" linhas={[`Ciclo de ${ciclo} dias repetido ${maxCiclos} vezes; depois aguarda enriquecimento.`, ...resumoGiro]} />}
					{resumoPrev.length > 0 && prevAtivo && <ResumoBloco titulo="Preventivo" linhas={resumoPrev} />}
					{!prevAtivo && <ResumoBloco titulo="Preventivo" linhas={['Desligado: clientes em acordo não recebem lembrete antes do vencimento.']} />}
					{quebraAtivo ? (resumoQuebra.length > 0 || quebraCarenciaFrase) && <ResumoBloco titulo="Quebra" linhas={[...(quebraCarenciaFrase ? [quebraCarenciaFrase] : []), ...resumoQuebra]} /> : <ResumoBloco titulo="Quebra" linhas={[quebraDesligadaFrase]} />}
				</div>
			</div>
		</div>
	);
}

// ===================== Vista Fluxo =====================

const FLUXO_CONECTOR: Record<string, string> = {
	senao: '↳ senão · se nada acima foi',
	reserva: '↻ reserva · se o de cima não contatar no dia',
	sempre: 'e sempre · além do que foi acima',
	junto: '+ junto',
};

type FluxoNode = { kind: 'day'; day: number; acoes: Acao[]; personaDevs: { id: string; nome: string; cor: string; acoes: Acao[] }[] } | { kind: 'gap'; from: number; to: number };

function buildFluxoNodes(dias: number[], passos: Passos, personas: PersonaUsuario[]): FluxoNode[] {
	const nodes: FluxoNode[] = [];
	let gapStart: number | null = null;
	for (const d of dias) {
		const arr = splitMultiPersona(passos[String(d)] ?? []);
		const pub = acoesPublico(arr).filter(a => a.canal !== 'sem_acao');
		const personaDevs = personas.map(p => ({ id: p.id, nome: p.nome, cor: p.cor, acoes: acoesPersona(arr, p.id).filter(a => a.canal !== 'sem_acao') })).filter(pd => pd.acoes.length > 0);
		if (pub.length === 0 && personaDevs.length === 0) {
			if (gapStart === null) gapStart = d;
		} else {
			if (gapStart !== null) { nodes.push({ kind: 'gap', from: gapStart, to: d - 1 }); gapStart = null; }
			nodes.push({ kind: 'day', day: d, acoes: pub, personaDevs });
		}
	}
	return nodes;
}

function AcoesFluxo({ acoes, frasesPorId, onEditMsg }: { acoes: Acao[]; frasesPorId: Map<string, Frase>; onEditMsg: (index: number) => void }) {
	if (!acoes.length) return null;
	const groups: { conector: string | null; items: Acao[]; idx: number[] }[] = [];
	acoes.forEach((a, i) => {
		if (i === 0) { groups.push({ conector: null, items: [a], idx: [i] }); return; }
		if (a.modo === 'junto') { groups[groups.length - 1].items.push(a); groups[groups.length - 1].idx.push(i); }
		else { groups.push({ conector: a.modo ?? 'senao', items: [a], idx: [i] }); }
	});
	return (
		<div className="space-y-1.5">
			{groups.map((g, gi) => (
				<div key={gi} className={gi === 0 ? '' : 'ml-3 border-l-[1.5px] border-[var(--base-borda)] pl-2'}>
					{gi > 0 && g.conector && (
						<span className="inline-block rounded-full bg-[var(--base-fill)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--base-texto-2)]">{FLUXO_CONECTOR[g.conector] ?? g.conector}</span>
					)}
					<div className="mt-1 flex flex-wrap items-center gap-2">
						{g.items.map((a, ii) => {
							const cor = canalCor[a.canal] ?? '#475569';
							const tipo = canalTipoMensagem(a.canal);
							const idx = g.idx[ii];
							const isFirst = gi === 0 && ii === 0;
							const mStatus = mensagemStatus(a, frasesPorId);
							return (
								<span key={ii} className="inline-flex items-center gap-1.5">
									<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cor }} />
									<span className={isFirst ? 'text-[12px] font-bold text-[var(--base-texto)]' : 'text-[11.5px] font-semibold text-[var(--base-texto)]'}>{canalNome[a.canal] ?? a.canal}</span>
									{tipo !== 'nenhuma' && (
										<button type="button" onClick={e => { e.stopPropagation(); onEditMsg(idx); }} title={mensagemLabel(a, frasesPorId) || (tipo === 'template' ? 'Sem template' : 'Sem frase')} className={`grid h-4 w-4 place-items-center rounded-full ${mStatus === 'desativada' ? 'bg-[#C62828] text-white' : mStatus !== 'nenhuma' ? 'bg-[var(--base-fill)] text-[var(--base-texto-2)]' : 'border border-[var(--base-borda)] text-[var(--base-texto-3)]'}`}>
											<MessageCircle size={9} strokeWidth={2.5} />
										</button>
									)}
								</span>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

function FluxoSaidas({ linhas }: { linhas: string[] }) {
	if (!linhas.length) return null;
	return (
		<li className="relative">
			<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-[var(--area)]" />
			<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] p-3">
				<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Saídas deste momento</p>
				<ul className="space-y-1">
					{linhas.map((l, i) => <li key={i} className="text-xs text-[var(--base-texto-2)]">{l}</li>)}
				</ul>
			</div>
		</li>
	);
}

function CaminhoDias({ track, passos, dias, ativo, desligadoResumo, entryLabel, entryNote, saidas, personas, frasesPorId, canEdit, onOpenQuadro, onEditMensagem }: {
	track: Track; passos: Passos; dias: number[]; ativo: boolean; desligadoResumo: string; entryLabel: string; entryNote?: string; saidas: string[];
	personas: PersonaUsuario[]; frasesPorId: Map<string, Frase>; canEdit: boolean;
	onOpenQuadro: (track: Track, day: number, lane: string) => void;
	onEditMensagem: (track: Track, day: number, lane: string, index: number) => void;
}) {
	if (!ativo) {
		return (
			<div className="rounded-xl border border-[#e2c9a0] bg-[#faf3e8] p-4">
				<h3 className="text-sm font-bold text-[#9a631b]">{entryLabel}</h3>
				<p className="mt-1 text-xs text-[#9a631b]">{desligadoResumo}</p>
			</div>
		);
	}
	const nodes = buildFluxoNodes(dias, passos, personas);
	const lanePersonas = personas.filter(p => Object.values(passos).some(arr => splitMultiPersona(arr).some(a => a.personas?.includes(p.id))));
	const em = (day: number) => (lane: string, index: number) => onEditMensagem(track, day, lane, index);
	return (
		<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4">
			<h3 className="mb-3 text-sm font-bold text-[var(--base-texto)]">{entryLabel}</h3>
			{entryNote && <p className="mb-3 text-xs text-[var(--base-texto-2)]">{entryNote}</p>}
			<ol className="relative space-y-3 border-l-2 border-[var(--base-borda)] pl-5">
				<li className="relative">
					<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-[var(--area)]" />
					<div className="rounded-lg bg-[var(--base-fill)] px-3 py-1.5 text-xs font-bold text-[var(--base-texto)]">Entra em {entryLabel}</div>
				</li>
				{nodes.map((n, ni) => {
					if (n.kind === 'gap') {
						return (
							<li key={ni} className="relative">
								<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-dashed border-[var(--base-texto-3)] bg-[var(--base-cartao)]" />
								<div className="rounded-lg border border-dashed border-[var(--base-borda)] bg-[var(--base-fill)] px-3 py-2 text-xs font-medium text-[var(--base-texto-3)]">Dias {diaLabel(n.from)}–{diaLabel(n.to)} sem ação</div>
							</li>
						);
					}
					const e = em(n.day);
					return (
						<li key={ni} className="relative">
							<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--area)] bg-[var(--base-cartao)]" />
							<div role="button" tabIndex={0} onClick={() => onOpenQuadro(track, n.day, 'pub')} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpenQuadro(track, n.day, 'pub'); } }} className="cursor-pointer rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3 transition hover:border-[var(--area)]">
								<div className="mb-2 flex items-center gap-2">
									<span className="text-[11px] font-bold text-[var(--base-texto)]">Dia {n.day}</span>
									<span className="rounded bg-[var(--base-fill)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--base-texto-2)]">{diaLabel(n.day)}</span>
								</div>
								{n.acoes.length > 0 ? (
									<AcoesFluxo acoes={n.acoes} frasesPorId={frasesPorId} onEditMsg={i => e('pub', i)} />
								) : (
									<p className="text-[10px] italic text-[var(--base-texto-3)]">só personas — o público geral segue o padrão</p>
								)}
								{n.personaDevs.map(pd => (
									<div key={pd.id} role="button" tabIndex={0} onClick={ev => { ev.stopPropagation(); onOpenQuadro(track, n.day, pd.id); }} onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); onOpenQuadro(track, n.day, pd.id); } }} className="mt-2 cursor-pointer rounded-lg border border-dashed border-[var(--base-borda)] bg-[var(--base-fill)] p-2 transition hover:border-[var(--area)]">
										<div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--base-texto-2)]"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: pd.cor }} />Persona {pd.nome} →</div>
										<div className="mt-1"><AcoesFluxo acoes={pd.acoes} frasesPorId={frasesPorId} onEditMsg={i => e(pd.id, i)} /></div>
									</div>
								))}
							</div>
						</li>
					);
				})}
				<FluxoSaidas linhas={saidas} />
			</ol>
			{lanePersonas.length > 0 && (
				<p className="mt-3 text-xs text-[var(--base-texto-2)]">{lanePersonas.map(p => p.nome).join(', ')}: nos outros dias, segue o geral.</p>
			)}
		</div>
	);
}

function FluxoCpc({ ativo, cpcOrdem, cpcJunto, tentCpc, intervaloCpa, intervaloCpb, onIrParaRaias }: {
	ativo: boolean; cpcOrdem: Acao[]; cpcJunto: Acao[]; tentCpc: number; intervaloCpa: number; intervaloCpb: number; onIrParaRaias: () => void;
}) {
	return (
		<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h3 className="text-sm font-bold text-[var(--base-texto)]">Deu CPC · CPC A e CPC B</h3>
				<button type="button" onClick={onIrParaRaias} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--base-borda)] px-3 text-xs font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)]">Editar nas raias</button>
			</div>
			{!ativo ? (
				<p className="text-xs text-[#9a631b]">Desligada: quem deu CPC não recebe ação.</p>
			) : (
				<ol className="relative space-y-3 border-l-2 border-[var(--base-borda)] pl-5">
					<li className="relative">
						<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full bg-[var(--area)]" />
						<div className="rounded-lg bg-[var(--base-fill)] px-3 py-1.5 text-xs font-bold text-[var(--base-texto)]">Canal do CPC · contato principal</div>
					</li>
					<li className="relative">
						<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--area)] bg-[var(--base-cartao)]" />
						<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3">
							<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Ordem de reserva</p>
							<div className="flex flex-wrap items-center gap-1.5">
								{cpcOrdem.length === 0 ? <span className="text-[11px] italic text-[var(--base-texto-3)]">Só o canal do CPC</span> : cpcOrdem.map((a, i) => (
									<span key={i} className="inline-flex items-center gap-1">
										{i > 0 && <span className="text-[var(--base-texto-3)]">→</span>}
										<span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }}><span className="h-2 w-2 rounded-full bg-white/70" />{canalNome[a.canal] ?? a.canal}</span>
									</span>
								))}
							</div>
						</div>
					</li>
					<li className="relative">
						<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--area)] bg-[var(--base-cartao)]" />
						<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3 text-xs text-[var(--base-texto-2)]">CPC A a cada <strong className="text-[var(--base-texto)]">{intervaloCpa}</strong> dia{intervaloCpa > 1 ? 's' : ''}</div>
					</li>
					<li className="relative">
						<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--area)] bg-[var(--base-cartao)]" />
						<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3 text-xs text-[var(--base-texto-2)]">CPC B a cada <strong className="text-[var(--base-texto)]">{intervaloCpb}</strong> dia{intervaloCpb > 1 ? 's' : ''}</div>
					</li>
					<li className="relative">
						<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--area)] bg-[var(--base-cartao)]" />
						<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3 text-xs text-[var(--base-texto-2)]"><strong className="text-[var(--base-texto)]">{tentCpc}</strong> tentativas por canal antes de trocar</div>
					</li>
					{cpcJunto.length > 0 && (
						<li className="relative">
							<span className="absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-[var(--area)] bg-[var(--base-cartao)]" />
							<div className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-cartao)] p-3">
								<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--base-texto-3)]">Reforço junto</p>
								<div className="flex flex-wrap items-center gap-1.5">
									{cpcJunto.map((a, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: canalCor[a.canal] ?? '#475569' }}>{canalNome[a.canal] ?? a.canal}</span>)}
								</div>
							</div>
						</li>
					)}
					<FluxoSaidas linhas={['sem resposta → CPC B', 'esgotou os canais → Não CPC']} />
				</ol>
			)}
		</div>
	);
}

function FluxoView({ def, setDef, canEdit, personas, frasesPorId, onEditMensagem, onIrParaRaias }: {
	def: Definicao; setDef: (d: Definicao) => void; canEdit: boolean; personas: PersonaUsuario[]; frasesPorId: Map<string, Frase>;
	onEditMensagem: (track: Track, day: number, lane: string, index: number) => void;
	onIrParaRaias: (faixaKey: string) => void;
}) {
	const [faixa, setFaixa] = useState<'localizacao' | 'cpc' | 'giro' | 'acordo'>('localizacao');
	const [quadro, setQuadro] = useState<{ track: Track; day: number; lane: string } | null>(null);

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
	const cpcJunto = (def.cpc?.junto ?? []).filter(a => a.canal);
	const locAtivo = def.localizacao?.ativo !== false;
	const cpcAtivo = def.cpc?.ativo !== false;
	const giroAtivo = def.giro?.ativo !== false;
	const prevAtivo = def.preventivo?.ativo !== false;
	const quebraAtivo = def.quebra?.ativo !== false;
	const carencia = def.quebra?.carencia ?? 0;
	const diasEstoque = def.quebra?.dias_para_estoque ?? 6;
	const diasLoc = Array.from({ length: Math.max(1, ncp - 1) }, (_, i) => i + 1);
	const diasGiro = Array.from({ length: Math.max(1, ciclo) }, (_, i) => i + 1);
	const diasPrev = Object.keys(prevPassos).map(Number).filter(d => d <= 0).sort((a, b) => a - b);
	const diasQuebra = Object.keys(quebraPassos).map(Number).filter(d => d > 0).sort((a, b) => a - b);

	const resumoLoc = !locAtivo ? 'Desligada' : [diasResumo(locPassos, 'D+'), `vira Não CPC no D+${ncp}`].filter(Boolean).join(' · ') || '—';
	const resumoCpc = !cpcAtivo ? 'Desligada' : `CPC A a cada ${intervaloCpa}d · CPC B a cada ${intervaloCpb}d · ${tentCpc} tentativas`;
	const resumoGiro = !giroAtivo ? 'Desligada' : [`Ciclo de ${ciclo} dias × ${maxCiclos}`, diasResumo(giroPassos, 'G-dia')].filter(Boolean).join(' · ');
	const prevLbl = Object.keys(prevPassos).map(d => diaLabel(Number(d))).join(', ');
	const quebraLbl = Object.keys(quebraPassos).map(d => diaLabel(Number(d))).join(', ');
	const resumoAcordo = `${prevAtivo ? `Preventivo ${prevLbl || '—'}` : 'Preventivo desligado'} · ${quebraAtivo ? `Quebra ${quebraLbl || '—'}` : 'Quebra desligada'}`;

	const FAIXAS = [
		{ id: 'localizacao' as const, label: 'Cliente novo', resumo: resumoLoc },
		{ id: 'cpc' as const, label: 'Deu CPC', resumo: resumoCpc },
		{ id: 'giro' as const, label: 'Não CPC', resumo: resumoGiro },
		{ id: 'acordo' as const, label: 'Acordo', resumo: resumoAcordo },
	];

	const saidasLoc = ['contato → Deu CPC', `D+${ncp} sem CPC → Não CPC`];
	const saidasGiro = ['contato → Deu CPC', 'ao fim dos ciclos, espera novo enriquecimento'];
	const saidasPrev = ['parcela vence sem pagamento → entra na Quebra'];
	const saidasQuebra = [`quebra sem pagamento → volta ao estoque como CPC A em ${diasEstoque} dias${carencia > 0 ? ` (a partir do D+${carencia + 1})` : ''}`];

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap gap-2">
				{FAIXAS.map(f => {
					const active = faixa === f.id;
					return (
						<button key={f.id} type="button" onClick={() => setFaixa(f.id)} className={`flex-1 rounded-lg border px-3 py-2 text-left transition ${active ? 'border-transparent text-[var(--base-cartao)]' : 'border-[var(--base-borda)] bg-[var(--base-cartao)] text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]'}`} style={active ? { backgroundColor: 'var(--base-texto)' } : undefined}>
							<span className="block text-xs font-bold">{f.label}</span>
							<span className={`mt-0.5 block truncate text-[10px] ${active ? 'text-[var(--base-cartao)] opacity-80' : 'text-[var(--base-texto-3)]'}`}>{f.resumo}</span>
						</button>
					);
				})}
			</div>

			{faixa === 'localizacao' && (
				<CaminhoDias track="localizacao" passos={locPassos} dias={diasLoc} ativo={locAtivo} desligadoResumo="Clientes novos não recebem ação." entryLabel="Cliente novo" saidas={saidasLoc} personas={personas} frasesPorId={frasesPorId} canEdit={canEdit} onOpenQuadro={(t, d, l) => setQuadro({ track: t, day: d, lane: l })} onEditMensagem={onEditMensagem} />
			)}
			{faixa === 'cpc' && (
				<FluxoCpc ativo={cpcAtivo} cpcOrdem={cpcOrdem} cpcJunto={cpcJunto} tentCpc={tentCpc} intervaloCpa={intervaloCpa} intervaloCpb={intervaloCpb} onIrParaRaias={() => onIrParaRaias('cpc')} />
			)}
			{faixa === 'giro' && (
				<CaminhoDias track="giro" passos={giroPassos} dias={diasGiro} ativo={giroAtivo} desligadoResumo="Clientes Não CPC não recebem ação." entryLabel="Não CPC" entryNote={`Ciclo de ${ciclo} dias, repetido ${maxCiclos} vezes.`} saidas={saidasGiro} personas={personas} frasesPorId={frasesPorId} canEdit={canEdit} onOpenQuadro={(t, d, l) => setQuadro({ track: t, day: d, lane: l })} onEditMensagem={onEditMensagem} />
			)}
			{faixa === 'acordo' && (
				<div className="space-y-4">
					<CaminhoDias track="preventivo" passos={prevPassos} dias={diasPrev} ativo={prevAtivo} desligadoResumo="Clientes em acordo não recebem lembrete antes do vencimento." entryLabel="Preventivo" saidas={saidasPrev} personas={personas} frasesPorId={frasesPorId} canEdit={canEdit} onOpenQuadro={(t, d, l) => setQuadro({ track: t, day: d, lane: l })} onEditMensagem={onEditMensagem} />
					<CaminhoDias track="quebra" passos={quebraPassos} dias={diasQuebra} ativo={quebraAtivo} desligadoResumo={`Acordo quebrado não recebe ação e volta ao estoque como CPC A em ${diasEstoque} dias${carencia > 0 ? ` (a partir do D+${carencia + 1})` : ''}.`} entryLabel="Quebra" saidas={saidasQuebra} personas={personas} frasesPorId={frasesPorId} canEdit={canEdit} onOpenQuadro={(t, d, l) => setQuadro({ track: t, day: d, lane: l })} onEditMensagem={onEditMensagem} />
				</div>
			)}

			<p className="rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] px-4 py-3 text-xs text-[var(--base-texto-2)]">As faixas de segurança valem sempre: 08:00–20:00, intervalo mínimo de 12 h, freio do WhatsApp até 5%.</p>

			{quadro && (
				<QuadroCelula track={quadro.track} day={quadro.day} lane={quadro.lane} def={def} setDef={setDef} canEdit={canEdit} personas={personas} frasesPorId={frasesPorId} onEditMensagem={(d, l, i) => onEditMensagem(quadro.track, d, l, i)} onClose={() => setQuadro(null)} />
			)}
		</div>
	);
}
