// Roleplay › Cenários: biblioteca (Padrão MotorCX + da empresa, filtro na URL: ?f=mx|emp|dif) e o cenário. O Padrão
// MotorCX é só leitura: "Duplicar para editar" cria a cópia em rascunho na empresa (duplicar_cenario_treino) e abre a
// cópia no lugar do original (replace). O cenário da empresa abre no editor (editor.tsx) para quem cuida dos cenários;
// "Novo cenário" abre o editor vazio (/cenarios/novo).
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Aviso, Botao, BotaoLink, Cartao, Estado, LinkTexto, Pilula, SOMBRA, Segmentos, clsBotao } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import {
	DIFICULDADE, FAIXAS_SALDO, FILTROS_CENARIO, GRAVIDADE_RP, ROTA_RP_CENARIOS, ROTA_RP_NOVO_CENARIO, cenarioVazio, ehPadraoMotorCX, filtrarCenarios,
	filtroCenario, formDoCenario, itemChecklist, rotaAtribuir, rotaCenarioRP, rotuloObjecao, rotuloTipoCliente, textoAlcada, textoDuracao, textoModos,
	type CenarioRP, type FiltroCenario, type ItemChecklistRP,
} from '@/lib/roleplay';
import { LinkRP, MolduraRP } from './moldura';
import { EditorCenario } from './editor';
import { Dificuldade, PilulasCenario, SeloLgpdTreino } from './comum';
import { duplicarCenario, lerCenario, lerCenarios, lerItensChecklist } from './dados';
import type { PodeRP } from './index';

// ------------------------------------------------------------------ biblioteca
export function Cenarios({ empresa, pode }: { empresa: number; pode?: PodeRP }) {
	const [q, setQ] = useSearchParams();
	const f = filtroCenario(q.get('f'));
	const [lista, setLista] = useState<CenarioRP[] | null>(null);
	const [itens, setItens] = useState<Record<string, ItemChecklistRP>>({});
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		setLista(null); setErro('');
		Promise.all([lerCenarios(supabase, empresa), lerItensChecklist(supabase, empresa)])
			.then(([l, i]) => { if (ativo) { setLista(l); setItens(i); } })
			.catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa]);
	// Filtro na URL sem empilhar histórico (e sem rolar a página).
	const trocar = (v: FiltroCenario) => setQ(p => { const n = new URLSearchParams(p); if (v === 'todos') n.delete('f'); else n.set('f', v); return n; }, { replace: true, preventScrollReset: true });
	return (
		<MolduraRP titulo="Cenários" descricao="Biblioteca de clientes simulados: Padrão MotorCX e os da empresa."
			acoes={<><SeloLgpdTreino />{pode?.cenarios && <LinkRP to={ROTA_RP_NOVO_CENARIO} className={clsBotao('primario')}>Novo cenário</LinkRP>}</>}>
			{erro ? <Estado tipo="erro" titulo="Não deu para carregar a biblioteca agora.">{erro}</Estado>
				: !lista ? <Estado tipo="carregando" />
				: <ListaCenarios lista={lista} filtro={f} itens={itens} onFiltro={trocar} />}
		</MolduraRP>
	);
}

export function ListaCenarios({ lista, filtro, itens, onFiltro }: { lista: CenarioRP[]; filtro: FiltroCenario; itens: Record<string, ItemChecklistRP>; onFiltro: (f: FiltroCenario) => void }) {
	const vis = filtrarCenarios(lista, filtro);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Segmentos rotulo="Filtrar cenários" valor={filtro} onTrocar={onFiltro} itens={FILTROS_CENARIO.map(x => ({ v: x.v, n: x.n }))} />
				<span className="text-[12.5px] text-[var(--base-texto-3)]" aria-live="polite">{vis.length} {vis.length === 1 ? 'cenário' : 'cenários'}</span>
			</div>
			<Aviso tom="neutro">Cenários <b>Padrão MotorCX</b> são mantidos pela equipe MotorCX e não se editam: abra e use <b>Duplicar para editar</b>. Cenários <b>da empresa</b> são de vocês.</Aviso>
			{vis.length === 0
				? <Estado tipo="vazio" titulo="Nenhum cenário neste filtro.">{filtro === 'emp' ? 'A empresa ainda não tem cenários próprios. Abra um Padrão MotorCX e use “Duplicar para editar” para começar.' : 'Tente outro filtro.'}</Estado>
				: <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{vis.map(c => (
						<li key={c.id} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-[var(--base-cartao)] p-4" style={{ boxShadow: SOMBRA }}>
							<div className="min-w-0">
								<h2 className="text-[15px] font-semibold text-[var(--base-texto)]"><Link to={rotaCenarioRP(c.id)} className="hover:underline">{c.nome}</Link></h2>
								<p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--base-texto-2)]">{c.persona_nome} · <Dificuldade n={c.dificuldade} /></p>
							</div>
							{c.descricao && <p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">{c.descricao}</p>}
							{c.objecoes.length > 0 && <p className="flex flex-wrap gap-1">{c.objecoes.map((o, i) => <Pilula key={i}>{rotuloObjecao(o.codigo)}</Pilula>)}</p>}
							{c.itens_foco.length > 0 && <p className="text-[12px] text-[var(--base-texto-3)]">Em foco: {c.itens_foco.map(i => itemChecklist(i, itens).texto).join(' · ')}</p>}
							<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
								<PilulasCenario c={c} />
								<LinkTexto to={rotaCenarioRP(c.id)}>{ehPadraoMotorCX(c) ? 'Ver e duplicar' : 'Ver'}</LinkTexto>
							</div>
						</li>
					))}
				</ul>}
		</div>
	);
}

// ------------------------------------------------------------------ cenário (leitura)
export function DetalheCenario({ empresa, id, pode }: { empresa: number; id: string; pode: PodeRP }) {
	const navegar = useNavigate();
	const [q] = useSearchParams();
	const [c, setC] = useState<CenarioRP | null | undefined>(undefined);
	const [base, setBase] = useState<Pick<CenarioRP, 'id' | 'nome'> | null>(null);
	const [itens, setItens] = useState<Record<string, ItemChecklistRP>>({});
	const [erro, setErro] = useState('');
	const [duplicando, setDuplicando] = useState(false);
	const num = /^\d{1,18}$/.test(id) ? Number(id) : null;

	useEffect(() => {
		if (!supabase) return;
		const sb = supabase;
		let ativo = true;
		setC(undefined); setErro(''); setBase(null);
		if (num == null) { setC(null); return; }
		Promise.all([lerCenario(sb, empresa, num), lerItensChecklist(sb, empresa)])
			.then(async ([x, i]) => {
				if (!ativo) return;
				setC(x); setItens(i);
				if (x?.base_id) { const b = await lerCenario(sb, empresa, x.base_id).catch(() => null); if (ativo && b) setBase({ id: b.id, nome: b.nome }); }
			})
			.catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, num]);

	async function duplicar() {
		if (!supabase || !c) return;
		setDuplicando(true);
		try {
			const novo = await duplicarCenario(supabase, empresa, c.id);
			toast.success('Cópia criada na biblioteca da empresa, em rascunho.');
			// A cópia toma o lugar do original no histórico: o ⟵ volta para a biblioteca, não para o Padrão MotorCX.
			navegar(`${rotaCenarioRP(novo)}?copia=1`, { replace: true });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Não deu para duplicar.');
		} finally { setDuplicando(false); }
	}

	if (erro) return <MolduraRP titulo="Cenário"><Estado tipo="erro" titulo="Não deu para carregar o cenário agora.">{erro}</Estado></MolduraRP>;
	if (c === undefined) return <MolduraRP titulo="Cenário"><Estado tipo="carregando" /></MolduraRP>;
	if (c === null) return <MolduraRP titulo="Cenário não encontrado"><Estado tipo="vazio" titulo="Cenário não encontrado." acoes={<BotaoLink to={ROTA_RP_CENARIOS}>Ir para Cenários</BotaoLink>}>O endereço pode estar desatualizado, ou o cenário foi arquivado.</Estado></MolduraRP>;

	if (pode.cenarios && !ehPadraoMotorCX(c)) {
		return (
			<EditorCenario key={`${c.id}:${c.atualizado_em ?? ''}`} empresa={empresa} cenario={c} inicial={formDoCenario(c)} itens={itens}
				aviso={q.get('copia') === '1' ? <Aviso tom="ok" titulo="Cópia criada, em rascunho.">Ela já está na biblioteca da empresa. Ajuste o que quiser e publique para poder atribuir.</Aviso> : undefined}
				onSalvo={() => { if (!supabase) return; void lerCenario(supabase, empresa, c.id).then(x => { if (x) setC(x); }).catch(() => {}); }} />
		);
	}
	return (
		<MolduraRP titulo={c.nome} detalhe={c.nome} descricao={descricaoCenario(c)} acoes={<AcoesCenario c={c} pode={pode} duplicando={duplicando} onDuplicar={duplicar} />}>
			<CorpoCenario c={c} itens={itens} base={base} />
		</MolduraRP>
	);
}

/** Editor vazio (/cenarios/novo): ao salvar, dá lugar ao cenário criado (replace). */
export function NovoCenario({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const [itens, setItens] = useState<Record<string, ItemChecklistRP> | null>(null);
	useEffect(() => {
		if (!supabase) return;
		let ativo = true;
		lerItensChecklist(supabase, empresa).then(i => { if (ativo) setItens(i); }).catch(() => { if (ativo) setItens({}); });
		return () => { ativo = false; };
	}, [empresa]);
	if (!pode.cenarios) return <MolduraRP titulo="Novo cenário"><Estado tipo="semPermissao" titulo="Seu perfil não cria cenários.">Quem tem a permissão de editar cenários de treino cria e publica os cenários da empresa. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado></MolduraRP>;
	if (!itens) return <MolduraRP titulo="Novo cenário"><Estado tipo="carregando" /></MolduraRP>;
	return <EditorCenario empresa={empresa} cenario={null} inicial={cenarioVazio()} itens={itens} />;
}

export function descricaoCenario(c: Pick<CenarioRP, 'empresa_id' | 'situacao'>): string {
	if (ehPadraoMotorCX(c)) return 'Cenário Padrão MotorCX · só leitura';
	return `Cenário da empresa${c.situacao === 'rascunho' ? ' · rascunho' : ''}`;
}

export function AcoesCenario({ c, pode, duplicando, onDuplicar }: { c: CenarioRP; pode: PodeRP; duplicando?: boolean; onDuplicar: () => void }) {
	const atribuir = pode.treinar && c.situacao === 'publicado' ? <LinkRP to={rotaAtribuir({ cen: c.id })} className={clsBotao('secundario')}>Atribuir</LinkRP> : null;
	if (!pode.cenarios) return <><SeloLgpdTreino />{atribuir}</>;
	if (ehPadraoMotorCX(c)) return <><SeloLgpdTreino />{atribuir}<Botao onClick={onDuplicar} disabled={duplicando}>{duplicando ? 'Duplicando…' : 'Duplicar para editar'}</Botao></>;
	return <><SeloLgpdTreino />{atribuir}</>;
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-[12px] font-medium text-[var(--base-texto-3)]">{rotulo}</dt>
			<dd className="m-0 mt-0.5 text-[13.5px] leading-relaxed text-[var(--base-texto)]">{children}</dd>
		</div>
	);
}

export function CorpoCenario({ c, itens, base }: { c: CenarioRP; itens: Record<string, ItemChecklistRP>; base?: Pick<CenarioRP, 'id' | 'nome'> | null }) {
	const d = c.divida ?? {};
	const foco = c.itens_foco.map(i => ({ id: i, ...itemChecklist(i, itens) }));
	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
			<div className="min-w-0 space-y-4">
				{ehPadraoMotorCX(c) && <Aviso tom="neutro">Este cenário é <b>Padrão MotorCX</b>. Para mudar o cliente simulado, as objeções, a dificuldade ou os itens em foco, use <b>Duplicar para editar</b>.</Aviso>}
				{base && <p className="text-[12.5px] text-[var(--base-texto-2)]">Cópia de <Link className="font-semibold text-[var(--destaque)] hover:underline" to={rotaCenarioRP(base.id)}>{base.nome}</Link>.</p>}
				<Cartao titulo="Cliente simulado" linha="Quem o operador vai atender. Tudo fictício.">
					<dl className="grid gap-3 sm:grid-cols-2">
						<Campo rotulo="Nome do cliente simulado">{c.persona_nome}</Campo>
						<Campo rotulo="Tipo de cliente">{rotuloTipoCliente(c.perfil)}</Campo>
						{c.descricao && <div className="sm:col-span-2"><Campo rotulo="Resumo">{c.descricao}</Campo></div>}
						<div className="sm:col-span-2"><Campo rotulo="Comportamento">{c.objetivo}</Campo></div>
						{c.comportamentos.length > 0 && <div className="sm:col-span-2"><Campo rotulo="Como age na ligação"><ul className="list-disc pl-5">{c.comportamentos.map((x, i) => <li key={i}>{x}</li>)}</ul></Campo></div>}
						{c.frases.length > 0 && <div className="sm:col-span-2"><Campo rotulo="Frases que o cliente usa"><span className="flex flex-wrap gap-1.5">{c.frases.map((x, i) => <span key={i} className="rounded-lg bg-[var(--base-fill)] px-2 py-0.5 text-[12.5px]">“{x}”</span>)}</span></Campo></div>}
					</dl>
				</Cartao>
				<Cartao titulo="Dívida fictícia" linha="O que aparece na ficha durante o treino. O saldo é sorteado dentro da faixa, nunca copiado de um cliente.">
					<dl className="grid gap-3 sm:grid-cols-2">
						<Campo rotulo="Produto">{d.produto ?? '—'}</Campo>
						<Campo rotulo="Faixa de saldo">{d.faixa ? FAIXAS_SALDO[d.faixa] ?? '—' : '—'}</Campo>
						<Campo rotulo="Dias de atraso">{d.dias_atraso != null ? `${d.dias_atraso} dias` : '—'}</Campo>
						<Campo rotulo="Alçada do treino">{textoAlcada(d.alcada)}</Campo>
					</dl>
				</Cartao>
				<Cartao titulo="Objeções e dificuldade" linha="Na ordem em que o cliente levanta. A dificuldade muda a insistência e o tom.">
					{c.objecoes.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Sem objeção definida.</p> : (
						<ol className="space-y-2">
							{c.objecoes.map((o, i) => (
								<li key={i} className="flex gap-2.5 text-[13.5px]">
									<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--base-fill)] text-[12px] font-bold">{i + 1}</span>
									<span className="min-w-0">{rotuloObjecao(o.codigo)}{o.quando && <small className="block text-[12px] text-[var(--base-texto-3)]">Quando: {o.quando}</small>}</span>
								</li>
							))}
						</ol>
					)}
					<p className="mt-3 flex flex-wrap items-center gap-2 text-[13px]"><b className="font-semibold">Dificuldade {c.dificuldade} de 5</b><Dificuldade n={c.dificuldade} /><span className="text-[var(--base-texto-2)]">{DIFICULDADE[c.dificuldade] ?? ''}</span></p>
				</Cartao>
				<Cartao titulo="Critérios de nota" linha="O mesmo checklist de qualidade que dá nota às ligações. Todos os itens contam; os em foco aparecem no briefing e no feedback.">
					{foco.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhum item em foco: vale o checklist inteiro.</p> : (
						<ul className="space-y-1.5">
							{foco.map(i => (
								<li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
									<span className="min-w-0">{i.texto}</span>
									<Pilula tom={i.gravidade === 'bloqueante' ? 'erro' : 'neutro'}>{GRAVIDADE_RP[i.gravidade] ?? 'Importante'}{i.gravidade === 'bloqueante' ? ' · reprova a sessão' : ''}</Pilula>
								</li>
							))}
						</ul>
					)}
					{c.objetivo_cenario && <p className="mt-3 text-[13px]"><span className="text-[var(--base-texto-3)]">Objetivo do cenário (vira feedback; não muda a nota):</span> {c.objetivo_cenario}</p>}
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">O checklist muda em Speech › Qualidade. O cenário só escolhe o foco.</p>
				</Cartao>
			</div>
			<aside className="min-w-0 space-y-4">
				<Cartao titulo="Sessão">
					<dl className="grid gap-3">
						<Campo rotulo="Modo">{textoModos(c.modos)}</Campo>
						<Campo rotulo="Duração máxima">{textoDuracao(c.duracao_max_s)}</Campo>
					</dl>
				</Cartao>
				<Cartao titulo="Prévia do briefing" linha="O que o operador lê antes de começar.">
					<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">
						“Você vai ligar para <b className="text-[var(--base-texto)]">{c.persona_nome}</b>{d.produto ? `, cliente do ${d.produto}` : ''}{d.dias_atraso != null ? `, ${d.dias_atraso} dias de atraso` : ''}. Alçada: {textoAlcada(d.alcada).toLowerCase()}.{foco.length ? ` Em foco: ${foco.map(i => i.texto.toLowerCase()).join('; ')}.` : ''}”
					</p>
				</Cartao>
				<Aviso tom="neutro">Frases com CPF, telefone ou e-mail são bloqueadas automaticamente, no cenário e na fala do cliente simulado.</Aviso>
			</aside>
		</div>
	);
}
