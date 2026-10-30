import { useState } from 'react';
import { toast } from 'sonner';
import { SUGESTOES, PREVIA_UFS, PREVIA_DDDS, UF_DDD_PREVIA, UFS, DDDS_VALIDOS, stableEqual, type Discagem, type JanelaHorario, type HorariosTabela } from '@/lib/discagem';
import { SectionCard, Toggle, CaixaInfo } from './discagem-campos';
import type { DiscagemProps } from '@/lib/discagem';
import { filtrarAlertas, type DiscagemExecResumo } from '@/lib/discagem';

type Props = DiscagemProps & { exec: { resumo: DiscagemExecResumo | null; alertas: string[] } | null };

export function Horarios({ draft, update, reverter, canEdit, exec }: Props) {
	const h = draft.horarios ?? SUGESTOES.horarios!;
	const tabela = h.tabela ?? null;
	const ufsT = tabela?.ufs ?? {};
	const dddsT = tabela?.ddds ?? {};
	const alertas = filtrarAlertas(exec?.alertas, ['HORÁRIO POR UF/DDD:']);

	const ufsEfetivas = new Set<string>([...Object.keys(PREVIA_UFS), ...Object.keys(ufsT)]);
	const dddsEfetivos = new Set<string>([...Object.keys(PREVIA_DDDS), ...Object.keys(dddsT)]);

	function janelaEfetiva(tipo: 'ufs' | 'ddds', key: string): JanelaHorario {
		const t = tipo === 'ufs' ? ufsT : dddsT;
		const prev = tipo === 'ufs' ? PREVIA_UFS[key] : PREVIA_DDDS[key];
		return t[key] ?? prev ?? { seg_sex: null, sabado: null };
	}
	function isAjustado(tipo: 'ufs' | 'ddds', key: string): boolean {
		const t = tipo === 'ufs' ? ufsT : dddsT;
		const val = t[key];
		if (!val) return false;
		const prev = tipo === 'ufs' ? PREVIA_UFS[key] : PREVIA_DDDS[key];
		if (!prev) return true;
		return !stableEqual(val, prev);
	}

	function setJanela(tipo: 'ufs' | 'ddds', key: string, j: JanelaHorario) {
		if (!canEdit) return;
		const base: HorariosTabela = tabela ?? { hora: 'local', ufs: {}, ddds: {} };
		const novoTipo = { ...(tipo === 'ufs' ? base.ufs : base.ddds), [key]: j };
		update({ horarios: { ativo: h.ativo, tabela: { ...base, [tipo]: novoTipo } } });
	}
	function removerLinha(tipo: 'ufs' | 'ddds', key: string) {
		if (!canEdit || tipo === 'ufs') return;
		const base: HorariosTabela = tabela ?? { hora: 'local', ufs: {}, ddds: {} };
		if (!(key in base.ddds)) return;
		const novoTipo = { ...base.ddds };
		delete novoTipo[key];
		update({ horarios: { ativo: h.ativo, tabela: { ...base, ddds: novoTipo } } });
	}
	function restaurarPrevia() {
		if (!canEdit) return;
		update({ horarios: { ativo: h.ativo, tabela: null } });
		toast.success('Prévia restaurada.');
	}
	function copiarParaDdd(uf: string, ddd: string) {
		if (!canEdit) return;
		const j = janelaEfetiva('ufs', uf);
		const copia: JanelaHorario = {
			seg_sex: j.seg_sex ? [...j.seg_sex] as [string, string] : null,
			sabado: j.sabado ? [...j.sabado] as [string, string] : null,
		};
		setJanela('ddds', ddd, copia);
		toast.success(`Horários de ${uf} copiados para o DDD ${ddd}.`);
	}

	function editarHoras(tipo: 'ufs' | 'ddds', key: string, campo: 'seg_sex' | 'sabado', idx: 0 | 1, val: string) {
		const cur = janelaEfetiva(tipo, key);
		const janela: JanelaHorario = { seg_sex: cur.seg_sex ? [...cur.seg_sex] as [string, string] : null, sabado: cur.sabado ? [...cur.sabado] as [string, string] : null };
		const alvo = campo === 'seg_sex' ? janela.seg_sex : janela.sabado;
		if (!alvo) return;
		alvo[idx] = val;
		setJanela(tipo, key, janela);
	}
	function toggleNaoLiga(tipo: 'ufs' | 'ddds', key: string, campo: 'seg_sex' | 'sabado') {
		const cur = janelaEfetiva(tipo, key);
		const janela: JanelaHorario = { seg_sex: cur.seg_sex, sabado: cur.sabado };
		if (campo === 'seg_sex') janela.seg_sex = null; else janela.sabado = null;
		setJanela(tipo, key, janela);
	}
	function ativarJanela(tipo: 'ufs' | 'ddds', key: string, campo: 'seg_sex' | 'sabado') {
		const cur = janelaEfetiva(tipo, key);
		const janela: JanelaHorario = { seg_sex: cur.seg_sex, sabado: cur.sabado };
		const v: [string, string] = ['08:00', '18:50'];
		if (campo === 'seg_sex') janela.seg_sex = v; else janela.sabado = v;
		setJanela(tipo, key, janela);
	}

	const [addTipo, setAddTipo] = useState<'uf' | 'ddd'>('uf');
	const [addVal, setAddVal] = useState('');

	function acrescentar() {
		const v = addVal.trim().toUpperCase();
		if (!v) return;
		if (addTipo === 'uf') {
			if (!UFS.includes(v)) { toast.error('UF inválida.'); return; }
			if (ufsEfetivas.has(v)) { toast.error('Esta UF já está na tabela.'); return; }
			setJanela('ufs', v, { seg_sex: ['08:00', '18:50'], sabado: null });
		} else {
			if (!DDDS_VALIDOS.includes(v)) { toast.error('DDD inválido ou não aceito pelo motor.'); return; }
			if (dddsEfetivos.has(v)) { toast.error('Este DDD já está na tabela.'); return; }
			setJanela('ddds', v, { seg_sex: ['08:00', '18:50'], sabado: null });
		}
		setAddVal('');
	}

	const temAjuste = Object.keys(ufsT).length > 0 || Object.keys(dddsT).length > 0;

	return (
		<div className="space-y-4">
			<SectionCard title="Janela por UF/DDD" ajustado={h.ativo || temAjuste} onReverter={() => reverter('horarios')} canEdit={canEdit}>
				<div className="flex items-center gap-2">
					<Toggle checked={h.ativo} disabled={!canEdit} label="Usar janela por UF/DDD" onChange={v => update({ horarios: { ativo: v, tabela } })} />
					<span className="text-[13px] text-[var(--base-texto-2)]">Usar janela por UF/DDD</span>
				</div>
			</SectionCard>

			{h.ativo && (
				<>
					<CaixaInfo tone="amber">
						Referência inicial, não é orientação jurídica. Confirme com o seu jurídico e ajuste: a responsabilidade pelos horários é da sua operação.
					</CaixaInfo>

					<SectionCard title="Tabela de horários" canEdit={canEdit}>
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<p className="text-[12px] text-[var(--base-texto-3)]">O motor junta: DDD do cliente &gt; UF do cliente &gt; DDD da prévia &gt; UF da prévia. DDD vence UF dentro de cada tabela.</p>
							{temAjuste && <button type="button" onClick={restaurarPrevia} disabled={!canEdit} className="text-[12px] font-medium text-[var(--base-texto-3)] hover:text-[var(--base-texto)]">Restaurar a prévia</button>}
						</div>

						<div className="overflow-x-auto">
							<table className="w-full min-w-[640px] text-left text-[12px]">
								<thead className="text-[var(--base-texto-3)]">
									<tr className="border-b" style={{ borderColor: 'var(--base-borda)' }}>
										<th className="py-2 pr-3 font-medium">UF / DDD</th>
										<th className="py-2 pr-3 font-medium">Seg–sex (de – até)</th>
										<th className="py-2 pr-3 font-medium">Sábado (de – até)</th>
										<th className="py-2 pr-3 font-medium">Origem</th>
										<th className="py-2"></th>
									</tr>
								</thead>
								<tbody>
									{[...ufsEfetivas].map(uf => {
										const ddd = UF_DDD_PREVIA[uf];
										const ufJan = janelaEfetiva('ufs', uf);
										const ufAjust = isAjustado('ufs', uf);
										let avisoDdd: string | null = null;
										let botaoCopiarLabel = '';
										if (ddd && ufAjust) {
											const dddOwned = ddd in dddsT;
											const dddJan = janelaEfetiva('ddds', ddd);
											if (!dddOwned) {
												avisoDdd = ddd;
												botaoCopiarLabel = `Copiar também para o DDD ${ddd}`;
											} else if (!stableEqual(ufJan, dddJan)) {
												avisoDdd = ddd;
												botaoCopiarLabel = `Atualizar o DDD ${ddd} com estes horários`;
											}
										}
										return (
											<LinhaHorario key={`uf-${uf}`} label={uf} tipo="ufs" janela={ufJan} ajustado={ufAjust} canEdit={canEdit}
												avisoDdd={avisoDdd} botaoCopiarLabel={botaoCopiarLabel} onCopiarDdd={ddd ? () => copiarParaDdd(uf, ddd) : undefined}
												onHora={(c, i, v) => editarHoras('ufs', uf, c, i, v)} onNaoLiga={c => toggleNaoLiga('ufs', uf, c)} onAtivar={c => ativarJanela('ufs', uf, c)} onRemover={() => removerLinha('ufs', uf)} />
										);
									})}
									{[...dddsEfetivos].map(dd => (
										<LinhaHorario key={`dd-${dd}`} label={`DDD ${dd}`} tipo="ddds" janela={janelaEfetiva('ddds', dd)} ajustado={isAjustado('ddds', dd)} canEdit={canEdit}
											avisoDdd={null} botaoCopiarLabel=""
											onHora={(c, i, v) => editarHoras('ddds', dd, c, i, v)} onNaoLiga={c => toggleNaoLiga('ddds', dd, c)} onAtivar={c => ativarJanela('ddds', dd, c)} onRemover={() => removerLinha('ddds', dd)} />
									))}
								</tbody>
							</table>
						</div>

						<div className="mt-4 flex flex-wrap items-end gap-2">
							<div className="flex rounded-lg bg-[var(--base-fill)] p-1">
								<button type="button" onClick={() => setAddTipo('uf')} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${addTipo === 'uf' ? 'bg-[var(--base-cartao)] text-[var(--base-texto)]' : 'text-[var(--base-texto-3)]'}`}>UF</button>
								<button type="button" onClick={() => setAddTipo('ddd')} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${addTipo === 'ddd' ? 'bg-[var(--base-cartao)] text-[var(--base-texto)]' : 'text-[var(--base-texto-3)]'}`}>DDD</button>
							</div>
							<input value={addVal} onChange={e => setAddVal(e.target.value)} placeholder={addTipo === 'uf' ? 'Ex.: SC' : 'Ex.: 11'} className="h-9 w-28 rounded-lg border bg-[var(--base-cartao)] px-2.5 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--area)]" style={{ borderColor: 'var(--base-field-border)' }} />
							<button type="button" onClick={acrescentar} disabled={!canEdit} className="h-9 rounded-lg border px-4 text-[12px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)] disabled:opacity-50" style={{ borderColor: 'var(--base-borda)' }}>Acrescentar</button>
						</div>
					</SectionCard>

					{alertas.length > 0 && (
						<SectionCard title="Alertas do dia" canEdit={canEdit}>
							<ul className="space-y-1.5">
								{alertas.map((a, i) => <li key={i} className="text-[13px] text-[var(--base-texto-2)]">• {a}</li>)}
							</ul>
						</SectionCard>
					)}
				</>
			)}
		</div>
	);
}

function LinhaHorario({ label, tipo, janela, ajustado, canEdit, avisoDdd, botaoCopiarLabel, onCopiarDdd, onHora, onNaoLiga, onAtivar, onRemover }: {
	label: string; tipo: 'ufs' | 'ddds'; janela: JanelaHorario; ajustado: boolean; canEdit: boolean;
	avisoDdd: string | null; botaoCopiarLabel: string; onCopiarDdd?: () => void;
	onHora: (campo: 'seg_sex' | 'sabado', idx: 0 | 1, val: string) => void;
	onNaoLiga: (campo: 'seg_sex' | 'sabado') => void;
	onAtivar: (campo: 'seg_sex' | 'sabado') => void;
	onRemover: () => void;
}) {
	return (
		<tr className="border-b align-top" style={{ borderColor: 'var(--base-separator)' }}>
			<td className="py-2 pr-3 font-semibold text-[var(--base-texto)]">{label}</td>
			<td className="py-2 pr-3">
				<JanelaCell janela={janela.seg_sex} canEdit={canEdit} onHora={(i, v) => onHora('seg_sex', i, v)} onNaoLiga={() => onNaoLiga('seg_sex')} onAtivar={() => onAtivar('seg_sex')} />
			</td>
			<td className="py-2 pr-3">
				<JanelaCell janela={janela.sabado} canEdit={canEdit} onHora={(i, v) => onHora('sabado', i, v)} onNaoLiga={() => onNaoLiga('sabado')} onAtivar={() => onAtivar('sabado')} />
			</td>
			<td className="py-2 pr-3">
				<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ajustado ? 'bg-[var(--estado-pronto-fundo)] text-[var(--estado-pronto-texto)]' : 'bg-[var(--base-fill)] text-[var(--base-texto-3)]'}`}>{ajustado ? 'ajustado por vocês' : 'prévia MotorCX'}</span>
				{avisoDdd && (
					<div className="mt-1">
						<p className="text-[10px] text-[var(--estado-atencao-texto)]">A sua linha de {label} vence o DDD {avisoDdd} da prévia.</p>
						{canEdit && onCopiarDdd && (
							<button type="button" onClick={onCopiarDdd} className="mt-1 text-[11px] font-medium text-[var(--area)] hover:underline">{botaoCopiarLabel}</button>
						)}
					</div>
				)}
			</td>
			<td className="py-2 text-right">
				{tipo === 'ddds' && ajustado && canEdit && <button type="button" onClick={onRemover} className="text-[11px] font-medium text-[var(--estado-erro-texto)] hover:underline">Remover</button>}
			</td>
		</tr>
	);
}

function JanelaCell({ janela, canEdit, onHora, onNaoLiga, onAtivar }: {
	janela: [string, string] | null; canEdit: boolean;
	onHora: (idx: 0 | 1, val: string) => void; onNaoLiga: () => void; onAtivar: () => void;
}) {
	if (!janela) return (
		<div className="flex items-center gap-2">
			<span className="text-[11px] italic text-[var(--base-texto-3)]">não liga neste período</span>
			{canEdit && <button type="button" onClick={onAtivar} className="text-[11px] font-medium text-[var(--area)] hover:underline">ativar</button>}
		</div>
	);
	return (
		<div className="flex items-center gap-1">
			<input type="time" value={janela[0]} disabled={!canEdit} onChange={e => onHora(0, e.target.value)} className="h-8 w-[88px] rounded border bg-[var(--base-cartao)] px-1.5 text-[12px] text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-60" style={{ borderColor: 'var(--base-field-border)' }} />
			<span className="text-[var(--base-texto-3)]">–</span>
			<input type="time" value={janela[1]} disabled={!canEdit} onChange={e => onHora(1, e.target.value)} className="h-8 w-[88px] rounded border bg-[var(--base-cartao)] px-1.5 text-[12px] text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-60" style={{ borderColor: 'var(--base-field-border)' }} />
			{canEdit && <button type="button" onClick={onNaoLiga} className="ml-1 text-[11px] font-medium text-[var(--base-texto-3)] hover:text-[var(--base-texto)]" title="Não liga neste período">✕</button>}
		</div>
	);
}
