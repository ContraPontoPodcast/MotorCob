// Empresa › Faturamento › Demonstrativo do Agente de voz (minuto falado com a IA, SQL 127; protótipo aprovado, tela 4).
// Resumo do mês, dia a dia, as primeiras ligações (cada uma abre "Como foi cobrada", com a linha do tempo e o marco de
// onde a cobrança para) e duas planilhas (por ligação e resumo: ";" com BOM e vírgula decimal). Fatura fechada mostra o
// que ficou congelado. Quem vê é quem tem ver_faturamento (o banco confere). Sem telefone nem cliente.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, moneyBR, today, type Row } from '@/lib/supabase';
import { mesExtenso } from '@/lib/empresa-helpers';
import { baixarTexto, competencias, inteiro, reais } from '@/lib/voz';
import { csvLigacoesIa, csvResumoIa, textoSegundos, totalMesIa } from '@/lib/minuto-ia';
import { Cartao, Vazio, btnPrim, btnSec } from '@/components/comuns/voz-ui';
import { Estado, Gaveta, Kpis, ListaValores, Pilula, Tabela } from '@/components/ds';

const nomeMes = (comp: string) => { const m = mesExtenso(comp.slice(0, 7)); return m ? m.charAt(0).toUpperCase() + m.slice(1) : comp; };
const hora = (v: unknown) => (v ? new Date(String(v)).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
const diaBR = (v: unknown) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const MAQUINA = new Set(['maquina', 'caixa_postal']);

export function DemonstrativoMinutoIa({ empresaId, empresaSlug }: { empresaId: string; empresaSlug: string }) {
	const [params, setParams] = useSearchParams();
	const opcoes = useMemo(() => competencias(today(), 6), []);
	const pedido = params.get('c');
	const comp = opcoes.find(o => pedido && o.startsWith(pedido)) ?? opcoes[0];
	const [resumo, setResumo] = useState<Row[] | null>(null);
	const [ligacoes, setLigacoes] = useState<Row[]>([]);
	const [erro, setErro] = useState('');
	const [baixando, setBaixando] = useState('');
	const [sel, setSel] = useState<Row | null>(null);

	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		setResumo(null); setErro('');
		(async () => {
			const eid = Number(empresaId);
			const [r, d] = await Promise.all([
				supabase!.rpc('resumo_ia_voz', { empresa: eid, competencia: comp }),
				supabase!.rpc('demonstrativo_ia_voz', { empresa: eid, competencia: comp, pagina: 0 }),
			]);
			if (!ativo) return;
			if (r.error || d.error) { setErro(friendlyError(r.error ?? d.error)); setResumo([]); return; }
			setResumo((r.data ?? []) as Row[]);
			setLigacoes((d.data ?? []) as Row[]);
		})();
		return () => { ativo = false; };
	}, [empresaId, comp]);

	const dias = useMemo(() => {
		const m = new Map<string, Row>();
		for (const l of resumo ?? []) {
			const k = String(l.dia);
			const a = m.get(k) ?? { dia: l.dia, ligacoes: 0, ligacoes_cobradas: 0, segundos_ia: 0, segundos_ia_tarifados: 0, valor: 0 };
			for (const c of ['ligacoes', 'ligacoes_cobradas', 'segundos_ia', 'segundos_ia_tarifados', 'valor']) a[c] = Number(a[c] ?? 0) + Number(l[c] ?? 0);
			m.set(k, a);
		}
		return [...m.values()];
	}, [resumo]);
	const tot = totalMesIa(resumo ?? []);
	const congelado = (resumo ?? []).some(l => l.congelado);
	const precos = [...new Set((resumo ?? []).filter(l => l.preco_minuto_ia != null).map(l => Number(l.preco_minuto_ia)))];

	async function baixar(qual: 'ligacoes' | 'resumo') {
		if (!supabase) return;
		setBaixando(qual);
		try {
			const sufixo = `${empresaSlug || empresaId}-${comp.slice(0, 7)}`;
			if (qual === 'resumo') {
				baixarTexto(`minuto-falado-resumo-${sufixo}.csv`, csvResumoIa(resumo ?? []));
			} else {
				const todas: Row[] = [];
				for (let p = 0; p < 500; p++) {
					const { data, error } = await supabase.rpc('demonstrativo_ia_voz', { empresa: Number(empresaId), competencia: comp, pagina: p });
					if (error) throw error;
					const pg = (data ?? []) as Row[];
					todas.push(...pg);
					if (pg.length < 1000) break;
				}
				baixarTexto(`minuto-falado-ligacoes-${sufixo}.csv`, csvLigacoesIa(todas));
			}
			toast.success('Planilha pronta.');
		} catch (e) {
			toast.error(friendlyError(e as { message?: string }));
		} finally {
			setBaixando('');
		}
	}

	const trocar = (c: string) => { const p = new URLSearchParams(params); p.set('c', c.slice(0, 7)); setParams(p, { replace: true }); };

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="min-w-0 flex-[1_1_300px]">
					<h2 className="text-[19px] font-semibold text-[var(--base-texto)]">Demonstrativo do Agente de voz</h2>
					<p className="mt-0.5 text-[13px] text-[var(--base-texto-2)]">Minuto falado com a IA: a cobrança para quando a transferência para o humano começa. A telefonia fica fora da fatura.</p>
				</div>
				<label className="flex items-center gap-2 rounded-lg border border-[var(--base-field-border)] bg-[var(--base-cartao)] px-3 py-1.5 text-[13px] text-[var(--base-texto)]">
					<CalendarDays size={14} className="text-[var(--base-texto-2)]" aria-hidden="true" />
					<select aria-label="Competência" value={comp} onChange={e => trocar(e.target.value)} className="!border-0 bg-transparent pr-1 text-[13px] text-[var(--base-texto)] outline-none">
						{opcoes.map((c, i) => <option key={c} value={c}>{nomeMes(c)}{i === 0 ? ' (até agora)' : ''}</option>)}
					</select>
				</label>
			</div>

			{erro ? <Estado tipo="erro" titulo="Não deu para carregar o demonstrativo.">{erro}</Estado> : resumo == null ? <Estado tipo="carregando" /> : <>
				<Kpis itens={[
					{ rotulo: 'Agente de voz no mês', valor: moneyBR(tot.valor), detalhe: congelado ? 'fatura fechada (congelado)' : 'minutos tarifados × preço' },
					{ rotulo: 'Minutos tarifados', valor: tot.minutos.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), detalhe: precos.length ? `preço ${precos.map(p => reais(p, 2)).join(' e ')}` : undefined },
					{ rotulo: 'Minutos falados', valor: (Math.round(tot.segundos / 6) / 10).toLocaleString('pt-BR'), detalhe: 'antes da cadência' },
					{ rotulo: 'Ligações cobradas', valor: inteiro(tot.cobradas), detalhe: `de ${inteiro(tot.ligacoes)} atendidas` },
				]} />
				<div className="flex flex-wrap gap-2">
					<button type="button" onClick={() => void baixar('ligacoes')} disabled={!!baixando || tot.ligacoes === 0} className={btnPrim}><FileDown size={15} /> {baixando === 'ligacoes' ? 'Gerando...' : 'Baixar planilha por ligação'}</button>
					<button type="button" onClick={() => void baixar('resumo')} disabled={!!baixando || tot.ligacoes === 0} className={btnSec}><FileDown size={15} /> Baixar resumo</button>
				</div>

				<Cartao semPad titulo="Dia a dia">
					<Tabela rotulo="Dia a dia" linhas={dias} chave={d => String(d.dia)}
						vazio={<div className="px-1"><Vazio titulo="Nenhuma ligação com a IA neste mês">As ligações aparecem aqui assim que terminam. No modo Simulado nada é cobrado.</Vazio></div>}
						colunas={[
							{ id: 'dia', titulo: 'Dia', celula: d => diaBR(d.dia) },
							{ id: 'lig', titulo: 'Ligações', num: true, celula: d => `${inteiro(d.ligacoes_cobradas)} de ${inteiro(d.ligacoes)}` },
							{ id: 'fal', titulo: 'Falado', num: true, celula: d => textoSegundos(d.segundos_ia) },
							{ id: 'tar', titulo: 'Tarifado', num: true, celula: d => textoSegundos(d.segundos_ia_tarifados) },
							{ id: 'val', titulo: 'Valor', num: true, celula: d => <b>{reais(d.valor, 2)}</b> },
						]}
						celular={d => ({ titulo: diaBR(d.dia), valor: reais(d.valor, 2), resumo: `${inteiro(d.ligacoes_cobradas)} ligações · ${textoSegundos(d.segundos_ia_tarifados)}` })}
						rodape={dias.length ? <><span>Total arredondado só no fim: Σ segundos tarifados × preço ÷ 60.</span><b className="tnum text-[var(--base-texto)]">{moneyBR(tot.valor)}</b></> : undefined} />
				</Cartao>

				<Cartao semPad titulo="Primeiras ligações" desc="Toque numa ligação para ver como ela foi cobrada. A planilha por ligação traz todas.">
					<Tabela rotulo="Primeiras ligações" linhas={ligacoes.slice(0, 10)} chave={l => String(l.id)} onAbrir={setSel} selecionada={sel ? String(sel.id) : null}
						vazio="Nenhuma ligação neste mês."
						colunas={[
							{ id: 'ini', titulo: 'Início', celula: l => `${diaBR(l.dia)} ${hora(l.atendida_em)}` },
							{ id: 'fal', titulo: 'Falado', num: true, celula: l => textoSegundos(l.segundos_ia) },
							{ id: 'tar', titulo: 'Tarifado', num: true, celula: l => MAQUINA.has(String(l.desfecho)) ? <Pilula tom="neutro">não cobrada</Pilula> : `${inteiro(l.segundos_ia_tarifados)} s` },
							{ id: 'val', titulo: 'Valor', num: true, celula: l => (l.valor_ia == null ? '—' : <b>{reais(l.valor_ia, 4)}</b>) },
						]}
						celular={l => ({ titulo: `${diaBR(l.dia)} ${hora(l.atendida_em)}`, valor: l.valor_ia == null ? '—' : reais(l.valor_ia, 4), resumo: `${textoSegundos(l.segundos_ia)} falados · ${inteiro(l.segundos_ia_tarifados)} s tarifados` })} />
				</Cartao>
			</>}

			<Gaveta aberta={!!sel} onFechar={() => setSel(null)} titulo="Como foi cobrada" subtitulo={sel ? `Ligação ${String(sel.id_chamada).slice(0, 12)}` : undefined}>
				{sel && <ComoFoiCobrada l={sel} />}
			</Gaveta>
		</div>
	);
}

/** Linha do tempo da ligação e a conta: o marco vermelho é onde a cobrança para (início da transferência). */
export function ComoFoiCobrada({ l }: { l: Row }) {
	const marcos: { quando: unknown; texto: string; para?: boolean }[] = [
		{ quando: l.atendida_em, texto: 'Atendeu' },
		{ quando: l.ia_inicio_em, texto: 'A IA começou a falar' },
		{ quando: l.ia_fim_em, texto: l.transferida_em && l.ia_retomada_em == null ? 'Transferência para o humano: a cobrança para aqui' : l.ia_retomada_em ? 'Transferência: a cobrança para enquanto toca' : 'A conversa com a IA acabou', para: !!l.transferida_em },
		...(l.ia_retomada_em ? [{ quando: l.ia_retomada_em, texto: 'Ninguém atendeu: o agente voltou e volta a contar' }] : []),
		{ quando: l.encerrada_em, texto: 'Fim da ligação' },
	].filter(m => m.quando);
	const maquina = MAQUINA.has(String(l.desfecho));
	return (
		<div className="space-y-4">
			<ol className="relative space-y-3 border-l border-[var(--base-borda)] pl-4">
				{marcos.map((m, i) => (
					<li key={i} className="text-[13px]">
						<span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.para ? 'var(--estado-erro)' : 'var(--base-texto-3)' }} aria-hidden="true" />
						<b className="tnum">{hora(m.quando)}</b> <span className={m.para ? 'font-semibold text-[var(--estado-erro-texto)]' : 'text-[var(--base-texto-2)]'}>{m.texto}</span>
					</li>
				))}
			</ol>
			<ListaValores itens={[
				['Falado com a IA', textoSegundos(l.segundos_ia)],
				['Cadência', l.cadencia_ia ? String(l.cadencia_ia) : 'licença (sem cadência)'],
				['Tarifado', maquina ? '0 s (máquina/caixa postal não é cobrada)' : `${inteiro(l.segundos_ia_tarifados)} s`],
				['Preço do minuto', l.preco_minuto_ia == null ? '—' : reais(l.preco_minuto_ia, 2)],
				['Valor', l.valor_ia == null ? '—' : reais(l.valor_ia, 4)],
			]} />
			<p className="text-[12px] text-[var(--base-texto-3)]">A cadência vale uma vez por ligação, sobre a soma dos trechos com a IA. O toque da transferência e a conversa com o humano não entram.</p>
		</div>
	);
}
