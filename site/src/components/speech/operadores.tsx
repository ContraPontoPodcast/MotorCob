// Speech Analytics › Operadores. Só a parte humana (depois da transferência), só com o ID do operador vindo do
// discador. Visto por quem tem ver_operadores (Admin e supervisor); o operador com login vê só a própria página.
// Para não humilhar: 4 faixas, ordem alfabética dentro de cada uma, destaque só para os 5 primeiros, nada de
// "último lugar". Menos de 30 ligações = sem nota. Sem ID, o sistema nunca adivinha quem atendeu.
// Redesign v2: a página do operador só abre na gaveta, quando o gestor clica no nome (nada individual aberto no
// corpo); "Revisar exemplos" é a ação principal; as regras de proteção viram o selo "Como protegemos o operador".
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { FAIXAS, MIN_GRUPO, PERM_SA, dataBR, dataHoraBR, dc, faixaDe, nf, pc, porFaixa, sinal, type Operador } from '@/lib/speech';
import { Aviso, Botao, Cartao, Estado, Gaveta, Kpis, Pilula, SeloRegras } from '@/components/ds';
import { BarraFiltros, Bloqueio, SeloPrivacidade, Trecho, type Filtros } from './comum';
import type { DefinirAcoes } from './speech-analytics';
import { COR_HUMANO, Faisca } from './graficos';

type Painel = {
	gestor: boolean; humanas: number | null; sem_operador: number; sem_operador_import: number;
	equipe: { nota: number | null; itens: Record<string, number | null> };
	operadores: Operador[];
	exemplos: { id: number; tag: string; nota: number | null; duracao_s: number | null; trecho: string | null; situacao: string; operador: string | null }[] | null;
};
type Detalhe = {
	ref: string; apelido: string | null; n: number | null; nota: number | null; equipe: number | null;
	itens: { item: string; operador: number | null; equipe: number | null }[]; semanas: { s: string; nota: number | null }[];
	conversar: { avaliacao_id: number; item: string; em: string; trecho: string | null }[] | null;
};

const corFaixa = (k: number) => `color-mix(in oklab, ${COR_HUMANO} ${FAIXAS[k].tom}%, var(--base-cartao))`;

export function Operadores({ f, setDias, setAcoes }: { f: Filtros; setDias: (d: number) => void; setAcoes: DefinirAcoes }) {
	const gestorPerm = usePermissao(PERM_SA.verOperadores);
	const [p, setP] = useState<Painel | null>(null);
	const [sel, setSel] = useState<string | null>(null);
	const [det, setDet] = useState<Detalhe | null>(null);
	const [textos, setTextos] = useState<Record<string, string>>({});
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);
	const [revisar, setRevisar] = useState(false);

	useEffect(() => {
		if (!supabase) return;
		const sb = supabase;
		let ativo = true;
		setLoading(true); setErro('');
		(async () => {
			const [r, ck] = await Promise.all([
				sb.rpc('operadores_voz', { empresa: f.empresaId, credor: f.credorId, de: f.de, ate: f.ate }),
				sb.from('checklist_versoes').select('itens').neq('situacao', 'rascunho').limit(20),
			]);
			if (!ativo) return;
			if (r.error) { setErro(friendlyError(r.error)); setLoading(false); return; }
			const d = r.data as Painel;
			setP(d);
			const t: Record<string, string> = {};
			for (const v of (ck.data ?? []) as { itens: { id: string; texto: string }[] }[]) for (const i of v.itens ?? []) t[i.id] = i.texto;
			setTextos(t);
			// O operador com login vê a própria página no corpo; o gestor escolhe pelo nome (abre na gaveta).
			const { comNota } = porFaixa(d.operadores);
			if (!d.gestor) setSel(s => s ?? comNota[0]?.ref ?? null);
			setLoading(false);
		})();
		return () => { ativo = false; };
	}, [f.empresaId, f.credorId, f.de, f.ate]);

	useEffect(() => {
		if (!supabase || !sel) { setDet(null); return; }
		let ativo = true;
		void supabase.rpc('operador_voz', { empresa: f.empresaId, operador: sel, de: f.de, ate: f.ate }).then(({ data, error }) => {
			if (!ativo) return;
			if (error) { toast.error(friendlyError(error)); return; }
			setDet(data as Detalhe);
		});
		return () => { ativo = false; };
	}, [sel, f.empresaId, f.de, f.ate]);

	async function decidirExemplo(id: number, aprovar: boolean) {
		if (!supabase) return;
		const { error } = await supabase.rpc('decidir_exemplo_treino', { exemplo: id, aprovar });
		if (error) { toast.error(friendlyError(error)); return; }
		setP(x => (x ? { ...x, exemplos: (x.exemplos ?? []).map(e => (e.id === id ? { ...e, situacao: aprovar ? 'aprovado' : 'recusado' } : e)).filter(e => e.situacao !== 'recusado') } : x));
	}

	const propostos = (p?.exemplos ?? []).filter(e => e.situacao === 'proposto').length;
	useEffect(() => {
		setAcoes(p?.gestor && (p.exemplos ?? []).length > 0 ? <Botao tipo={propostos ? 'primario' : 'secundario'} onClick={() => setRevisar(true)}>{propostos ? `Revisar ${propostos} ${propostos === 1 ? 'exemplo' : 'exemplos'}` : 'Ligações-exemplo'}</Botao> : null);
		return () => setAcoes(null);
	}, [p?.gestor, p?.exemplos, propostos, setAcoes]);

	const selo = <SeloRegras rotulo="Como protegemos o operador" regras={[
		{ titulo: '4 faixas, não ranking', texto: 'Abaixo de Referência, a lista é em ordem alfabética: ninguém aparece em último lugar.' },
		{ titulo: 'Destaque só para os 5 primeiros', texto: 'Para reconhecer, nunca para expor.' },
		{ titulo: `Menos de ${MIN_GRUPO} ligações = sem nota`, texto: 'Pouca base não vira julgamento.' },
		{ titulo: 'Só a parte humana da ligação', texto: 'Depois da transferência, com o ID que vem do discador. Sem ID, o MotorCX nunca adivinha quem atendeu.' },
		{ titulo: 'Quem vê', texto: 'A nota por operador é vista por quem tem a permissão Ver operadores (Admin e supervisor). O operador com login vê só a própria página.' },
	]} />;
	const filtros = <BarraFiltros direita={<>{selo}<SeloPrivacidade /></>} dias={f.dias} setDias={setDias} origem="" setOrigem={() => {}} credorNome={f.credorNome} semOrigem />;
	if (erro) {
		if (!gestorPerm) return <>{filtros}<Bloqueio titulo="Seu perfil não vê a nota dos operadores.">A nota por operador é vista pelo Admin e pelo supervisor. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio></>;
		return <>{filtros}<Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado></>;
	}
	if (loading || !p) return <>{filtros}<Estado tipo="carregando" /></>;

	const { comNota, semNota, faixas, top5 } = porFaixa(p.operadores);
	const semId = p.operadores.length === 0 && (p.sem_operador > 0 || p.sem_operador_import > 0);
	const qtdSemId = p.sem_operador_import || p.sem_operador;
	const aviso = semId
		? <Aviso titulo="O discador de vocês não está mandando o ID do operador." acao={<Link className="text-[13px] font-semibold text-[var(--destaque)] hover:underline" to="/envios/gravacoes-discador">Gravações do discador</Link>}>As gravações entram na nota da equipe, mas não dá para avaliar ninguém. Peça ao fornecedor o campo do agente no arquivo de gravação.</Aviso>
		: qtdSemId > 0 ? <Aviso titulo={`${nf(qtdSemId)} gravações chegaram sem o ID do operador.`} acao={<Link className="text-[13px] font-semibold text-[var(--destaque)] hover:underline" to="/envios/gravacoes-discador">Ver</Link>}>Contam na nota da equipe, mas não na de ninguém.</Aviso> : null;

	if (semId || (p.gestor && comNota.length === 0 && semNota.length === 0)) {
		return (<>{filtros}<div className="space-y-4">{aviso}
			<Kpis itens={[
				{ rotulo: 'Ligações humanas avaliadas', valor: nf(p.humanas), detalhe: semId ? 'todas sem operador' : undefined },
				{ rotulo: 'Nota média da equipe', valor: dc(p.equipe.nota), detalhe: 'sem quebra por pessoa' },
				{ rotulo: 'Operadores conhecidos', valor: '0', detalhe: 'o adaptador não recebe o campo' },
			]} />
			<Bloqueio tipo="vazio" titulo="Sem ID, sem nota por operador.">O MotorCX nunca tenta adivinhar quem atendeu pela voz ou pelo horário. Assim que o discador mandar o ID junto com a gravação, a nota por operador começa a contar dali para a frente.</Bloqueio>
		</div></>);
	}

	const cont = faixas.map(x => x.length);
	const tot = Math.max(1, comNota.length);
	const nome = (o: { ref: string; apelido: string | null }) => `${o.ref}${o.apelido ? ` · ${o.apelido}` : ''}`;
	const dif = (det?.itens ?? []).filter(i => i.operador != null && i.equipe != null).map(i => ({ ...i, d: (i.operador as number) - (i.equipe as number) })).sort((a, b) => b.d - a.d);

	const pagina = !det ? <Estado tipo="carregando" titulo="Carregando a página do operador…" compacto /> : det.nota == null ? <p className="text-[13px] text-[var(--base-texto-2)]">Menos de {MIN_GRUPO} ligações avaliadas no período: ainda sem nota.</p> : (
		<>
			<div className="grid grid-cols-3 gap-3">
				<div><small className="text-[12px] text-[var(--base-texto-3)]">Nota</small><div className="text-[26px] font-bold tnum">{dc(det.nota)}</div><small className="text-[12px] text-[var(--base-texto-3)]">{nf(det.n)} ligações</small></div>
				<div><small className="text-[12px] text-[var(--base-texto-3)]">8 semanas</small><Faisca valores={det.semanas.map(s => s.nota)} cor={COR_HUMANO} /></div>
				<div><small className="text-[12px] text-[var(--base-texto-3)]">Equipe</small><div className="text-[26px] font-bold tnum text-[var(--base-texto-2)]">{dc(det.equipe)}</div><small className="text-[12px] text-[var(--base-texto-3)]">média humana</small></div>
			</div>
			<div>
				<h3 className="mb-1 text-[13px] font-semibold">Por item <small className="font-normal text-[var(--base-texto-3)]">· barra: operador · traço: equipe</small></h3>
				{det.itens.map(i => (
					<div key={i.item} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[13px]">
						<span className="truncate">{textos[i.item] ?? i.item}</span>
						<span className="relative h-2 w-full rounded-full bg-[var(--base-fill)]"><i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${i.operador ?? 0}%`, backgroundColor: COR_HUMANO }} />{i.equipe != null && <u className="absolute -top-1 h-4 w-[2px] bg-[var(--base-texto)]" style={{ left: `${i.equipe}%` }} />}</span>
						<b className="tnum">{pc(i.operador, 0)}</b>
					</div>
				))}
			</div>
			{dif.length >= 2 && <div className="grid gap-3 text-[13px] sm:grid-cols-2">
				<div><h3 className="font-semibold">Pontos fortes</h3><ul className="mt-1 list-disc pl-5">{dif.slice(0, 2).map(d => <li key={d.item}>{textos[d.item] ?? d.item} ({sinal(d.d, 0)} p.p.)</li>)}</ul></div>
				<div><h3 className="font-semibold">Pontos de melhoria</h3><ul className="mt-1 list-disc pl-5">{dif.slice(-2).reverse().map(d => <li key={d.item}>{textos[d.item] ?? d.item} ({sinal(d.d, 0)} p.p.)</li>)}</ul></div>
			</div>}
			{(det.conversar ?? []).length > 0 && <div><h3 className="mb-1 text-[13px] font-semibold">Para conversar no 1:1</h3>{(det.conversar ?? []).map(c => <div key={c.avaliacao_id}><Trecho>{c.trecho ?? 'Trecho já apagado (retenção).'}</Trecho><small className="text-[11.5px] text-[var(--base-texto-3)]">{dataHoraBR(c.em)} · {textos[c.item] ?? c.item}</small></div>)}</div>}
			<p className="text-[12px] text-[var(--base-texto-3)]">Criar trilha de treino: fase 2.</p>
		</>
	);
	const exemplos = (p.exemplos ?? []).slice(0, 6);

	return (
		<>
			{filtros}
			<div className="space-y-4">
				{aviso}
				{p.gestor && <Kpis itens={[
					{ rotulo: 'Operadores avaliados', valor: nf(comNota.length), detalhe: semNota.length ? `${semNota.length} com menos de ${MIN_GRUPO} ligações, sem nota` : undefined },
					{ rotulo: 'Nota média da equipe', valor: dc(p.equipe.nota) },
					{ rotulo: 'Ligações-exemplo', valor: nf((p.exemplos ?? []).filter(e => e.situacao === 'aprovado').length), detalhe: 'com o ok do supervisor' },
					{ rotulo: 'Esperando o ok', valor: nf(propostos), detalhe: 'nota 95 ou mais e acordo', tom: propostos ? 'atencao' : undefined },
				]} />}
				{p.gestor && comNota.length > 0 && <Cartao titulo="Distribuição por faixa" linha="Clique num nome para abrir a página do operador.">
					<div className="flex h-7 w-full overflow-hidden rounded-lg" role="img" aria-label={FAIXAS.map((x, k) => `${x.nome}: ${cont[k]}`).join(', ')}>
						{FAIXAS.map((x, k) => cont[k] > 0 && <i key={x.id} className="grid place-items-center text-[11.5px] font-semibold not-italic" style={{ flex: `${cont[k]} 1 0`, backgroundColor: corFaixa(k), color: x.tom > 70 ? 'var(--base-cartao)' : 'var(--base-texto)' }} title={`${x.nome}: ${cont[k]}`}>{cont[k] / tot >= 0.12 ? `${cont[k]} · ${Math.round((100 * cont[k]) / tot)}%` : ''}</i>)}
					</div>
					<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						{FAIXAS.map((x, k) => (
							<div key={x.id} className="min-w-0">
								<h3 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--base-texto)]"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corFaixa(k) }} />{x.nome}<small className="font-normal text-[var(--base-texto-3)]">{x.regra}</small></h3>
								{faixas[k].length === 0 ? <p className="px-2 py-1.5 text-[12px] text-[var(--base-texto-3)]">Ninguém nesta faixa.</p> : faixas[k].map(o => (
									<button key={o.ref} type="button" aria-haspopup="dialog" onClick={() => setSel(o.ref)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[var(--base-fill)]">
										<span className="truncate">{nome(o)}</span><b className="tnum">{dc(o.nota)}</b>
									</button>
								))}
							</div>
						))}
					</div>
				</Cartao>}
				{p.gestor && top5.length > 0 && <Cartao titulo="Destaques do mês" linha="Só os 5 primeiros, para reconhecer">
					<div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-5">
						{top5.map((o, i) => <button key={o.ref} type="button" onClick={() => setSel(o.ref)} className="flex items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] hover:bg-[var(--base-fill)]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--base-fill)] text-[12px] font-bold">{i + 1}</span><span className="min-w-0 flex-1 truncate">{nome(o)}</span><b className="tnum">{dc(o.nota)}</b></button>)}
					</div>
				</Cartao>}
				{!p.gestor && <Cartao titulo={det ? nome(det) : 'Sua página'} linha="Só você e os gestores veem esta página." direita={det?.nota != null ? <Pilula>{FAIXAS[faixaDe(det.nota)].nome}</Pilula> : undefined}><div className="space-y-4">{pagina}</div></Cartao>}
				<p className="text-[12px] text-[var(--base-texto-3)]">Período: {dataBR(f.de)} a {dataBR(f.ate)}.</p>
			</div>

			<Gaveta aberta={p.gestor && !!sel} onFechar={() => setSel(null)} largura={560} titulo={det && det.ref === sel ? nome(det) : sel ?? ''}
				subtitulo={<>Visto só por quem tem a permissão Ver operadores. {det?.nota != null && <Pilula>{FAIXAS[faixaDe(det.nota)].nome}</Pilula>}</>}>
				{pagina}
			</Gaveta>
			<Gaveta aberta={revisar} onFechar={() => setRevisar(false)} titulo="Ligações-exemplo para treino" subtitulo="Trechos mascarados. Entram na biblioteca só com o ok do supervisor.">
				{exemplos.length === 0 ? <Estado tipo="vazio" compacto titulo="Nenhum exemplo ainda." /> : exemplos.map(e => (
					<div key={e.id} className="border-b pb-3 last:border-0" style={{ borderColor: 'var(--base-borda)' }}>
						<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{e.tag}</b><span>{e.operador ?? ''}{e.nota != null ? ` · nota ${dc(e.nota, 0)}` : ''}</span>{e.situacao === 'aprovado' ? <Pilula tom="ok">Na biblioteca</Pilula> : null}</div>
						{e.trecho && <Trecho>{e.trecho}</Trecho>}
						{e.situacao === 'proposto' && <div className="mt-2 flex gap-2"><Botao pequeno onClick={() => void decidirExemplo(e.id, true)}>Aprovar</Botao><Botao pequeno tipo="secundario" onClick={() => void decidirExemplo(e.id, false)}>Recusar</Botao></div>}
					</div>
				))}
			</Gaveta>
		</>
	);
}
