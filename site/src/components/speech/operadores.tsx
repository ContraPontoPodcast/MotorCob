// Speech Analytics › Operadores. Só a parte humana (depois da transferência), só com o ID do operador vindo do
// discador. Visto por quem tem ver_operadores (Admin e supervisor); o operador com login vê só a própria página.
// Para não humilhar: 4 faixas, ordem alfabética dentro de cada uma, destaque só para os 5 primeiros, nada de
// "último lugar". Menos de 30 ligações = sem nota. Sem ID, o sistema nunca adivinha quem atendeu.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Loading, Notice, usePermissao } from '@/components/app-shell';
import { supabase, friendlyError } from '@/lib/supabase';
import { FAIXAS, MIN_GRUPO, PERM_SA, dataBR, dataHoraBR, dc, faixaDe, nf, pc, porFaixa, sinal, type Operador } from '@/lib/speech';
import { Aviso, Botao, Cartao, Kpi, Pilula } from '@/components/voz/ui';
import { BarraFiltros, Bloqueio, Trecho, type Filtros } from './comum';
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

export function Operadores({ f, setDias }: { f: Filtros; setDias: (d: number) => void }) {
	const gestorPerm = usePermissao(PERM_SA.verOperadores);
	const [p, setP] = useState<Painel | null>(null);
	const [sel, setSel] = useState<string | null>(null);
	const [det, setDet] = useState<Detalhe | null>(null);
	const [textos, setTextos] = useState<Record<string, string>>({});
	const [erro, setErro] = useState('');
	const [loading, setLoading] = useState(true);

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
			const { comNota } = porFaixa(d.operadores);
			setSel(s => s ?? comNota[0]?.ref ?? null);
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

	const filtros = <BarraFiltros dias={f.dias} setDias={setDias} origem="" setOrigem={() => {}} credorNome={f.credorNome} semOrigem />;
	if (erro) {
		if (!gestorPerm) return <>{filtros}<Bloqueio titulo="Seu perfil não vê a nota dos operadores.">A nota por operador é vista pelo Admin e pelo supervisor com a permissão ver_operadores. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Bloqueio></>;
		return <>{filtros}<Notice>{erro}</Notice></>;
	}
	if (loading || !p) return <>{filtros}<Loading /></>;

	const { comNota, semNota, faixas, top5 } = porFaixa(p.operadores);
	const semId = p.operadores.length === 0 && (p.sem_operador > 0 || p.sem_operador_import > 0);
	const aviso = semId
		? <Aviso titulo="O discador de vocês não está mandando o ID do operador.">As gravações importadas entram na nota da equipe, mas não dá para avaliar ninguém. Peça ao fornecedor o campo do agente no arquivo de gravação; a equipe MotorCX ajusta o adaptador em <Link className="underline" to="/envios/gravacoes-discador">Cargas › Gravações do discador</Link>.</Aviso>
		: p.sem_operador_import > 0 || p.sem_operador > 0 ? <Aviso titulo={`${nf(p.sem_operador_import || p.sem_operador)} gravações chegaram sem o ID do operador.`}>Elas contam na nota da equipe, mas não na de ninguém. <Link className="underline" to="/envios/gravacoes-discador">Ver em Gravações do discador</Link>.</Aviso> : null;

	if (semId || (p.gestor && comNota.length === 0 && semNota.length === 0)) {
		return (<>{filtros}<div className="space-y-4">{aviso}
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Kpi rotulo="Ligações humanas avaliadas" valor={nf(p.humanas)} detalhe={semId ? 'todas sem operador' : undefined} />
				<Kpi rotulo="Nota média da equipe" valor={dc(p.equipe.nota)} detalhe="sem quebra por pessoa" />
				<Kpi rotulo="Operadores conhecidos" valor="0" detalhe="o adaptador não recebe o campo" />
			</div>
			<Bloqueio titulo="Sem ID, sem nota por operador.">O MotorCX nunca tenta adivinhar quem atendeu pela voz ou pelo horário. Assim que o discador mandar o ID junto com a gravação, a nota por operador começa a contar dali para a frente.</Bloqueio>
		</div></>);
	}

	const cont = faixas.map(x => x.length);
	const tot = Math.max(1, comNota.length);
	const nome = (o: { ref: string; apelido: string | null }) => `${o.ref}${o.apelido ? ` · ${o.apelido}` : ''}`;
	const dif = (det?.itens ?? []).filter(i => i.operador != null && i.equipe != null).map(i => ({ ...i, d: (i.operador as number) - (i.equipe as number) })).sort((a, b) => b.d - a.d);

	return (
		<>
			{filtros}
			<div className="space-y-4">
				{aviso}
				{p.gestor && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<Kpi rotulo="Operadores avaliados" valor={nf(comNota.length)} detalhe={semNota.length ? `${semNota.length} com menos de ${MIN_GRUPO} ligações, sem nota` : undefined} />
					<Kpi rotulo="Nota média da equipe" valor={dc(p.equipe.nota)} />
					<Kpi rotulo="Ligações-exemplo" valor={nf((p.exemplos ?? []).filter(e => e.situacao === 'aprovado').length)} detalhe="com o ok do supervisor" />
					<Kpi rotulo="Esperando o ok" valor={nf((p.exemplos ?? []).filter(e => e.situacao === 'proposto').length)} detalhe="nota 95 ou mais e acordo" />
				</div>}
				{p.gestor && comNota.length > 0 && <Cartao titulo="Distribuição por faixa" linha="Ninguém aparece em posição de último: abaixo de Referência, a lista é por ordem alfabética.">
					<div className="flex h-7 w-full overflow-hidden rounded-lg" role="img" aria-label={FAIXAS.map((x, k) => `${x.nome}: ${cont[k]}`).join(', ')}>
						{FAIXAS.map((x, k) => cont[k] > 0 && <i key={x.id} className="grid place-items-center text-[11.5px] font-semibold not-italic" style={{ flex: `${cont[k]} 1 0`, backgroundColor: corFaixa(k), color: x.tom > 70 ? 'var(--base-cartao)' : 'var(--base-texto)' }} title={`${x.nome}: ${cont[k]}`}>{cont[k] / tot >= 0.12 ? `${cont[k]} · ${Math.round((100 * cont[k]) / tot)}%` : ''}</i>)}
					</div>
				</Cartao>}
				{p.gestor && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
					{FAIXAS.map((x, k) => (
						<div key={x.id} className="rounded-2xl bg-[var(--base-cartao)] p-3" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
							<h3 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--base-texto)]"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corFaixa(k) }} />{x.nome}<small className="font-normal text-[var(--base-texto-3)]">{x.regra}</small></h3>
							<p className="mb-2 text-[12px] text-[var(--base-texto-2)]">{x.texto}</p>
							{faixas[k].length === 0 ? <p className="text-[12px] text-[var(--base-texto-3)]">Ninguém nesta faixa.</p> : faixas[k].map(o => (
								<button key={o.ref} type="button" aria-pressed={sel === o.ref} onClick={() => setSel(o.ref)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[var(--base-fill)]" style={{ backgroundColor: sel === o.ref ? 'var(--base-fill)' : undefined }}>
									<span className="truncate">{nome(o)}</span><b className="tnum">{dc(o.nota)}</b>
								</button>
							))}
						</div>
					))}
				</div>}
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
					<Cartao titulo={det ? nome(det) : 'Escolha um operador'} linha="Visto só por gestores com a permissão ver_operadores. O operador vê a própria página." direita={det?.nota != null ? <Pilula>{FAIXAS[faixaDe(det.nota)].nome}</Pilula> : undefined}>
						{!det ? <p className="text-[13px] text-[var(--base-texto-2)]">Clique num nome acima.</p> : det.nota == null ? <p className="text-[13px] text-[var(--base-texto-2)]">Menos de {MIN_GRUPO} ligações avaliadas no período: ainda sem nota.</p> : (
							<>
								<div className="grid grid-cols-3 gap-3">
									<div><small className="text-[12px] text-[var(--base-texto-3)]">Nota</small><div className="text-[28px] font-bold tnum">{dc(det.nota)}</div><small className="text-[12px] text-[var(--base-texto-3)]">{nf(det.n)} ligações</small></div>
									<div><small className="text-[12px] text-[var(--base-texto-3)]">8 semanas</small><Faisca valores={det.semanas.map(s => s.nota)} cor={COR_HUMANO} /></div>
									<div><small className="text-[12px] text-[var(--base-texto-3)]">Equipe</small><div className="text-[28px] font-bold tnum text-[var(--base-texto-2)]">{dc(det.equipe)}</div><small className="text-[12px] text-[var(--base-texto-3)]">média humana</small></div>
								</div>
								<h3 className="mb-1 mt-4 text-[13px] font-semibold">Por item <small className="font-normal text-[var(--base-texto-3)]">· barra: operador · traço: equipe</small></h3>
								{det.itens.map(i => (
									<div key={i.item} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[13px]">
										<span className="truncate">{textos[i.item] ?? i.item}</span>
										<span className="relative h-2 w-full rounded-full bg-[var(--base-fill)]"><i className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${i.operador ?? 0}%`, backgroundColor: COR_HUMANO }} />{i.equipe != null && <u className="absolute -top-1 h-4 w-[2px] bg-[var(--base-texto)]" style={{ left: `${i.equipe}%` }} />}</span>
										<b className="tnum">{pc(i.operador, 0)}</b>
									</div>
								))}
								{dif.length >= 2 && <div className="mt-3 grid gap-3 sm:grid-cols-2 text-[13px]">
									<div><h3 className="font-semibold">Pontos fortes</h3><ul className="mt-1 list-disc pl-5">{dif.slice(0, 2).map(d => <li key={d.item}>{textos[d.item] ?? d.item} ({sinal(d.d, 0)} p.p.)</li>)}</ul></div>
									<div><h3 className="font-semibold">Pontos de melhoria</h3><ul className="mt-1 list-disc pl-5">{dif.slice(-2).reverse().map(d => <li key={d.item}>{textos[d.item] ?? d.item} ({sinal(d.d, 0)} p.p.)</li>)}</ul></div>
								</div>}
								{(det.conversar ?? []).length > 0 && <><h3 className="mb-1 mt-4 text-[13px] font-semibold">Para conversar no 1:1</h3>{(det.conversar ?? []).map(c => <div key={c.avaliacao_id}><Trecho>{c.trecho ?? 'Trecho já apagado (retenção).'}</Trecho><small className="text-[11.5px] text-[var(--base-texto-3)]">{dataHoraBR(c.em)} · {textos[c.item] ?? c.item}</small></div>)}</>}
							</>
						)}
					</Cartao>
					{p.gestor && <div className="flex flex-col gap-4">
						<Cartao titulo="Destaques do mês" linha="Só os 5 primeiros, para reconhecer">
							{top5.map((o, i) => <div key={o.ref} className="flex items-center gap-3 py-1 text-[13px]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--base-fill)] text-[12px] font-bold">{i + 1}</span><span className="flex-1 truncate">{nome(o)}</span><b className="tnum">{dc(o.nota)}</b></div>)}
						</Cartao>
						<Cartao titulo="Ligações-exemplo para treino" linha="Trechos mascarados. Entram na biblioteca só com o ok do supervisor.">
							{(p.exemplos ?? []).length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhum exemplo ainda.</p> : (p.exemplos ?? []).slice(0, 6).map(e => (
								<div key={e.id} className="mb-3">
									<div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--base-texto-2)]"><b className="text-[var(--base-texto)]">{e.tag}</b><span>{e.operador ?? ''}{e.nota != null ? ` · nota ${dc(e.nota, 0)}` : ''}</span>{e.situacao === 'aprovado' ? <Pilula tom="ok">Na biblioteca</Pilula> : null}</div>
									{e.trecho && <Trecho>{e.trecho}</Trecho>}
									{e.situacao === 'proposto' && <div className="mt-1.5 flex gap-2"><Botao onClick={() => void decidirExemplo(e.id, true)}>Aprovar</Botao><Botao secundario onClick={() => void decidirExemplo(e.id, false)}>Recusar</Botao></div>}
								</div>
							))}
						</Cartao>
					</div>}
				</div>
				<p className="text-[12px] text-[var(--base-texto-3)]">Período: {dataBR(f.de)} a {dataBR(f.ate)}. A trilha de treino com roleplay fica na fase 2.</p>
			</div>
		</>
	);
}
