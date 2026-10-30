import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CANAL_COR, CANAL_NOME, SIT_LOTE, agoraSP, type LoteMensageria } from '@/lib/mensageria';
import { numberBR } from '@/lib/supabase';

const cardShadow = '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)';

export type AcaoLote = 'aprovar' | 'pausar' | 'retomar' | 'cancelar';

function CanalPill({ canal }: { canal: string }) {
	const cor = CANAL_COR[canal] ?? '#8E8E93';
	const nome = CANAL_NOME[canal] ?? canal;
	return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-white" style={{ backgroundColor: cor }}>{nome}</span>;
}

function SeloSituacao({ situacao }: { situacao: string }) {
	const s = SIT_LOTE[situacao] ?? { label: situacao, cor: '#6E6E73', bg: '#F5F5F7' };
	return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: s.cor, backgroundColor: s.bg }}>{s.label}</span>;
}

function Progresso({ lote }: { lote: LoteMensageria }) {
	const pct = lote.total > 0 ? Math.min(100, Math.round(((lote.enviadas + lote.bloqueadas) / lote.total) * 100)) : 0;
	return (
		<div className="mt-3">
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EEEEF0]">
				<div className="h-full rounded-full bg-[#0A60D0] transition-all" style={{ width: `${pct}%` }} />
			</div>
			<div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] tnum text-[#1D1D1F]">
				<span><span className="text-[#8E8E93]">Total </span>{numberBR(lote.total)}</span>
				<span><span className="text-[#8E8E93]">Enviadas </span>{numberBR(lote.enviadas)}</span>
				<span><span className="text-[#8E8E93]">Entregues </span>{numberBR(lote.entregues)}</span>
				<span><span className="text-[#8E8E93]">Não entregues </span>{numberBR(lote.falhas)}</span>
				<span><span className="text-[#8E8E93]">Descadastros </span>{numberBR(lote.descadastros)}</span>
				<span><span className="text-[#8E8E93]">Respostas </span>{numberBR(lote.respostas)}</span>
				<span><span className="text-[#8E8E93]">Bloqueadas </span>{numberBR(lote.bloqueadas)}</span>
			</div>
			{lote.canal === 'sms' && <p className="mt-1 text-[12px] text-[#8E8E93]">Respostas são cobradas pelo preço do SMS.</p>}
			{lote.canal === 'rcs' && <p className="mt-1 text-[12px] text-[#8E8E93]">Com agente conversacional, quem responde abre uma sessão de 24 h.</p>}
		</div>
	);
}

function Botao({ onClick, disabled, children, primario, perigo }: { onClick: () => void; disabled?: boolean; children: ReactNode; primario?: boolean; perigo?: boolean }) {
	const cls = primario
		? 'bg-[#1D1D1F] text-white hover:opacity-85'
		: perigo
			? 'border border-[#FF3B30] text-[#FF3B30] hover:bg-[#FFE8E6]'
			: 'border border-[#D2D2D7] text-[#1D1D1F] hover:bg-[#F5F5F7]';
	return (
		<button onClick={onClick} disabled={disabled} className={`h-9 rounded-full px-4 text-[14px] font-medium disabled:opacity-50 ${cls}`}>{children}</button>
	);
}

/** Card completo do lote, com ações (usado na aba Hoje). */
export function LoteCard({ lote, canAct, busyId, onAction }: {
	lote: LoteMensageria;
	canAct: boolean;
	busyId: string | null;
	onAction: (id: string, acao: AcaoLote) => void;
}) {
	const [confirmCancel, setConfirmCancel] = useState(false);
	const sit = lote.situacao;
	const busy = busyId === lote.id;
	const antesJanela = !!lote.janela_inicio && agoraSP() < lote.janela_inicio;

	function acao(acao: AcaoLote) { onAction(lote.id, acao); }

	return (
		<div className="rounded-2xl bg-white p-5" style={{ boxShadow: cardShadow }}>
			<div className="flex flex-wrap items-center gap-2">
				<CanalPill canal={lote.canal} />
				{lote.credor_nome && <span className="text-[14px] font-medium text-[#1D1D1F]">{lote.credor_nome}</span>}
				<SeloSituacao situacao={sit} />
				{lote.janela_inicio && lote.janela_fim && (
					<span className="text-[13px] text-[#6E6E73]">Janela {lote.janela_inicio}–{lote.janela_fim}</span>
				)}
			</div>

			<Progresso lote={lote} />

			{lote.motivo && <p className="mt-2 text-[13px] text-[#6E6E73]">{lote.motivo}</p>}

			{canAct && !confirmCancel && (
				<div className="mt-4 flex flex-wrap items-center gap-2">
					{sit === 'aguardando_aprovacao' && (<>
						<Botao primario disabled={busy} onClick={() => acao('aprovar')}>Aprovar envio</Botao>
						<Botao perigo disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar</Botao>
					</>)}
					{sit === 'agendado' && (<>
						<Botao disabled={busy} onClick={() => acao('pausar')}>Pausar</Botao>
						<Botao perigo disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar</Botao>
						{antesJanela && <span className="text-[13px] text-[#6E6E73]">Sai a partir das {lote.janela_inicio}</span>}
					</>)}
					{sit === 'enviando' && (
						<Botao disabled={busy} onClick={() => acao('pausar')}>Pausar</Botao>
					)}
					{sit === 'pausado' && (<>
						<Botao primario disabled={busy} onClick={() => acao('retomar')}>Retomar</Botao>
						<Botao perigo disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar</Botao>
					</>)}
				</div>
			)}

			{confirmCancel && (
				<div className="mt-4 rounded-xl bg-[#FFF8E1] px-4 py-3" style={{ border: '1px solid #FFE08A' }}>
					<p className="text-[14px] text-[#9a631b]">As mensagens que ainda não saíram não serão enviadas.</p>
					<div className="mt-3 flex gap-2">
						<Botao perigo disabled={busy} onClick={() => { setConfirmCancel(false); acao('cancelar'); }}>Cancelar envio</Botao>
						<Botao disabled={busy} onClick={() => setConfirmCancel(false)}>Voltar</Botao>
					</div>
				</div>
			)}
		</div>
	);
}

/** Linha resumida e clicável do lote (usada na aba Lotes). */
export function LoteRow({ lote }: { lote: LoteMensageria }) {
	const pct = lote.total > 0 ? Math.min(100, Math.round(((lote.enviadas + lote.bloqueadas) / lote.total) * 100)) : 0;
	return (
		<Link to={`/mensageria/${lote.canal}/lotes/${lote.id}`} className="block rounded-2xl bg-white p-4 transition hover:-translate-y-0.5" style={{ boxShadow: cardShadow }}>
			<div className="flex flex-wrap items-center gap-2">
				<CanalPill canal={lote.canal} />
				{lote.credor_nome && <span className="text-[14px] font-medium text-[#1D1D1F]">{lote.credor_nome}</span>}
				<SeloSituacao situacao={lote.situacao} />
				{lote.janela_inicio && lote.janela_fim && (
					<span className="text-[13px] text-[#6E6E73]">Janela {lote.janela_inicio}–{lote.janela_fim}</span>
				)}
				{lote.respostas > 0 && <span className="text-[13px] text-[#8E8E93] tnum">Respostas {numberBR(lote.respostas)}</span>}
				<span className="ml-auto text-[13px] text-[#8E8E93] tnum">{numberBR(lote.enviadas)}/{numberBR(lote.total)}</span>
			</div>
			<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#EEEEF0]">
				<div className="h-full rounded-full bg-[#0A60D0]" style={{ width: `${pct}%` }} />
			</div>
		</Link>
	);
}
