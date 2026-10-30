import { useMotorAuth } from '@/components/auth-provider';
import { supabase, friendlyError, type Row } from '@/lib/supabase';
import { SUGESTOES, stableEqual, type Discagem, type LigacoesInfo } from '@/lib/discagem';
import { SectionCard, NumberField, Toggle, TravaAviso } from './discagem-campos';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { DiscagemProps } from '@/lib/discagem';

type Props = DiscagemProps & { ligacoes: LigacoesInfo };

export function Renitencia({ draft, update, reverter, canEdit, ligacoes }: Props) {
	const cc = draft.chamadas_curtas ?? SUGESTOES.chamadas_curtas!;
	const dn = draft.descanso_nao_atende ?? SUGESTOES.descanso_nao_atende!;
	const dr = draft.descanso_recusa ?? SUGESTOES.descanso_recusa!;
	const ps = draft.promessa_suspende ?? SUGESTOES.promessa_suspende!;
	const inx = draft.inexistente ?? SUGESTOES.inexistente!;
	const nl = draft.nao_ligar ?? SUGESTOES.nao_ligar!;

	const travas = ligacoes;
	const travasTcd = travas.tentativas_cliente_dia;
	const travasTnd = travas.tentativas_numero_dia;
	const travasImm = travas.intervalo_min_minutos;
	const travasIom = travas.intervalo_ocupado_minutos;

	function confirmarDesligar(msg: string, onOk: () => void) {
		if (!canEdit) return;
		if (window.confirm('Recomendamos manter ligado. Desligar mesmo assim?')) onOk();
	}

	return (
		<div className="space-y-4">
			<SectionCard title="Tentativas no dia" ajustado={!stableEqual(draft.tentativas_numero_dia, SUGESTOES.tentativas_numero_dia) || !stableEqual(draft.tentativas_cliente_dia ?? undefined, undefined)} onReverter={() => { reverter('tentativas_numero_dia'); reverter('tentativas_cliente_dia'); }} canEdit={canEdit}>
				<div className="grid gap-4 sm:grid-cols-2">
					<NumberField label="Por número" value={draft.tentativas_numero_dia ?? ''} min={1} max={10} disabled={!canEdit || !!travasTnd} sugestao="2" onChange={v => update({ tentativas_numero_dia: v === '' ? undefined : v })} />
					<NumberField label="Por cliente" value={draft.tentativas_cliente_dia ?? ''} min={1} max={10} disabled={!canEdit || !!travasTcd} sugestao="vazio = as da estratégia" hint={travasTcd ? undefined : 'Vazio usa as tentativas por dia da estratégia.'} onChange={v => update({ tentativas_cliente_dia: v === '' ? null : v })} />
				</div>
				{travasTnd && <TravaAviso>Nas estratégias {travasTnd.nomes.join(', ')} vale a trava ({travasTnd.valor}).</TravaAviso>}
				{travasTcd && <TravaAviso>Nas estratégias {travasTcd.nomes.join(', ')} vale a trava ({travasTcd.valor}).</TravaAviso>}
			</SectionCard>

			<SectionCard title="Intervalo mínimo entre tentativas" ajustado={!stableEqual(draft.intervalo_min_minutos, SUGESTOES.intervalo_min_minutos) || !stableEqual(draft.intervalo_ocupado_minutos, SUGESTOES.intervalo_ocupado_minutos)} onReverter={() => { reverter('intervalo_min_minutos'); reverter('intervalo_ocupado_minutos'); }} canEdit={canEdit}>
				<div className="grid gap-4 sm:grid-cols-2">
					<NumberField label="Entre tentativas" value={draft.intervalo_min_minutos ?? ''} min={0} max={1440} suffix="min" disabled={!canEdit || !!travasImm} sugestao="120" onChange={v => update({ intervalo_min_minutos: v === '' ? undefined : v })} />
					<NumberField label="Depois de ocupado" value={draft.intervalo_ocupado_minutos ?? ''} min={0} max={1440} suffix="min" disabled={!canEdit || !!travasIom} sugestao="15" onChange={v => update({ intervalo_ocupado_minutos: v === '' ? undefined : v })} />
				</div>
				{travasImm && <TravaAviso>Nas estratégias {travasImm.nomes.join(', ')} vale a trava ({travasImm.valor} min).</TravaAviso>}
				{travasIom && <TravaAviso>Nas estratégias {travasIom.nomes.join(', ')} vale a trava ({travasIom.valor} min).</TravaAviso>}
			</SectionCard>

			<SectionCard title="Descanso depois de vários “não atende”" ajustado={!stableEqual(dn, SUGESTOES.descanso_nao_atende)} onReverter={() => reverter('descanso_nao_atende')} canEdit={canEdit}>
				<div className="flex items-center gap-2">
					<Toggle checked={dn.ativo} disabled={!canEdit} label="Descanso não atende" onChange={v => update({ descanso_nao_atende: { ...dn, ativo: v } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">{dn.ativo ? 'Ligado' : 'Desligado (sugestão)'}</span>
				</div>
				{dn.ativo && (
					<div className="mt-3 grid gap-4 sm:grid-cols-3">
						<NumberField label="N tentativas" value={dn.n} min={1} max={50} disabled={!canEdit} sugestao="6" onChange={v => update({ descanso_nao_atende: { ...dn, n: v === '' ? 1 : v } })} />
						<NumberField label="Em até X dias" value={dn.em_dias} min={1} max={60} disabled={!canEdit} sugestao="3" onChange={v => update({ descanso_nao_atende: { ...dn, em_dias: v === '' ? 1 : v } })} />
						<NumberField label="Descansa Y dias" value={dn.descansa_dias} min={1} max={365} disabled={!canEdit} sugestao="7" onChange={v => update({ descanso_nao_atende: { ...dn, descansa_dias: v === '' ? 1 : v } })} />
					</div>
				)}
			</SectionCard>

			<SectionCard title="Recusa" ajustado={!stableEqual(dr, SUGESTOES.descanso_recusa)} onReverter={() => reverter('descanso_recusa')} canEdit={canEdit}>
				<div className="flex items-center gap-2">
					<Toggle checked={dr.ativo} disabled={!canEdit} label="Recusa" onChange={v => update({ descanso_recusa: { ...dr, ativo: v } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">Descanso da voz por N dias</span>
				</div>
				{dr.ativo && <div className="mt-3"><NumberField label="Dias de descanso" value={dr.dias} min={1} max={365} suffix="dias" disabled={!canEdit} sugestao="7" onChange={v => update({ descanso_recusa: { ...dr, dias: v === '' ? 1 : v } })} /></div>}
			</SectionCard>

			<SectionCard title="Promessa" ajustado={!stableEqual(ps, SUGESTOES.promessa_suspende)} onReverter={() => reverter('promessa_suspende')} canEdit={canEdit}>
				<p className="mb-3 text-[12px] text-[var(--base-texto-3)]">Promessa é CPC, não é pagamento.</p>
				<div className="flex items-center gap-2">
					<Toggle checked={ps.ativo} disabled={!canEdit} label="Promessa" onChange={v => update({ promessa_suspende: { ...ps, ativo: v } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">Voz suspensa até a data prometida + 1; sem data, N dias</span>
				</div>
				{ps.ativo && <div className="mt-3"><NumberField label="Dias sem data" value={ps.dias_sem_data} min={1} max={90} suffix="dias" disabled={!canEdit} sugestao="7" onChange={v => update({ promessa_suspende: { ...ps, dias_sem_data: v === '' ? 1 : v } })} /></div>}
			</SectionCard>

			<SectionCard title="Bloqueio de número inexistente" ajustado={!stableEqual(inx, SUGESTOES.inexistente)} onReverter={() => reverter('inexistente')} canEdit={canEdit}>
				<div className="flex items-center gap-2">
					<Toggle checked={inx.ativo} disabled={!canEdit} label="Inexistente" onChange={v => { if (!v) confirmarDesligar('', () => update({ inexistente: { ativo: false } })); else update({ inexistente: { ativo: true } }); }} />
					<span className="text-[13px] text-[var(--base-texto-2)]">Recomendado ligado</span>
				</div>
			</SectionCard>

			<SectionCard title="Lista “não ligar”" ajustado={!stableEqual(nl, SUGESTOES.nao_ligar)} onReverter={() => reverter('nao_ligar')} canEdit={canEdit}>
				<div className="flex items-center gap-2">
					<Toggle checked={nl.ativo} disabled={!canEdit} label="Não ligar" onChange={v => { if (!v) confirmarDesligar('', () => update({ nao_ligar: { ativo: false } })); else update({ nao_ligar: { ativo: true } }); }} />
					<span className="text-[13px] text-[var(--base-texto-2)]">Recomendado ligado</span>
				</div>
			</SectionCard>
		</div>
	);
}
