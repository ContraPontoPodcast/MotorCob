// Agente Voz/CX › Discagem › Chamadas curtas: medidores de hoje por linha (bina) e no total da empresa (REVISAO C1;
// PR 8 do plano). A operadora mede por linha e por dia; contamos por bina, a leitura mais restritiva. Os números vêm de
// ritmo_voz_hoje(empresa) (SQL 106/108: as amostras que a VM grava a cada 5 min, de todas as carteiras), e as paradas
// seguem a mesma regra da VM (voz/orquestrador/curtas.py, linhaParada): 80% com 800 numa linha, 80% com 8.000 no total
// (950 e 9.500 quando o Admin liberou hoje, em Ligações). Só contagens; a bina vem mascarada do banco.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Aviso, Cartao } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { CURTAS, num, pct, type RitmoHoje } from '@/lib/ritmo';
import { linhaParada } from '@/components/voz/faixa-ritmo';
import { useRitmoHoje } from './ritmo';

/** Limites da regra da Anatel (bloqueio de todas as linhas da empresa por 15 dias). */
export const ANATEL = { linha: 1000, total: 10000, pct: 85 };
/** Linhas mostradas uma a uma; o resto vira uma linha de soma. */
export const LINHAS_VISIVEIS = 5;

const n = (v: number) => v.toLocaleString('pt-BR');
const pctDe = (curtas: number, total: number) => (total > 0 ? Math.round((1000 * curtas) / total) / 10 : null);

/** A empresa parou de ligar no dia (a mesma regra da VM). */
export function empresaParada(t: { discadas: number; curtas: number }, liberado: boolean): boolean {
	const limite = liberado ? CURTAS.empresaLiberada : CURTAS.empresa;
	return t.discadas >= limite && t.discadas > 0 && (100 * t.curtas) / t.discadas >= CURTAS.corte;
}

function Medidor({ rotulo, discadas, limite, curtasPct, children }: { rotulo: string; discadas: number; limite: number; curtasPct: number | null; children?: React.ReactNode }) {
	const p = curtasPct ?? 0;
	const cor = p >= CURTAS.corte ? 'var(--estado-erro)' : p >= CURTAS.aviso ? 'var(--estado-atencao)' : 'var(--estado-pronto)';
	return (
		<div className="mt-3 first:mt-0">
			<div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[13px]">
				<b className="min-w-0 text-[var(--base-texto)]">{rotulo}</b>
				<span className="tnum text-[var(--base-texto-2)]">{n(discadas)} ligações hoje (limite {n(limite)}) · <b style={{ color: cor }}>{pct(curtasPct)} curtas</b></span>
			</div>
			<div role="meter" aria-label={`${rotulo}: curtas`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}
				className="relative mt-1.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--base-fill)' }}>
				<div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, backgroundColor: cor }} />
				{[CURTAS.aviso, CURTAS.corte, ANATEL.pct].map(m => <span key={m} aria-hidden className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2" style={{ left: `${m}%`, backgroundColor: 'var(--base-texto-3)' }} />)}
			</div>
			<div className="mt-1 flex justify-between gap-2 text-[11px] tnum text-[var(--base-texto-3)]"><span>ritmo cai em {CURTAS.aviso}% · para em {CURTAS.corte}%</span><span>bloqueio da operadora {ANATEL.pct}%</span></div>
			{children}
		</div>
	);
}

/** Os dois cartões, sem banco (o teste renderiza com o que ritmo_voz_hoje devolve). */
export function CurtasHojeVista({ h, liberado }: { h: RitmoHoje | null; liberado: boolean }) {
	const t = h?.totais;
	if (!h || !t || t.discadas === 0) {
		return (
			<Cartao titulo="Hoje, por linha e no total" linha="A operadora mede por linha e por dia.">
				<p className="text-[13px] text-[var(--base-texto-3)]">Sem ligações do discador MotorCX hoje. Os medidores aparecem com as primeiras ligações (atualizam a cada 15 s).</p>
			</Cartao>
		);
	}
	const linhas = [...h.por_tronco].sort((a, b) => (b.curtas_pct ?? 0) - (a.curtas_pct ?? 0) || b.discadas - a.discadas);
	const vis = linhas.slice(0, LINHAS_VISIVEIS), resto = linhas.slice(LINHAS_VISIVEIS);
	const rd = resto.reduce((s, x) => s + x.discadas, 0), rc = resto.reduce((s, x) => s + x.curtas, 0);
	const limLinha = liberado ? CURTAS.linhaLiberada : CURTAS.linha, limEmp = liberado ? CURTAS.empresaLiberada : CURTAS.empresa;
	const parouEmpresa = empresaParada(t, liberado);
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<Cartao titulo="Por linha (bina)" linha="A operadora mede por linha e por dia. Contamos por bina, a leitura mais restritiva.">
				{vis.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">A VM ainda não separou as ligações por linha hoje.</p> : vis.map(x => {
					const parada = linhaParada(x, liberado), nome = x.bina ? `Linha ${x.bina}` : `Tronco ${x.tronco_id}`;
					return (
						<Medidor key={x.tronco_id} rotulo={nome} discadas={x.discadas} limite={ANATEL.linha} curtasPct={x.curtas_pct}>
							{parada ? <div className="mt-2"><Aviso tom="erro" titulo="Linha parada hoje">Chegou a {n(x.discadas)} ligações com {pct(x.curtas_pct)} de curtas (para em {CURTAS.corte}% com {n(limLinha)}). Volta amanhã às 08:00.</Aviso></div>
								: (x.curtas_pct ?? 0) >= CURTAS.aviso ? <div className="mt-2"><Aviso tom="atencao" titulo="Ritmo reduzido">Curtas acima de {CURTAS.aviso}% nesta linha: o MotorCX liga menos por robô até voltar.</Aviso></div> : null}
						</Medidor>
					);
				})}
				{resto.length > 0 && <p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]">+ {resto.length} {resto.length === 1 ? 'outra linha' : 'outras linhas'}: {n(rd)} ligações hoje · {pct(pctDe(rc, rd))} curtas.</p>}
			</Cartao>
			<Cartao titulo="Total da empresa" linha="Todas as linhas somadas, em todas as carteiras.">
				<Medidor rotulo="Todas as linhas" discadas={t.discadas} limite={ANATEL.total} curtasPct={t.curtas_pct}>
					{parouEmpresa && <div className="mt-2"><Aviso tom="erro" titulo="A empresa parou de ligar hoje">Chegou a {n(t.discadas)} ligações com {pct(t.curtas_pct)} de curtas (para em {CURTAS.corte}% com {n(limEmp)}). Volta amanhã às 08:00.</Aviso></div>}
				</Medidor>
				<p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]">
					Em {CURTAS.corte}% com {n(limEmp)} ligações, a empresa para de ligar no dia; uma linha para em {CURTAS.corte}% com {n(limLinha)}.
					{liberado ? ' O Admin liberou hoje até 950 por linha e 9.500 no total.' : ''} O corte age na lista da manhã (por carteira) e o freio age na hora, por linha.
					{' '}<Link to="/voz/ligacoes" className="font-semibold text-[var(--destaque)] hover:underline">Ritmo agora em Ligações</Link>
				</p>
				{h.ultima && <p className="mt-1 text-[11.5px] text-[var(--base-texto-3)]">Razão agora: {num(Number(h.ultima.razao))} por robô livre.</p>}
			</Cartao>
		</div>
	);
}

/** Com dados: ritmo_voz_hoje da empresa inteira (sem carteira) a cada 15 s e a liberação de hoje. */
export function CurtasHoje({ empresaId }: { empresaId: number }) {
	const h = useRitmoHoje(empresaId, null);
	const [liberado, setLiberado] = useState(false);
	const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
	useEffect(() => {
		if (!supabase) return;
		void supabase.from('voz_curtas_liberacoes').select('id').eq('empresa_id', empresaId).eq('dia', hoje).maybeSingle()
			.then(({ data }) => setLiberado(!!data));
	}, [empresaId, hoje]);
	return <CurtasHojeVista h={h} liberado={liberado} />;
}
