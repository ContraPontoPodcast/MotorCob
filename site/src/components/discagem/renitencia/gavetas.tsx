// Gavetas de edição da tela Renitência (redesign aprovado): Limites da carteira e Modo de discagem (com o spin
// rate). Mexem só no rascunho; o rodapé mostra quantas alterações faltam salvar e o "Salvar como vN".
import type { ReactNode } from 'react';
import type { Discagem, LigacoesInfo } from '@/lib/discagem';
import { SUGESTOES } from '@/lib/discagem';
import {
	AUSENTE, MODOS, ORDENS, PADRAO, TEL_SPIN, avisosSpin, curtasComSpins, efetivo, idxSpins, modoDaCarteira, mudarModo, telefonesDia,
	type DiscagemRen, type Modo, type TelSpin,
} from '@/lib/renitencia';
import { TravaAviso } from '../discagem-campos';
import { BadgeHoje, Detalhes, Ed, Gaveta, Hora, Num, Ponto, Sel, Toggle, Travado, Un, btnPri, btnSec, borda, corPri, pc } from './pecas';

type Props = {
	draft: Discagem; setDraft: (d: Discagem) => void; canEdit: boolean; onClose: () => void;
	pendentes: number; proxima: number; onSalvar: () => void; ligacoes?: LigacoesInfo; curtasPorPassada?: (number | null)[];
};

function Rodape({ pendentes, proxima, onClose, onSalvar, canEdit }: Pick<Props, 'pendentes' | 'proxima' | 'onClose' | 'onSalvar' | 'canEdit'>) {
	return <>
		{pendentes ? <span className="flex items-center gap-2 text-[12.5px] text-[var(--base-texto-2)]"><Ponto />{pendentes} {pendentes === 1 ? 'alteração não salva' : 'alterações não salvas'}</span> : <span className="text-[12.5px] text-[var(--base-texto-2)]">Sem alterações</span>}
		<span className="ml-auto flex flex-wrap gap-2">
			<button type="button" className={btnSec} style={borda} onClick={onClose}>Fechar</button>
			{pendentes > 0 && canEdit && <button type="button" className={btnPri} style={corPri} onClick={onSalvar}>Salvar como v{proxima}</button>}
		</span>
	</>;
}

export function GavetaLimites(p: Props) {
	const { draft, setDraft, canEdit, ligacoes = {} } = p;
	const e = efetivo(draft as DiscagemRen, ligacoes.tentativas_cliente_dia?.valor);
	const set = (patch: Partial<Discagem>) => setDraft({ ...draft, ...patch });
	const dn = { ativo: e.naOn, n: e.naN, em_dias: e.naDias, descansa_dias: e.naDesc };
	const cc = { ...SUGESTOES.chamadas_curtas!, ...(draft.chamadas_curtas ?? {}) };
	const dis = !canEdit;
	const tnT = ligacoes.tentativas_numero_dia, tcT = ligacoes.tentativas_cliente_dia;
	return (
		<Gaveta titulo="Limites da carteira" larga onClose={p.onClose} rodape={<Rodape {...p} />}>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Valem para todas as situações e também para o Resubmit. Nada vale até salvar.</p>
			<Ed titulo={<>Tentativas no dia{e.tnum !== 2 && <BadgeHoje muda />}</>} campos={<>
				<Num valor={e.tnum} min={1} max={10} rotulo="Tentativas por número" disabled={dis || !!tnT} onChange={v => set({ tentativas_numero_dia: v })} /><Un>por número</Un>
				<Num valor={e.tcli} min={1} max={10} rotulo="Tentativas por cliente" disabled={dis || !!tcT} onChange={v => set({ tentativas_cliente_dia: v })} /><Un>por cliente</Un>
			</>} texto={<>Teto de todas as situações. Na régua, o dia conta como 1 tentativa. Hoje a VM aceita 2 por número; com a regra nova o padrão é 3. O limite de chamadas curtas da Anatel (MP 1.396/2026) continua valendo.
				{tnT && <TravaAviso>Nas estratégias {tnT.nomes.join(', ')} vale a trava de {tnT.valor} por número.</TravaAviso>}
				{tcT && <TravaAviso>Nas estratégias {tcT.nomes.join(', ')} vale a trava de {tcT.valor} por cliente.</TravaAviso>}</>} />
			<Ed titulo="Descanso por não atende" controle={<Toggle checked={e.naOn} disabled={dis} label="Descanso por não atende" onChange={v => set({ descanso_nao_atende: { ...dn, ativo: v } })} />}
				campos={e.naOn ? <>
					<Num valor={e.naN} min={1} max={50} rotulo="Não atende seguidos" disabled={dis} onChange={v => set({ descanso_nao_atende: { ...dn, n: v } })} /><Un>seguidos em</Un>
					<Num valor={e.naDias} min={1} max={60} rotulo="Em até dias" disabled={dis} onChange={v => set({ descanso_nao_atende: { ...dn, em_dias: v } })} /><Un>dias → descansa</Un>
					<Num valor={e.naDesc} min={1} max={365} rotulo="Descansa dias" disabled={dis} onChange={v => set({ descanso_nao_atende: { ...dn, descansa_dias: v } })} /><Un>dias</Un>
				</> : undefined}
				texto={e.naOn ? 'Só a voz descansa. Quais situações contam está em “Conta no descanso”, na renitência.' : 'Desligado (padrão de hoje). Ligado, o número fica sem voz por um tempo.'} />
			<Ed titulo="Promessa suspende ligações" controle={<Toggle checked={e.promessa} disabled={dis} label="Promessa suspende ligações" onChange={v => set({ promessa_suspende: { ativo: v, dias_sem_data: e.promDias } })} />}
				campos={e.promessa ? <><Un>até a data prometida + 1 · sem data:</Un><Num valor={e.promDias} min={1} max={90} rotulo="Promessa sem data, dias" disabled={dis} onChange={v => set({ promessa_suspende: { ativo: true, dias_sem_data: v } })} /><Un>dias</Un></> : undefined}
				texto={e.promessa ? 'Quem prometeu não recebe ligação até a data. Promessa não é pagamento.' : 'Desligado (padrão). Vocês decidem se quem prometeu continua recebendo ligação.'} />
			<Ed titulo="Descanso por recusa" controle={<Toggle checked={e.recusa} disabled={dis} label="Descanso por recusa" onChange={v => set({ descanso_recusa: { ativo: v, dias: e.recusaDias } })} />}
				campos={e.recusa ? <><Num valor={e.recusaDias} min={1} max={365} rotulo="Recusa, dias" disabled={dis} onChange={v => set({ descanso_recusa: { ativo: true, dias: v } })} /><Un>dias sem voz</Un></> : undefined}
				texto="Insistir depois de uma recusa clara é o caso clássico do art. 71 do CDC." />
			<Ed titulo="Lista de “não ligar”" controle={<Toggle checked={e.nl} disabled={dis} label="Usar a lista de não ligar" onChange={v => { if (v || window.confirm('Recomendamos manter ligado. Desligar mesmo assim?')) set({ nao_ligar: { ativo: v } }); }} />}
				texto={e.nl ? 'Ligado (recomendado): quem pediu sai de todos os canais de voz da empresa.' : <span className="text-[var(--estado-atencao-texto)]">Desligado: quem pediu para não receber ligação pode voltar a receber. Não recomendado.</span>} />
			<Ed titulo="Falha técnica conta como curta" controle={<Toggle checked={e.falhaCurta} disabled={dis} label="Falha técnica conta como curta" onChange={v => set({ chamadas_curtas: { ...cc, falha_conta: v } })} />}
				texto="Conservador até a Anatel regulamentar a MP 1.396/2026: chamada não completada é curta." />
		</Gaveta>
	);
}

/** Desenho do dia de um cliente com 3 telefones: quem sai em cada spin (ou a sequência do vertical). */
function Sequencia({ m }: { m: Modo }) {
	if (m.modo === 'vertical') {
		const n = Math.min(3, m.max_telefones_dia);
		return <span className="flex flex-wrap gap-1 text-[11.5px]">{[1, 2, 3].map(t => <span key={t} className="rounded-md px-1.5 py-0.5" style={{ backgroundColor: t <= n ? 'var(--area-fundo, var(--base-fill))' : 'var(--base-fill)', color: t <= n ? 'var(--area)' : 'var(--base-texto-3)' }}>Tel. {t}{t <= n ? ` · ${t}º` : ' · —'}</span>)}</span>;
	}
	const idx = idxSpins(m);
	return <span className="flex flex-wrap gap-1 text-[11.5px]">{idx.map((t, s) => <span key={s} className="rounded-md bg-[var(--base-fill)] px-1.5 py-0.5 text-[var(--base-texto-2)]">Spin {s + 1} → Tel. {t}</span>)}</span>;
}

export function GavetaModo(p: Props) {
	const { draft, setDraft, canEdit, ligacoes = {}, curtasPorPassada = [] } = p;
	const d = draft as DiscagemRen;
	const e = efetivo(d, ligacoes.tentativas_cliente_dia?.valor);
	const { ativo, m } = modoDaCarteira(d);
	const vert = m.modo === 'vertical';
	const muda = (f: (x: Modo) => Modo) => setDraft(mudarModo(d, f) as Discagem);
	const dis = !canEdit;
	const sp = avisosSpin(m, e.tnum, e.tcli);
	const cu = curtasComSpins(sp.efetivos, curtasPorPassada), cu1 = curtasComSpins(1, curtasPorPassada);
	const td = telefonesDia(m);
	const cartaoModo = (k: Modo['modo'], txt: string): ReactNode => (
		<button type="button" role="radio" aria-checked={ativo && m.modo === k} disabled={dis} onClick={() => muda(x => ({ ...x, modo: k }))}
			className="flex min-w-0 flex-col gap-1.5 rounded-xl border p-3 text-left disabled:opacity-60"
			style={{ borderColor: ativo && m.modo === k ? 'var(--area)' : 'var(--base-borda)', boxShadow: ativo && m.modo === k ? 'inset 0 0 0 1px var(--area)' : undefined }}>
			<span className="flex flex-wrap items-center gap-2"><span className="grid h-4 w-4 place-items-center rounded-full border" style={{ borderColor: 'var(--area)' }}>{ativo && m.modo === k && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--area)' }} />}</span><b className="text-[13.5px] text-[var(--base-texto)]">{MODOS[k]}</b>{k === (PADRAO.modo_discagem as { modo: string }).modo && <span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--base-texto-2)]">padrão MotorCX</span>}</span>
			<span className="text-[12px] text-[var(--base-texto-2)]">{txt}</span>
			<Sequencia m={{ ...m, modo: k }} />
		</button>
	);
	return (
		<Gaveta titulo="Modo de discagem" larga onClose={p.onClose} rodape={<Rodape {...p} />}>
			{!ativo && <p className="rounded-xl bg-[var(--estado-atencao-fundo)] px-3 py-2 text-[12.5px] text-[var(--base-texto)]">Esta carteira ainda disca como hoje (1 telefone por cliente no dia). Escolher um modo abaixo e salvar passa a valer na próxima lista do dia.</p>}
			<Ed titulo={<>Modo <BadgeHoje muda={ativo && (vert ? m.max_telefones_dia > 1 : m.spins.regras.some(r => r.telefone !== 't1'))} /></>} texto="Em que ordem o agente percorre os telefones de cada cliente no dia." campos={
				<div role="radiogroup" aria-label="Modo de discagem" className="grid w-full gap-2 sm:grid-cols-2">
					{cartaoModo('vertical', 'Esgota os telefones do cliente antes de passar ao próximo: telefone 1, 2, 3… na ordem da carteira.')}
					{cartaoModo('horizontal', 'Passagens do mailing (spins): no spin 1, um telefone de cada cliente; no spin 2, numa onda nova, o telefone da regra do spin 2.')}
				</div>} />
			<Detalhes resumo="Como é hoje na VM">Horizontal entre dias, 1 telefone por cliente no dia e “spin” só como teto de tentativas: sai o certificado (senão o não tentado ou o tentado há mais tempo); no dia seguinte, o próximo. O spin rate de hoje é só o máximo de tentativas por cliente no dia. Aqui o spin passa a dizer qual telefone sai em cada passada (padrão do dono: spin N → telefone N). “Igual a hoje” põe todos no telefone 1.</Detalhes>
			<Ed titulo="Ordem dos telefones" campos={<Sel valor={m.ordem} opcoes={ORDENS} rotulo="Ordem dos telefones" disabled={dis} onChange={v => muda(x => ({ ...x, ordem: v }))} />}
				texto={m.ordem === 'certificado' ? 'Certificado (Hot) primeiro; entre os outros, o não tentado e depois o tentado há mais tempo (como hoje).' : m.ordem === 'carga' ? 'A ordem em que os telefones vieram no arquivo da carga.' : 'O telefone com mais contato no horário, pelo histórico. Sem histórico, vale certificado primeiro.'} />
			<Ed titulo="Telefones por cliente no dia" campos={vert
				? <><Num valor={m.max_telefones_dia} min={1} max={5} rotulo="Máximo de telefones por cliente no dia" disabled={dis} onChange={v => muda(x => ({ ...x, max_telefones_dia: v }))} /><Un>telefones</Un></>
				: <><Travado>{td} {td === 1 ? 'telefone' : 'telefones'}</Travado><Un>vem do spin rate</Un></>}
				texto={vert && m.max_telefones_dia > e.tcli ? <span className="text-[var(--estado-atencao-texto)]">Com {e.tcli} tentativas por cliente no dia, só {e.tcli} dos {m.max_telefones_dia} telefones chegam a ser discados.</span>
					: vert ? 'Teto de telefones diferentes; as tentativas continuam limitadas por número e por cliente.' : 'No horizontal, sai o maior telefone pedido pela regra dos spins.'} />
			{!vert && (
				<div className="flex min-w-0 flex-col gap-2.5 rounded-xl border px-3.5 py-3" style={borda}>
					<b className="flex items-center gap-2 text-[13.5px] text-[var(--base-texto)]">Spin rate <span className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--base-texto-2)]">só no horizontal</span></b>
					<div className="grid gap-2 sm:grid-cols-3">
						<label className="flex min-w-0 flex-col gap-1"><span className="text-[11.5px] font-semibold text-[var(--base-texto-2)]">Spins no dia</span><Num valor={m.spins.quantidade} min={1} max={10} rotulo="Spin rate, passagens do mailing no dia" disabled={dis} onChange={v => muda(x => ({ ...x, spins: { ...x.spins, quantidade: v } }))} /></label>
						<label className="flex min-w-0 flex-col gap-1"><span className="text-[11.5px] font-semibold text-[var(--base-texto-2)]">Intervalo mínimo</span><span className="flex items-center gap-1.5"><Num valor={m.spins.intervalo_min} min={0} max={600} rotulo="Intervalo mínimo entre spins, minutos" disabled={dis} onChange={v => muda(x => ({ ...x, spins: { ...x.spins, intervalo_min: v } }))} /><Un>min</Un></span></label>
						<label className="flex min-w-0 flex-col gap-1"><span className="text-[11.5px] font-semibold text-[var(--base-texto-2)]">Cliente sem o telefone</span><Sel valor={m.telefone_ausente} opcoes={AUSENTE} rotulo="Telefone que o cliente não tem" disabled={dis} onChange={v => muda(x => ({ ...x, telefone_ausente: v }))} /></label>
					</div>
					<p className="text-[12px] text-[var(--base-texto-2)]">Telefone de cada spin e início (opcional):</p>
					<div className="flex flex-col gap-2">
						{m.spins.regras.map((r, s) => (
							<div key={r.spin} className="flex min-w-0 flex-wrap items-center gap-1.5">
								<b className="w-[52px] shrink-0 text-[12.5px] text-[var(--base-texto)]">Spin {r.spin}</b>
								<Sel valor={r.telefone} opcoes={TEL_SPIN} rotulo={`Telefone do spin ${r.spin}`} disabled={dis} onChange={(v: TelSpin) => muda(x => ({ ...x, spins: { ...x.spins, regras: x.spins.regras.map((y, i) => i === s ? { ...y, telefone: v } : y) } }))} />
								<Hora valor={r.inicio} vazio rotulo={`Início do spin ${r.spin} (opcional)`} disabled={dis} onChange={v => muda(x => ({ ...x, spins: { ...x.spins, regras: x.spins.regras.map((y, i) => i === s ? { ...y, inicio: v } : y) } }))} />
								<small className="basis-full pl-[58px] text-[11.5px]" style={{ color: sp.obs[s]?.[1] ? 'var(--estado-atencao-texto)' : 'var(--base-texto-3)' }}>{sp.obs[s]?.[0]}</small>
							</div>
						))}
					</div>
					{canEdit && <div className="flex flex-wrap gap-2">
						<button type="button" className={btnSec} style={borda} onClick={() => muda(x => ({ ...x, spins: { ...x.spins, regras: x.spins.regras.map((y, i) => ({ ...y, telefone: (i < 5 ? `t${i + 1}` : 'nao_tentado') as TelSpin })) } }))}>Spin N → telefone N</button>
						<button type="button" className={btnSec} style={borda} onClick={() => muda(x => ({ ...x, spins: { ...x.spins, regras: x.spins.regras.map(y => ({ ...y, telefone: 't1' as TelSpin })) } }))}>Igual a hoje (todos no telefone 1)</button>
					</div>}
					{sp.avisos.length > 0 && <ul className="list-disc space-y-1 pl-5 text-[12px] text-[var(--estado-atencao-texto)]">{sp.avisos.map(a => <li key={a}>{a}</li>)}</ul>}
					<p className="text-[12px] text-[var(--base-texto-2)]">Chamadas curtas previstas no dia com {sp.efetivos} {sp.efetivos === 1 ? 'spin' : 'spins'}: {cu == null ? 'sem histórico ainda (Contato por passada)' : <><b style={{ color: cu >= 75 ? 'var(--estado-atencao-texto)' : 'var(--base-texto)' }}>{pc(cu, 0)}</b> (com 1 spin: {pc(cu1 ?? 0, 0)})</>} · aviso 75% · MP 85%.</p>
					<Detalhes resumo="Como os spins abrem">Sem início, o spin seguinte abre quando o anterior passou por todo o mailing e o intervalo de {m.spins.intervalo_min} min do último telefone venceu. Tiram o cliente dos spins seguintes: CPC, acordo, promessa, recusa, “não ligar” e as sinalizações com “Finaliza” ligado.</Detalhes>
				</div>
			)}
			<Ed titulo={<>Sempre encerram o cliente no dia <Travado>fixo</Travado></>} campos={<>{['CPC', 'Acordo', 'Promessa', 'Recusa', 'Não ligar'].map(x => <span key={x} className="rounded-full bg-[var(--base-fill)] px-2.5 py-0.5 text-[12px] text-[var(--base-texto-2)]">{x}</span>)}</>}
				texto="Valem nos dois modos e tiram o cliente dos spins e voltas seguintes." />
		</Gaveta>
	);
}
