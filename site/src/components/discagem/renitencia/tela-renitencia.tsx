// Cobrança › Estratégia › Discagem › Renitência (tela 1 do redesign aprovado, renitencia-v2).
// Cartões Limites, Modo e Spin (edição em gavetas), a regra de discagem por sinalização (uma frase por linha; a
// linha abre no lugar; "Mostrar só o que muda"), as 8 situações e as falhas técnicas. Só mexe no rascunho de
// credores.discagem; quem grava é salvar_discagem (discagem.tsx), com versão, antes/depois e auditoria.
import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Filter, Lock, RotateCcw } from 'lucide-react';
import type { Discagem, LigacoesInfo } from '@/lib/discagem';
import {
	CURTA_TXT, DEPOIS, FALHAS, LINHAS_SINAL, MODOS, ORDENS, PRIORIDADES, SEM_REDISCAR, SITUACOES, TRAVA_SIN, HOJE_SIN,
	avisosSinal, avisosSpin, curtasComSpins, efetivo, explicaDepois, frase, linhaAlterada, modoDaCarteira, mudaHoje, mudarCampo,
	mudarSinal, sinalAlterado, sinalDaCarteira, telefonesDia, voltarLinha, voltarSinal,
	type AcaoDepois, type CampoSinal, type DiscagemRen, type Prioridade, type RegraSinal,
} from '@/lib/renitencia';
import { BadgeHoje, Chip, Detalhes, Hora, Nota, Num, Ponto, Secao, SecaoTitulo, Sel, Tag, Toggle, Travado, Un, btnSec, borda, cartao, pc } from './pecas';

export type GavetaId = 'lim' | 'modo';
type Props = {
	draft: Discagem; salvo: Record<string, unknown> | null; setDraft: (d: Discagem) => void; canEdit: boolean;
	abrir: (g: GavetaId) => void; ligacoes?: LigacoesInfo; curtasPorPassada: (number | null)[];
};

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const INV = { so_voz: 'Só a voz, após 2 confirmações', invalida: 'Todos os canais (regra antiga)', nao: 'Não invalida' } as const;
const HOJE_TNUM = 2;

function Card({ titulo, sujo, direita, onEditar, canEdit, children }: { titulo: string; sujo: boolean; direita?: ReactNode; onEditar: () => void; canEdit: boolean; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-2xl border p-4" style={cartao}>
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-bold text-[var(--base-texto)]">{titulo}{sujo && <Ponto />}</h3>
				{direita}
				<button type="button" onClick={onEditar} className="text-[13px] font-semibold text-[var(--estado-info)]">{canEdit ? 'Editar' : 'Ver'}</button>
			</div>
			{children}
		</div>
	);
}

function Dl({ itens }: { itens: [string, ReactNode][] }) {
	return (
		<dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-x-3 gap-y-1 text-[12.5px]">
			{itens.map(([t, v]) => <div key={t} className="contents"><dt className="text-[var(--base-texto-2)]">{t}</dt><dd className="text-right font-semibold text-[var(--base-texto)]">{v}</dd></div>)}
		</dl>
	);
}

function Aviso({ children }: { children: ReactNode }) {
	return <span className="flex items-start gap-1.5 text-[12px] text-[var(--estado-atencao-texto)]"><AlertTriangle size={13} className="mt-0.5 shrink-0" /><span className="min-w-0">{children}</span></span>;
}

export function TelaRenitencia({ draft, salvo, setDraft, canEdit, abrir, ligacoes = {}, curtasPorPassada }: Props) {
	const [aberta, setAberta] = useState<string | null>(null);
	const [soMuda, setSoMuda] = useState(false);
	const [verTec, setVerTec] = useState(false);
	const d = draft as DiscagemRen, s = (salvo ?? {}) as DiscagemRen;
	const e = efetivo(d, ligacoes.tentativas_cliente_dia?.valor);
	const { ativa, regras } = sinalDaCarteira(d), regrasSalvas = sinalDaCarteira(s).regras;
	const { ativo: modoAtivo, m } = modoDaCarteira(d);
	const vert = modoAtivo && m.modo === 'vertical';
	const set = (x: DiscagemRen) => setDraft(x as Discagem);
	const campoSin = (k: string, c: CampoSinal, v: unknown) => set(mudarSinal(d, k, c, v));

	// ---------------------------------------------------------------- cartões
	const limSujo = ['tnum', 'tcli', 'naOn', 'naN', 'naDias', 'naDesc', 'promessa', 'promDias', 'recusa', 'recusaDias', 'nl', 'falhaCurta']
		.some(k => (e as Record<string, unknown>)[k] !== (efetivo(s) as Record<string, unknown>)[k]);
	const modoSujo = !igual(d.modo_discagem ?? null, s.modo_discagem ?? null);
	const sp = avisosSpin(m, e.tnum, e.tcli);
	const cu = curtasComSpins(sp.efetivos, curtasPorPassada);
	const mudaModo = modoAtivo && (m.modo === 'vertical' ? m.max_telefones_dia > 1 : m.spins.regras.slice(0, m.spins.quantidade).some(r => r.telefone !== 't1'));

	const cardLim = (
		<Card titulo="Limites da carteira" sujo={limSujo} onEditar={() => abrir('lim')} canEdit={canEdit}>
			<Dl itens={[
				['Tentativas no dia', <>{e.tnum} por número · {e.tcli} por cliente{e.tnum !== HOJE_TNUM && <> <BadgeHoje muda /></>}</>],
				['Descanso por não atende', e.naOn ? `${e.naN} em ${e.naDias} dias → ${e.naDesc} dias` : 'desligado'],
				['Promessa suspende', e.promessa ? `sim · sem data: ${e.promDias} dias` : 'não'],
				['Descanso por recusa', e.recusa ? `${e.recusaDias} dias` : 'desligado'],
				['Lista “não ligar”', e.nl ? 'ligada' : 'desligada'],
				['Falha técnica conta como curta', e.falhaCurta ? 'sim' : 'não'],
			]} />
			{!e.nl && <Aviso>“Não ligar” desligado: não recomendado.</Aviso>}
		</Card>
	);
	const cardModo = (
		<Card titulo="Modo de discagem" sujo={modoSujo} direita={<BadgeHoje muda={mudaModo} />} onEditar={() => abrir('modo')} canEdit={canEdit}>
			<p className="text-[18px] font-bold text-[var(--base-texto)]">{modoAtivo ? MODOS[m.modo] : 'O de hoje'}</p>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">{!modoAtivo ? 'Horizontal entre dias: 1 telefone por cliente no dia; o próximo amanhã.' : vert ? 'Esgota os telefones do cliente antes de passar ao próximo.' : 'Passagens do mailing (spins): um telefone de cada cliente por spin.'}</p>
			{modoAtivo && <Dl itens={[['Ordem dos telefones', ORDENS[m.ordem]], ['Telefones por cliente no dia', `${telefonesDia(m)}${vert ? '' : ' (dos spins)'}`]]} />}
		</Card>
	);
	const cardSpin = !modoAtivo ? (
		<Card titulo="Spin rate" sujo={false} onEditar={() => abrir('modo')} canEdit={canEdit}>
			<p className="text-[18px] font-bold text-[var(--base-texto)]">Só teto de tentativas</p>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Hoje o spin é só o máximo de tentativas por cliente no dia ({e.tcli}). Com o modo salvo, cada spin escolhe o telefone (padrão: spin N → telefone N).</p>
		</Card>
	) : vert ? (
		<Card titulo="Telefones por cliente" sujo={modoSujo} onEditar={() => abrir('modo')} canEdit={canEdit}>
			<p className="text-[18px] font-bold text-[var(--base-texto)]">Até {m.max_telefones_dia} por dia, em sequência</p>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Spin rate só vale no horizontal.</p>
			{m.max_telefones_dia > e.tcli && <Aviso>Com {e.tcli} tentativas por cliente no dia, só {e.tcli} dos {m.max_telefones_dia} telefones chegam a ser discados.</Aviso>}
		</Card>
	) : (
		<Card titulo="Spin rate" sujo={modoSujo} onEditar={() => abrir('modo')} canEdit={canEdit}>
			<p className="text-[18px] font-bold text-[var(--base-texto)]">{m.spins.quantidade} {m.spins.quantidade === 1 ? 'spin' : 'spins'} · {m.spins.intervalo_min} min entre eles</p>
			<div className="flex flex-wrap gap-1">{m.spins.regras.map(r => <span key={r.spin} className="rounded-full bg-[var(--base-fill)] px-2 py-0.5 text-[11.5px] text-[var(--base-texto-2)]">{r.spin} → {r.telefone[0] === 't' ? `Tel. ${r.telefone.slice(1)}` : r.telefone === 'nao_tentado' ? 'não tentado' : 'histórico'}{r.inicio ? ` · ${r.inicio}` : ''}</span>)}</div>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Curtas previstas: {cu == null ? 'sem histórico ainda' : <b style={{ color: cu >= 75 ? 'var(--estado-atencao-texto)' : undefined }}>{pc(cu, 0)}</b>} · aviso 75% · MP 85%</p>
			{sp.avisos.length > 0 && <Aviso>{sp.avisos.length === 1 ? sp.avisos[0] : `${sp.avisos.length} avisos: ${sp.avisos[0]}`}</Aviso>}
		</Card>
	);

	// ---------------------------------------------------------------- regra por sinalização
	const linhaEditor = (k: string, n: string, r: RegraSinal) => {
		const h = HOJE_SIN[k];
		if (TRAVA_SIN[k]) return (
			<div id={`sx-${k}`} className="flex flex-col gap-2 border-t px-3.5 py-3" style={borda}>
				<Travado>{TRAVA_SIN[k]}</Travado>
				<p className="text-[12px] text-[var(--base-texto-2)]">Não aplica regra ao número nem ao cliente: a falha é da linha. A rota volta a discar quando a equipe retomar (fica registrado quem e por quê).</p>
				<p className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-3)]">Hoje a VM: {h?.txt}<BadgeHoje muda /></p>
			</div>
		);
		const fixoFin = k === 'retorno_agendado', semRed = SEM_REDISCAR.includes(k), fin = r.finaliza && !fixoFin, dis = !canEdit;
		const off = fin ? 'opacity-50' : '';
		const campo = (t: string, c: ReactNode, cls = '') => <div className={`flex min-w-0 flex-col gap-1.5 ${cls}`}><span className="text-[11px] font-bold uppercase tracking-wide text-[var(--base-texto-3)]">{t}</span>{c}</div>;
		return (
			<div id={`sx-${k}`} className="flex flex-col gap-3 border-t px-3.5 py-3" style={{ ...borda, backgroundColor: 'var(--base-fill)' }}>
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					{campo('1 · Finaliza o cliente?', fixoFin ? <Travado>Sim, vale o agendamento</Travado>
						: <label className="inline-flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]"><Toggle checked={r.finaliza} disabled={dis} label={`Finaliza o cliente em ${n}`} onChange={v => campoSin(k, 'finaliza', v)} />{r.finaliza ? 'Sim: o resto da linha não vale' : 'Não'}</label>)}
					{campo('2 · Rediscar o mesmo telefone', fixoFin ? <><span className="text-[13px]">No horário pedido</span><small className="text-[11.5px] text-[var(--base-texto-3)]">retorno agendado (até {e.retornoDias} dias)</small></>
						: semRed ? <><Travado>Não redisca</Travado><small className="text-[11.5px] text-[var(--base-texto-3)]">{k === 'numero_inexistente' ? 'o número não existe' : 'o número não é do cliente'}</small></>
						: <>
							<label className="inline-flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]"><Toggle checked={r.rediscar.ativo} disabled={dis || fin} label={`Rediscar o mesmo telefone em ${n}`} onChange={v => campoSin(k, 'rediscar.ativo', v)} />{r.rediscar.ativo ? 'Sim' : 'Não'}</label>
							{r.rediscar.ativo && <div className="flex flex-wrap items-center gap-1.5"><Un>depois de</Un><Num valor={r.rediscar.depois_min} min={0} max={600} rotulo="Rediscar depois de, minutos" disabled={dis || fin} onChange={v => campoSin(k, 'rediscar.depois_min', v)} /><Un>min · até</Un><Num valor={r.rediscar.max} min={1} max={9} largura={52} rotulo="Rediscagens no dia" disabled={dis || fin} onChange={v => campoSin(k, 'rediscar.max', v)} /><Un>×</Un></div>}
							{r.rediscar.ativo && <div className="flex flex-wrap items-center gap-1.5"><Un>prioridade</Un><Sel valor={r.rediscar.prioridade} opcoes={PRIORIDADES} rotulo="Prioridade da rediscagem" disabled={dis || fin} onChange={(v: Prioridade) => campoSin(k, 'rediscar.prioridade', v)} /></div>}
						</>, off)}
					{campo(r.rediscar.ativo && !semRed && !fixoFin ? '3 · Esgotadas as rediscagens' : '3 · Depois', fixoFin ? <span className="text-[13px]">—</span> : <>
						<div className="flex flex-wrap items-center gap-1.5"><Sel valor={r.depois.acao} opcoes={DEPOIS} rotulo={`Depois, em ${n}`} disabled={dis || fin} onChange={(v: AcaoDepois) => campoSin(k, 'depois.acao', v)} />
							{r.depois.acao === 'proximo_telefone' && <><Un>espera</Un><Num valor={r.depois.espera_min} min={0} max={240} largura={56} rotulo="Espera até o próximo telefone, minutos" disabled={dis || fin} onChange={v => campoSin(k, 'depois.espera_min', v)} /><Un>min</Un></>}</div>
						<small className="text-[11.5px] text-[var(--base-texto-3)]">{explicaDepois(r, vert)}</small>
					</>, off)}
					{campo('Horário limite', fixoFin ? <span className="text-[13px]">Janela UF/DDD</span> : <><Hora valor={r.ate} rotulo="Horário limite" disabled={dis || fin} onChange={v => v && campoSin(k, 'ate', v)} /><small className="text-[11.5px] text-[var(--base-texto-3)]">e a janela UF/DDD de cada número</small></>, off)}
				</div>
				<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-3)]">
					<span className="min-w-0">Hoje a VM: {h?.txt}</span><BadgeHoje muda={mudaHoje(k, r)} />
					{['desligou_sem_conversar', 'atendeu_desligou', 'pessoa_errada', 'abandonada'].includes(k) && !r.finaliza && <span className="text-[var(--estado-atencao-texto)]">Hoje a VM finaliza o cliente neste desfecho.{k === 'atendeu_desligou' ? ' Rediscar quem atendeu e desligou pode gerar reclamação.' : ''}</span>}
					{sinalAlterado(d, k) && canEdit ? <button type="button" className={`${btnSec} ml-auto`} style={borda} onClick={() => set(voltarSinal(d, k))}><RotateCcw size={13} /> Voltar ao padrão desta linha</button> : <span className="ml-auto">padrão MotorCX</span>}
				</div>
			</div>
		);
	};

	const linha = (k: string, n: string) => {
		const trava = !!TRAVA_SIN[k], r = regras[k] ?? null;
		const muda = trava ? true : mudaHoje(k, r);
		if (soMuda && !muda) return null;
		const aberto = aberta === k, lock = trava || k === 'retorno_agendado' || SEM_REDISCAR.includes(k);
		const av = trava || !r ? [] : avisosSinal(k, r, e), suja = !trava && r && !igual(r, regrasSalvas[k]);
		const lim = trava || !r ? '' : k === 'retorno_agendado' ? 'janela' : r.finaliza ? '' : `até ${r.ate}`;
		return (
			<div key={k} className="border-b last:border-b-0" style={borda}>
				<button type="button" aria-expanded={aberto} aria-controls={`sx-${k}`} onClick={() => setAberta(aberto ? null : k)}
					className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-3 text-left hover:bg-[var(--base-fill)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2.4fr)_70px_104px_20px]">
					<span className="flex min-w-0 items-center gap-1.5"><b className="truncate text-[13.5px] text-[var(--base-texto)]">{n}</b>{lock && <Lock size={12} className="shrink-0 text-[var(--base-texto-3)]" aria-label="Regra fixa" />}{suja && <Ponto />}</span>
					<span className="col-start-2 row-start-1 flex items-center gap-2 lg:hidden"><BadgeHoje muda={muda} /><ChevronDown size={15} className={`text-[var(--base-texto-3)] transition-transform ${aberto ? 'rotate-180' : ''}`} /></span>
					<span className="col-span-2 flex min-w-0 flex-col gap-0.5 lg:col-span-1">
						<span className="text-[13px] text-[var(--base-texto-2)]">{trava ? 'Pausa a rota e alerta a equipe na hora' : r ? frase(k, r, e.retornoDias) : ''}</span>
						{av.length > 0 && <small className="flex items-start gap-1 text-[11.5px] text-[var(--estado-atencao-texto)]"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{av.join(' · ')}</small>}
					</span>
					<span className="hidden text-[12px] tabular-nums text-[var(--base-texto-2)] lg:block">{lim}</span>
					<span className="hidden lg:block"><BadgeHoje muda={muda} /></span>
					<ChevronDown size={15} className={`hidden text-[var(--base-texto-3)] transition-transform lg:block ${aberto ? 'rotate-180' : ''}`} />
				</button>
				{aberto && (trava || r) && linhaEditor(k, n, r ?? regras.falha_operadora)}
			</div>
		);
	};
	const mudaK = (k: string) => !!TRAVA_SIN[k] || mudaHoje(k, regras[k] ?? null);
	const TEC = FALHAS.map(f => ({ k: f.k, n: f.n }));
	const nMudaTec = TEC.filter(x => mudaK(x.k)).length, nMuda = LINHAS_SINAL.filter(x => mudaK(x.k)).length + nMudaTec;
	const tecAberto = verTec || soMuda;
	const linhasSin = LINHAS_SINAL.map(x => linha(x.k, x.n)).filter(Boolean);

	// ---------------------------------------------------------------- renitência: as 8 situações e as falhas
	const campoRen = (k: string, c: string, v: unknown) => set(mudarCampo(d, 'por_situacao', k, c, v));
	const campoTec = (k: string, v: number) => set(mudarCampo(d, 'falhas_tecnicas', k, 'aviso', v));

	return (
		<div className="space-y-5">
			<Nota tom="info">
				<b className="block">Estes são os valores que o motor usa hoje. Nada muda até alguém salvar.</b>
				Os padrões novos aparecem com a marca <BadgeHoje muda />. Cada valor vale só para esta carteira.
			</Nota>

			<section>
				<SecaoTitulo titulo="Limites e modo de discagem" linha="Valem para todas as sinalizações e para o Resubmit." />
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cardLim}{cardModo}{cardSpin}</div>
			</section>

			<Secao id="regra-sin">
				<SecaoTitulo titulo="Regra de discagem por sinalização" linha="O que acontece depois de cada resultado da chamada. Toque numa linha para editar."
					direita={<Chip ativo={soMuda} onClick={() => setSoMuda(v => !v)}><Filter size={13} /> Mostrar só o que muda ({nMuda})</Chip>} />
				<div className="mb-3 space-y-2">
					{!ativa && <Nota tom="atencao"><b className="block">Esta carteira ainda usa a retentativa de hoje.</b>Abaixo, o padrão sugerido. Ao mudar qualquer linha e salvar, a regra por sinalização passa a valer (com 3 tentativas por número, se a carteira não disser outro número).</Nota>}
					<Nota tom="info"><b className="block">Vale nos dois modos e dentro de cada spin. Os limites da carteira sempre cortam, e a linha avisa quando.</b>{vert ? 'Vertical: “próximo telefone” disca o próximo telefone do mesmo cliente depois da espera.' : 'Horizontal: “próximo telefone” puxa o próximo telefone do cliente para o início do spin seguinte; “próximo cliente” deixa o cliente para o spin seguinte.'}</Nota>
				</div>
				<div className="overflow-hidden rounded-xl border" style={borda}>
					<div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,2.4fr)_70px_104px_20px] gap-x-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] lg:grid" style={{ ...borda, backgroundColor: 'var(--base-fill)' }}>
						<span>Sinalização</span><span>O que acontece</span><span>Limite</span><span>Hoje na VM</span><span />
					</div>
					{linhasSin.length ? linhasSin : <p className="px-3.5 py-3 text-[13px] text-[var(--base-texto-2)]">Nenhuma sinalização muda o hoje.</p>}
					{!soMuda && (
						<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2.4fr)_70px_104px_20px]">
							<span className="flex min-w-0 items-center gap-1.5"><b className="text-[13.5px] text-[var(--base-texto)]">CPC · acordo · promessa · recusa · não ligar</b><Lock size={12} className="shrink-0 text-[var(--base-texto-3)]" /></span>
							<span className="col-span-2 text-[13px] text-[var(--base-texto-2)] lg:col-span-1">Sempre finaliza: sai dos spins e voltas seguintes. “Não ligar” tira o número de todos os canais de voz.</span>
							<span className="hidden lg:block" /><span className="hidden lg:block"><BadgeHoje muda={false} /></span><span className="hidden lg:block" />
						</div>
					)}
				</div>
				<button type="button" aria-expanded={tecAberto} onClick={() => setVerTec(v => !v)} className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-bold text-[var(--base-texto)]">
					<ChevronDown size={15} className={`transition-transform ${tecAberto ? 'rotate-180' : ''}`} />Falhas técnicas <span className="font-normal text-[var(--base-texto-2)]">· {TEC.length} sinalizações · {nMudaTec} mudam o hoje</span>
				</button>
				{tecAberto && <div className="mt-2 overflow-hidden rounded-xl border" style={borda}>{TEC.map(x => linha(x.k, x.n))}</div>}
			</Secao>

			<Secao>
				<SecaoTitulo titulo="Renitência: as 8 situações" linha="Quantas vezes no dia no mesmo número, se conta no descanso e se invalida. O tempo até ligar de novo é um campo só, “Redisca depois de”, na regra por sinalização." />
				<div className="overflow-hidden rounded-xl border" style={borda}>
					<div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.5fr)_minmax(0,1fr)_120px] gap-x-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] md:grid" style={{ ...borda, backgroundColor: 'var(--base-fill)' }}>
						<span>Situação</span><span>Máx. no dia</span><span>Conta no descanso</span><span />
					</div>
					{SITUACOES.map(x => {
						const k = x.k, r = e.ren[k];
						const alterado = k === 'retorno_agendado' ? e.retornoDias !== 7 : k === 'numero_incorreto' ? e.inexistente !== 'so_voz' : linhaAlterada(d, 'por_situacao', k);
						const voltar = () => k === 'retorno_agendado' ? setDraft({ ...draft, retorno_agendado: undefined }) : k === 'numero_incorreto' ? setDraft({ ...draft, inexistente: { ...(draft.inexistente ?? {}), ativo: true, modo: 'so_voz' } }) : set(voltarLinha(d, 'por_situacao', k));
						const sujo = k === 'retorno_agendado' ? e.retornoDias !== efetivo(s).retornoDias : k === 'numero_incorreto' ? e.inexistente !== efetivo(s).inexistente : !igual(r, efetivo(s).ren[k]);
						let c2: ReactNode, c3: ReactNode;
						if (k === 'retorno_agendado') {
							c2 = <div className="flex flex-wrap items-center gap-1.5"><Un>1, no horário pedido, até</Un><Num valor={e.retornoDias} min={1} max={60} rotulo="Máximo de dias" disabled={!canEdit} alterado={e.retornoDias !== 7} onChange={v => setDraft({ ...draft, retorno_agendado: v === 7 ? undefined : { ...(draft.retorno_agendado ?? {}), max_dias: v } })} /><Un>dias</Un></div>;
							c3 = <Travado>Não conta</Travado>;
						} else if (k === 'numero_incorreto') {
							c2 = <div className="flex flex-wrap items-center gap-1.5"><Un>Não volta no dia · invalida:</Un><Sel valor={e.inexistente} opcoes={INV} rotulo="Número inexistente invalida" disabled={!canEdit}
								onChange={v => { if (v === 'nao' && !window.confirm('Recomendamos manter o bloqueio de inexistente. Desligar mesmo assim?')) return; setDraft({ ...draft, inexistente: { ...(draft.inexistente ?? {}), ativo: v !== 'nao', modo: v === 'invalida' ? 'invalida' : 'so_voz' } }); }} /></div>;
							c3 = <Travado>Não conta</Travado>;
						} else {
							c2 = <div className="flex flex-wrap items-center gap-1.5"><Num valor={r.max_dia} min={1} max={10} rotulo={`Máximo de tentativas no dia, ${x.n}`} disabled={!canEdit} alterado={d.por_situacao?.[k]?.max_dia !== undefined} onChange={v => campoRen(k, 'max_dia', v)} /><Un>no mesmo número</Un>{(d.por_situacao?.[k]?.max_dia ?? 0) > e.tnum && <span className="text-[12px] text-[var(--estado-atencao-texto)]">teto {e.tnum}</span>}</div>;
							c3 = <label className="inline-flex items-center gap-2 text-[13px] text-[var(--base-texto-2)]"><Toggle checked={r.conta_descanso} disabled={!canEdit} label={`Conta no descanso por não atende, ${x.n}`} onChange={v => campoRen(k, 'conta_descanso', v)} />{r.conta_descanso ? 'Conta' : 'Não conta'}</label>;
						}
						return (
							<div key={k} className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b px-3.5 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.5fr)_minmax(0,1fr)_120px]" style={borda}>
								<div className="min-w-0" title={`${x.chaves} · ${x.sinais}`}>
									<b className="flex items-center gap-1.5 text-[13.5px] text-[var(--base-texto)]">{x.n}{sujo && <Ponto />}</b>
									<small className="block text-[11.5px] text-[var(--base-texto-3)]"><Travado>{CURTA_TXT[x.curta]}</Travado></small>
								</div>
								<div className="min-w-0"><span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--base-texto-3)] md:hidden">Máx. no dia</span>{c2}</div>
								<div className="min-w-0"><span className="mb-1 block text-[11px] font-semibold uppercase text-[var(--base-texto-3)] md:hidden">Descanso</span>{c3}</div>
								<div className="flex items-center gap-1.5 md:justify-end"><Tag alterado={alterado} />{alterado && canEdit && <button type="button" onClick={voltar} title="Voltar ao padrão MotorCX" aria-label={`Voltar ${x.n} ao padrão`} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><RotateCcw size={13} /></button>}</div>
							</div>
						);
					})}
				</div>
				<div className="mt-2 space-y-1 text-[11.5px] text-[var(--base-texto-3)]">
					<p>Só “Número incorreto” pode invalidar o número. As outras nunca invalidam: máquina, caixa postal e ocupado provam que o número existe.</p>
					<p><Travado>Chamada curta segue a MP 1.396/2026 e não é configurável.</Travado>{!e.naOn && ' O descanso por não atende está desligado na carteira: “conta” só vale quando ligar.'}</p>
				</div>
			</Secao>

			<Secao>
				<SecaoTitulo titulo="Falhas técnicas: quando religar e quando avisar" linha={<>Problema da operadora, da rota ou nosso. <Travado>Nunca penaliza o número nem o cliente.</Travado></>} />
				<div className="overflow-hidden rounded-xl border" style={borda}>
					<div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,.8fr)_120px] gap-x-3 border-b px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--base-texto-3)] md:grid" style={{ ...borda, backgroundColor: 'var(--base-fill)' }}>
						<span>Falha</span><span>Religar depois de</span><span>Alerta acima de</span><span>Conta como curta</span><span />
					</div>
					{FALHAS.map(f => {
						const k = f.k, t = e.tec[k], trava = !!TRAVA_SIN[k];
						const alt = linhaAlterada(d, 'falhas_tecnicas', k);
						return (
							<div key={k} className="grid grid-cols-1 items-center gap-x-3 gap-y-2 border-b px-3.5 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,.8fr)_120px]" style={borda}>
								<div className="min-w-0" title={`${f.chaves} · ${f.sinais}`}><b className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-[var(--base-texto)]">{f.n}{f.mudaHoje && <BadgeHoje muda />}</b>{f.mudaHoje && <small className="block text-[11.5px] text-[var(--base-texto-3)]">hoje conta no descanso; passa a não contar</small>}</div>
								<div className="text-[13px] text-[var(--base-texto-2)]"><span className="mr-1 text-[11px] font-semibold uppercase text-[var(--base-texto-3)] md:hidden">Religar:</span>{trava ? <Travado>pausa a rota até a equipe retomar</Travado> : <>{ativa ? regras[k]?.rediscar.depois_min ?? t.religar_minutos : t.religar_minutos} min <small className="block text-[11.5px] text-[var(--base-texto-3)]">{ativa ? 'na regra por sinalização' : 'intervalo de hoje'}</small></>}</div>
								<div className="flex flex-wrap items-center gap-1.5"><span className="text-[11px] font-semibold uppercase text-[var(--base-texto-3)] md:hidden">Alerta:</span><Num valor={Math.round(t.aviso * 100)} min={1} max={100} largura={56} rotulo={`Alerta acima de, por cento, ${f.n}`} disabled={!canEdit} alterado={alt} onChange={v => campoTec(k, v / 100)} /><Un>% do dia</Un></div>
								<div className="text-[13px] text-[var(--base-texto-2)]"><span className="mr-1 text-[11px] font-semibold uppercase text-[var(--base-texto-3)] md:hidden">Curta:</span>{e.falhaCurta || k === 'abandonada' ? 'Sim' : 'Não'}</div>
								<div className="flex items-center gap-1.5 md:justify-end"><Tag alterado={alt} />{alt && canEdit && <button type="button" onClick={() => set(voltarLinha(d, 'falhas_tecnicas', k))} title="Voltar ao padrão MotorCX" aria-label={`Voltar ${f.n} ao padrão`} className="grid h-7 w-7 place-items-center rounded-lg text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><RotateCcw size={13} /></button>}</div>
							</div>
						);
					})}
				</div>
				<Detalhes resumo="Como religar e alertar funcionam">
					“Religar depois de” é o mesmo campo “Redisca depois de” da regra por sinalização; só sem crédito e bloqueio (que pausam a rota) ficam de fora. “Conta como curta” segue a opção da carteira (Limites); abandono sempre conta (MP).
				</Detalhes>
			</Secao>
		</div>
	);
}

