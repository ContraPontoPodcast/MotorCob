// Cobrança › Estratégia › Discagem › Renitência por situação (SQL 65; protótipo aprovado em 01/11/2026).
// Mostra o que o motor faz HOJE depois de cada resultado de ligação e deixa a carteira mudar por situação.
// Só lê e escreve o rascunho de credores.discagem; quem grava é salvar_discagem (discagem.tsx).
import { useState, type ReactNode } from 'react';
import { Lock, RotateCcw } from 'lucide-react';
import { SUGESTOES, type Discagem, type LigacoesInfo } from '@/lib/discagem';
import {
	CURTA_TXT, FALHAS, SITUACOES, efetivo, linhaAlterada, mudarCampo, voltarLinha, type DiscagemRen,
} from '@/lib/renitencia';
import { Toggle, TravaAviso } from './discagem-campos';

export type AbaRenProps = {
	draft: Discagem;
	setDraft: (d: Discagem) => void;
	canEdit: boolean;
	ligacoes?: LigacoesInfo;
};

// ---------------------------------------------------------------- peças pequenas (reaproveitadas no Resubmit)
export function Num({ valor, min, max, onChange, rotulo, disabled, alterado }: {
	valor: number; min: number; max: number; onChange: (v: number) => void; rotulo: string; disabled?: boolean; alterado?: boolean;
}) {
	const [txt, setTxt] = useState<string | null>(null);
	return (
		<input
			type="number" inputMode="numeric" aria-label={rotulo} min={min} max={max} disabled={disabled}
			value={txt ?? String(valor)}
			onChange={e => setTxt(e.target.value)}
			onBlur={() => {
				if (txt === null) return;
				const v = Number.parseInt(txt, 10);
				setTxt(null);
				if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
			}}
			onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
			className="h-8 w-[68px] rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] tabular-nums text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
			style={{ borderColor: alterado ? 'var(--area)' : 'var(--base-field-border, var(--base-borda))', boxShadow: alterado ? 'inset 0 0 0 1px var(--area)' : undefined }}
		/>
	);
}

export function Sel<T extends string>({ valor, opcoes, onChange, rotulo, disabled }: {
	valor: T; opcoes: Record<T, string>; onChange: (v: T) => void; rotulo: string; disabled?: boolean;
}) {
	return (
		<select aria-label={rotulo} value={valor} disabled={disabled} onChange={e => onChange(e.target.value as T)}
			className="h-8 max-w-full rounded-lg border bg-[var(--base-cartao)] px-2 text-[13px] text-[var(--base-texto)] outline-none focus:border-[var(--area)] disabled:opacity-50"
			style={{ borderColor: 'var(--base-field-border, var(--base-borda))' }}>
			{(Object.keys(opcoes) as T[]).map(k => <option key={k} value={k}>{opcoes[k]}</option>)}
		</select>
	);
}

export function Un({ children }: { children: ReactNode }) {
	return <span className="text-[12px] text-[var(--base-texto-2)]">{children}</span>;
}

/** Célula da grade: no celular e no tablet o rótulo aparece em cima (a grade vira cartão). */
export function Cel({ rotulo, children, nota, className = '' }: { rotulo: string; children: ReactNode; nota?: ReactNode; className?: string }) {
	return (
		<div className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
			<span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] xl:hidden">{rotulo}</span>
			<div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-[var(--base-texto-2)]">{children}</div>
			{nota && <small className="text-[11.5px] text-[var(--base-texto-3)]">{nota}</small>}
		</div>
	);
}

export function Travado({ children, title }: { children: ReactNode; title?: string }) {
	return <span className="inline-flex items-center gap-1 text-[12px] text-[var(--base-texto-2)]" title={title}><Lock size={12} />{children}</span>;
}

export function TagLinha({ alterado, onVoltar, nome, canEdit }: { alterado: boolean; onVoltar: () => void; nome: string; canEdit: boolean }) {
	return (
		<div className="col-span-2 flex flex-wrap items-center gap-1.5 xl:col-span-1 xl:justify-end">
			<span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${alterado ? 'bg-[var(--area-fundo,var(--base-fill))] text-[var(--area)]' : 'bg-[var(--base-fill)] text-[var(--base-texto-2)]'}`}>
				{alterado ? 'alterado' : 'padrão MotorCX'}
			</span>
			{alterado && canEdit && (
				<button type="button" onClick={onVoltar} title="Voltar ao padrão MotorCX" aria-label={`Voltar ${nome} ao padrão`}
					className="grid h-7 w-7 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><RotateCcw size={13} /></button>
			)}
		</div>
	);
}

export function SecaoTitulo({ titulo, linha, direita }: { titulo: string; linha?: ReactNode; direita?: ReactNode }) {
	return (
		<div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 className="text-[12.5px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">{titulo}</h2>
			{linha && <p className="text-[12.5px] text-[var(--base-texto-2)]">{linha}</p>}
			{direita && <div className="ml-auto">{direita}</div>}
		</div>
	);
}

export function Nota({ tom, children }: { tom: 'info' | 'atencao'; children: ReactNode }) {
	return (
		<div className="flex gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: tom === 'info' ? 'var(--estado-info-fundo)' : 'var(--estado-atencao-fundo)' }}>
			<span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-extrabold text-[var(--base-cartao)]" style={{ backgroundColor: tom === 'info' ? 'var(--estado-info)' : 'var(--estado-atencao)' }}>{tom === 'info' ? 'i' : '!'}</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

// ---------------------------------------------------------------- a tela
const INV = { so_voz: 'Só a voz, após 2 confirmações', invalida: 'Todos os canais (regra antiga)', nao: 'Não invalida' } as const;
const GRADE_REN = 'xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.15fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.15fr)_118px]';
const GRADE_TEC = 'xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,.9fr)_118px]';
const linhaCls = 'grid grid-cols-2 items-center gap-x-3 gap-y-2.5 border-b px-3.5 py-3 last:border-b-0 sm:grid-cols-3';

export function RenitenciaSituacao({ draft, setDraft, canEdit, ligacoes = {} }: AbaRenProps) {
	const [verTec, setVerTec] = useState(true);
	const d = draft as DiscagemRen;
	const e = efetivo(d);
	const set = (patch: Partial<Discagem>) => setDraft({ ...draft, ...patch });
	const campo = (bloco: 'por_situacao' | 'falhas_tecnicas', k: string, c: string, v: unknown) => setDraft(mudarCampo(d, bloco, k, c, v) as Discagem);
	const voltar = (bloco: 'por_situacao' | 'falhas_tecnicas', k: string) => setDraft(voltarLinha(d, bloco, k) as Discagem);
	const dn = { ativo: e.naOn, n: e.naN, em_dias: e.naDias, descansa_dias: e.naDesc };
	const cc = { ...SUGESTOES.chamadas_curtas!, ...(draft.chamadas_curtas ?? {}) };
	const tcliTrava = ligacoes.tentativas_cliente_dia, tnumTrava = ligacoes.tentativas_numero_dia;

	const lim = (titulo: string, controle: ReactNode, campos: ReactNode, texto: string) => (
		<div className="flex min-w-0 flex-col gap-2 rounded-xl border px-3.5 py-3" style={{ borderColor: 'var(--base-borda)' }}>
			<div className="flex flex-wrap items-center justify-between gap-2"><b className="text-[13.5px] text-[var(--base-texto)]">{titulo}</b>{controle}</div>
			{campos && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{campos}</div>}
			<p className="text-[12px] text-[var(--base-texto-2)]">{texto}</p>
		</div>
	);

	return (
		<div className="space-y-5">
			<Nota tom="info">
				<b className="block">Estes são os valores que o motor já usa hoje. Nada muda até alguém salvar.</b>
				Cada número vale só para esta carteira. Quem disca é sempre o agente de IA; a passagem para uma pessoa vai por SIP ao discador de vocês e não muda nada aqui.
			</Nota>

			<section>
				<SecaoTitulo titulo="Limites da carteira" linha="Valem para todas as situações e também para o Resubmit." />
				<div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
					{lim('Tentativas no dia', null, <>
						<Num valor={e.tnum} min={1} max={10} rotulo="Tentativas por número" disabled={!canEdit || !!tnumTrava} onChange={v => set({ tentativas_numero_dia: v })} /><Un>por número</Un>
						<Num valor={e.tcli} min={1} max={10} rotulo="Tentativas por cliente" disabled={!canEdit || !!tcliTrava} onChange={v => set({ tentativas_cliente_dia: v })} /><Un>por cliente</Un>
					</>, 'Teto de todas as situações. Na régua, o dia conta como 1 tentativa.')}
					{lim('Descanso por não atende', <Toggle checked={e.naOn} disabled={!canEdit} label="Descanso por não atende" onChange={v => set({ descanso_nao_atende: { ...dn, ativo: v } })} />,
						e.naOn ? <>
							<Num valor={e.naN} min={1} max={50} rotulo="Não atende seguidos" disabled={!canEdit} onChange={v => set({ descanso_nao_atende: { ...dn, n: v } })} /><Un>seguidos em</Un>
							<Num valor={e.naDias} min={1} max={60} rotulo="Em até dias" disabled={!canEdit} onChange={v => set({ descanso_nao_atende: { ...dn, em_dias: v } })} /><Un>dias → descansa</Un>
							<Num valor={e.naDesc} min={1} max={365} rotulo="Descansa dias" disabled={!canEdit} onChange={v => set({ descanso_nao_atende: { ...dn, descansa_dias: v } })} /><Un>dias</Un>
						</> : null,
						e.naOn ? 'Só a voz descansa. Quais situações contam está na coluna “Descanso”.' : 'Desligado (padrão de hoje). Ligado, o número fica sem voz por um tempo.')}
					{lim('Promessa suspende ligações', <Toggle checked={e.promessa} disabled={!canEdit} label="Promessa suspende ligações" onChange={v => set({ promessa_suspende: { ativo: v, dias_sem_data: e.promDias } })} />,
						e.promessa ? <><Un>até a data prometida + 1 · sem data:</Un><Num valor={e.promDias} min={1} max={90} rotulo="Promessa sem data, dias" disabled={!canEdit} onChange={v => set({ promessa_suspende: { ativo: true, dias_sem_data: v } })} /><Un>dias</Un></> : null,
						e.promessa ? 'Quem prometeu não recebe ligação até a data. Promessa não é pagamento.' : 'Desligado (padrão). Vocês decidem se quem prometeu continua recebendo ligação.')}
					{lim('Descanso por recusa', <Toggle checked={e.recusa} disabled={!canEdit} label="Descanso por recusa" onChange={v => set({ descanso_recusa: { ativo: v, dias: e.recusaDias } })} />,
						e.recusa ? <><Num valor={e.recusaDias} min={1} max={365} rotulo="Recusa, dias" disabled={!canEdit} onChange={v => set({ descanso_recusa: { ativo: true, dias: v } })} /><Un>dias sem voz</Un></> : null,
						'Insistir depois de uma recusa clara é o caso clássico do art. 71 do CDC.')}
					{lim('Lista de “não ligar”', <Toggle checked={e.nl} disabled={!canEdit} label="Usar a lista de não ligar" onChange={v => { if (v || window.confirm('Recomendamos manter ligado. Desligar mesmo assim?')) set({ nao_ligar: { ativo: v } }); }} />, null,
						e.nl ? 'Ligado (recomendado): quem pediu sai de todos os canais de voz da empresa.' : 'Desligado: quem pediu para não receber ligação pode voltar a receber. Não recomendado.')}
					{lim('Falha técnica conta como curta', <Toggle checked={e.falhaCurta} disabled={!canEdit} label="Falha técnica conta como curta" onChange={v => set({ chamadas_curtas: { ...cc, falha_conta: v } })} />, null,
						'Conservador até a Anatel regulamentar a MP 1.396/2026: chamada não completada é curta.')}
				</div>
				{tnumTrava && <TravaAviso>Nas estratégias {tnumTrava.nomes.join(', ')} vale a trava de {tnumTrava.valor} por número.</TravaAviso>}
				{tcliTrava && <TravaAviso>Nas estratégias {tcliTrava.nomes.join(', ')} vale a trava de {tcliTrava.valor} por cliente.</TravaAviso>}
			</section>

			<section>
				<SecaoTitulo titulo="As 8 situações" linha="Intervalo antes de ligar de novo, máximo no dia, descanso, se invalida o número e se conta como chamada curta." />
				<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
					<div className={`hidden gap-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] xl:grid ${GRADE_REN}`} style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)' }}>
						<span>Situação</span><span>Intervalo</span><span>Máx. no dia</span><span>Descanso</span><span>Invalida?</span><span>Chamada curta (MP)</span><span />
					</div>
					{SITUACOES.map(s => {
						const k = s.k, r = e.ren[k];
						const alterado = k === 'retorno_agendado' ? e.retornoDias !== 7 : k === 'numero_incorreto' ? e.inexistente !== 'so_voz' : linhaAlterada(d, 'por_situacao', k);
						const voltarL = () => k === 'retorno_agendado' ? set({ retorno_agendado: undefined }) : k === 'numero_incorreto' ? set({ inexistente: { ...(draft.inexistente ?? {}), ativo: true, modo: 'so_voz' } }) : voltar('por_situacao', k);
						let intv: ReactNode, max: ReactNode, desc: ReactNode, inv: ReactNode;
						if (k === 'retorno_agendado') {
							intv = <Cel rotulo="Intervalo" nota="sem hora: dia seguinte"><Un>No horário pedido, até</Un><Num valor={e.retornoDias} min={1} max={60} rotulo="Máximo de dias" disabled={!canEdit} alterado={e.retornoDias !== 7} onChange={v => set({ retorno_agendado: v === 7 ? undefined : { ...(draft.retorno_agendado ?? {}), max_dias: v } })} /><Un>dias</Un></Cel>;
							max = <Cel rotulo="Máx. no dia"><span>1, no horário</span></Cel>;
							desc = <Cel rotulo="Descanso"><Travado>Não conta</Travado></Cel>;
							inv = <Cel rotulo="Invalida?"><span>Não</span></Cel>;
						} else if (k === 'numero_incorreto') {
							intv = <Cel rotulo="Intervalo" nota="pessoa errada: “não pertence” só para este cliente"><span>Não volta no dia</span></Cel>;
							max = <Cel rotulo="Máx. no dia"><span>—</span></Cel>;
							desc = <Cel rotulo="Descanso"><Travado>Não conta</Travado></Cel>;
							inv = <Cel rotulo="Invalida?" nota={e.inexistente === 'so_voz' ? 'reteste em D+7, até 3 vezes · SMS, RCS e WhatsApp seguem' : e.inexistente === 'invalida' ? 'o número sai de todos os canais de telefone' : 'segue sendo ligado; só a trava de lote avisa'}>
								<Sel valor={e.inexistente} opcoes={INV} rotulo="Número inexistente invalida" disabled={!canEdit}
									onChange={v => { if (v === 'nao' && !window.confirm('Recomendamos manter o bloqueio de inexistente. Desligar mesmo assim?')) return; set({ inexistente: { ...(draft.inexistente ?? {}), ativo: v !== 'nao', modo: v === 'invalida' ? 'invalida' : 'so_voz' } }); }} />
							</Cel>;
						} else {
							intv = <Cel rotulo="Intervalo" nota={k === 'ocupado' ? 'intervalo de ocupado' : 'intervalo mínimo'}><Num valor={r.intervalo_minutos} min={0} max={1440} rotulo="Intervalo em minutos" disabled={!canEdit} alterado={d.por_situacao?.[k]?.intervalo_minutos !== undefined} onChange={v => campo('por_situacao', k, 'intervalo_minutos', v)} /><Un>min</Un></Cel>;
							max = <Cel rotulo="Máx. no dia" nota={(d.por_situacao?.[k]?.max_dia ?? 0) > e.tnum ? <span className="text-[var(--estado-atencao-texto)]">teto {e.tnum} por número</span> : 'no mesmo número'}><Num valor={r.max_dia} min={1} max={10} rotulo="Máximo de tentativas no dia" disabled={!canEdit} alterado={d.por_situacao?.[k]?.max_dia !== undefined} onChange={v => campo('por_situacao', k, 'max_dia', v)} /></Cel>;
							desc = <Cel rotulo="Descanso" nota={!e.naOn && r.conta_descanso ? 'descanso desligado na carteira' : undefined}><Toggle checked={r.conta_descanso} disabled={!canEdit} label="Conta no descanso por não atende" onChange={v => campo('por_situacao', k, 'conta_descanso', v)} /><span>{r.conta_descanso ? 'Conta' : 'Não conta'}</span></Cel>;
							inv = <Cel rotulo="Invalida?" nota={['maquina', 'caixa_postal', 'ocupado'].includes(k) ? 'prova que o número existe' : undefined}><span>Não</span></Cel>;
						}
						return (
							<div key={k} className={`${linhaCls} ${GRADE_REN}`} style={{ borderColor: 'var(--base-borda)' }}>
								<div className="col-span-2 min-w-0 sm:col-span-3 xl:col-span-1">
									<b className="block text-[13.5px] text-[var(--base-texto)]">{s.n}</b>
									<small className="block text-[11.5px] text-[var(--base-texto-3)]">{s.sinais}</small>
									<code className="block break-words text-[11px] text-[var(--base-texto-3)]">{s.chaves}</code>
								</div>
								{intv}{max}{desc}{inv}
								<Cel rotulo="Chamada curta (MP)"><Travado title="Medida da MP 1.396/2026, não é configurável">{CURTA_TXT[s.curta]}</Travado></Cel>
								<TagLinha alterado={alterado} onVoltar={voltarL} nome={s.n} canEdit={canEdit} />
							</div>
						);
					})}
				</div>
			</section>

			<section>
				<SecaoTitulo titulo="Falhas técnicas" linha="Problema da operadora, da rota ou nosso. Nunca penaliza o número nem o cliente. Vocês escolhem quando religar e quando avisar."
					direita={<button type="button" onClick={() => setVerTec(v => !v)} className="text-[13px] font-semibold text-[var(--estado-info)]">{verTec ? 'Esconder' : 'Mostrar'} falhas técnicas</button>} />
				{verTec && (
					<div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-cartao)' }}>
						<div className={`hidden gap-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] xl:grid ${GRADE_TEC}`} style={{ borderColor: 'var(--base-borda)', backgroundColor: 'var(--base-fill)' }}>
							<span>Falha</span><span>Religar depois de</span><span>Penaliza?</span><span>Conta como curta</span><span>Alerta</span><span />
						</div>
						{FALHAS.map(s => {
							const k = s.k, r = e.tec[k];
							return (
								<div key={k} className={`${linhaCls} ${GRADE_TEC}`} style={{ borderColor: 'var(--base-borda)' }}>
									<div className="col-span-2 min-w-0 sm:col-span-3 xl:col-span-1">
										<b className="block text-[13.5px] text-[var(--base-texto)]">{s.n} {s.mudaHoje && <span className="ml-1 rounded-full bg-[var(--estado-atencao-fundo)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--estado-atencao-texto)]">muda o hoje</span>}</b>
										<small className="block text-[11.5px] text-[var(--base-texto-3)]">{s.sinais}</small>
										<code className="block text-[11px] text-[var(--base-texto-3)]">{s.chaves}</code>
									</div>
									<Cel rotulo="Religar depois de" nota={k === 'abandonada' ? 'retorno prioritário' : k === 'bloqueio_originacao' || k === 'sem_credito' ? 'só depois de resolver' : 'no mesmo dia'}>
										<Num valor={r.religar_minutos} min={0} max={1440} rotulo="Religar depois de, minutos" disabled={!canEdit} alterado={d.falhas_tecnicas?.[k]?.religar_minutos !== undefined} onChange={v => campo('falhas_tecnicas', k, 'religar_minutos', v)} /><Un>min</Un>
									</Cel>
									<Cel rotulo="Penaliza o número?" nota={s.mudaHoje ? 'contava no descanso; deixou de contar' : 'fora da certificação e do Chega'}>
										<span className="inline-flex items-center gap-1 rounded-full bg-[var(--estado-pronto-fundo,var(--base-fill))] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--estado-pronto)]"><Lock size={11} /> Nunca</span>
									</Cel>
									<Cel rotulo="Conta como curta" nota={k === 'abandonada' ? 'abandono conta (MP)' : 'pela opção da carteira'}><span>{e.falhaCurta || k === 'abandonada' ? 'Sim' : 'Não'}</span></Cel>
									<Cel rotulo="Alerta acima de">
										<Num valor={Math.round(r.aviso * 100)} min={1} max={100} rotulo="Alerta acima de, por cento" disabled={!canEdit} alterado={d.falhas_tecnicas?.[k]?.aviso !== undefined} onChange={v => campo('falhas_tecnicas', k, 'aviso', v / 100)} /><Un>% do dia</Un>
									</Cel>
									<TagLinha alterado={linhaAlterada(d, 'falhas_tecnicas', k)} onVoltar={() => voltar('falhas_tecnicas', k)} nome={s.n} canEdit={canEdit} />
								</div>
							);
						})}
					</div>
				)}
				<p className="mt-2 text-[11.5px] text-[var(--base-texto-3)]">Recusou a chamada, mudo e fax seguem a regra de hoje.</p>
			</section>
		</div>
	);
}
