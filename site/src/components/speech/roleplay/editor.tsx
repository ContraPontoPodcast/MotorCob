// Roleplay › editor de cenário (PR 4 do Roleplay): criar (/cenarios/novo), editar o cenário da empresa
// (/cenarios/:id) e duplicar. Cliente simulado (nome sempre "(fictícia/o)", tipo de cliente, comportamento, frases),
// dívida fictícia (produto, faixa de saldo, atraso, alçada), objeções na ordem, dificuldade, itens do checklist em foco,
// modo e duração. Grava só por salvar_cenario_treino (SQL 90), com as mesmas regras do banco antes de enviar
// (validarCenario em lib/roleplay.ts). Sair com alterações não salvas pede confirmação: "Continuar editando",
// "Salvar rascunho e sair" ou "Descartar" (links internos e ⟵ do navegador; recarregar/fechar a aba usa o aviso do
// navegador). O Padrão MotorCX não abre aqui: ele é só leitura e se duplica (cenarios.tsx).
// LGPD: tudo ficção. Frases com CPF, telefone ou e-mail são recusadas aqui e no banco.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { ArrowUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { Aviso, Botao, Cartao, Modal, Pilula, campoCls, campoStyle, textareaCls } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import {
	DIFICULDADE, FAIXAS_SALDO, GRAVIDADE_RP, ITENS_PADRAO, LIMITES_CENARIO, OBJECOES_TREINO, TIPOS_CLIENTE, dadosCenario, itemChecklist, mesmoForm,
	rotaAtribuir, rotaCenarioRP, rotuloObjecao, textoAlcada, validarCenario,
	type CenarioRP, type ErrosCenario, type FormCenario, type ItemChecklistRP,
} from '@/lib/roleplay';
import { LinkRP, MolduraRP } from './moldura';
import { PilulasCenario, SeloLgpdTreino } from './comum';
import { duplicarCenario, salvarCenario } from './dados';

type Situacao = 'rascunho' | 'publicado';

/** Editor com a guarda de saída (precisa do roteador de dados: useBlocker). */
export function EditorCenario({ empresa, cenario, inicial, itens, onSalvo, aviso }: {
	empresa: number; cenario: CenarioRP | null; inicial: FormCenario; itens: Record<string, ItemChecklistRP>;
	onSalvo?: (id: number) => void; aviso?: ReactNode;
}) {
	const navegar = useNavigate();
	const [f, setF] = useState<FormCenario>(inicial);
	const [base, setBase] = useState<FormCenario>(inicial);
	const [erros, setErros] = useState<ErrosCenario>({});
	const [ocupado, setOcupado] = useState(false);
	const sujo = !mesmoForm(f, base);

	const blocker = useBlocker(({ currentLocation, nextLocation }) => sujo && !ocupado && currentLocation.pathname !== nextLocation.pathname);
	useEffect(() => {
		if (!sujo) return;
		const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
		window.addEventListener('beforeunload', aviso);
		return () => window.removeEventListener('beforeunload', aviso);
	}, [sujo]);

	async function salvar(situacao: Situacao): Promise<number | null> {
		if (!supabase) return null;
		const e = validarCenario(f);
		setErros(e);
		if (Object.keys(e).length) {
			toast.error('Confira os campos marcados antes de salvar.');
			return null;
		}
		setOcupado(true);
		try {
			const id = await salvarCenario(supabase, empresa, dadosCenario(f, situacao), cenario?.id ?? null);
			setBase(f);
			toast.success(situacao === 'publicado' ? (cenario?.situacao === 'publicado' ? 'Alterações salvas na biblioteca.' : 'Cenário publicado na biblioteca.') : 'Rascunho salvo.');
			return id;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Não deu para salvar.');
			return null;
		} finally { setOcupado(false); }
	}

	async function salvarEFicar(situacao: Situacao) {
		const id = await salvar(situacao);
		if (id == null) return;
		if (!cenario) navegar(rotaCenarioRP(id), { replace: true });   // o formulário "novo" dá lugar ao cenário criado
		else onSalvo?.(id);
	}

	async function duplicar() {
		if (!supabase || !cenario) return;
		setOcupado(true);
		try {
			const novo = await duplicarCenario(supabase, empresa, cenario.id);
			toast.success('Cópia criada, em rascunho.');
			navegar(`${rotaCenarioRP(novo)}?copia=1`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Não deu para duplicar.');
		} finally { setOcupado(false); }
	}

	const publicado = cenario?.situacao === 'publicado';
	const titulo = cenario ? cenario.nome : 'Novo cenário';
	const acoes = (
		<>
			<SeloLgpdTreino />
			{sujo && <Pilula tom="atencao">Alterações não salvas</Pilula>}
			{cenario && <Botao tipo="secundario" onClick={duplicar} disabled={ocupado}>Duplicar</Botao>}
			{publicado
				? <Botao onClick={() => void salvarEFicar('publicado')} disabled={ocupado || !sujo}>{ocupado ? 'Salvando…' : 'Salvar alterações'}</Botao>
				: <>
					<Botao tipo="secundario" onClick={() => void salvarEFicar('rascunho')} disabled={ocupado}>Salvar rascunho</Botao>
					<Botao onClick={() => void salvarEFicar('publicado')} disabled={ocupado}>Publicar na biblioteca</Botao>
				</>}
		</>
	);
	return (
		<MolduraRP titulo={titulo} detalhe={cenario?.nome ?? null}
			descricao={cenario ? `Cenário da empresa${publicado ? ' · na biblioteca' : ' · rascunho'}` : 'Tudo fictício: nome com “(fictícia)”, saldo sorteado na faixa, produto de exemplo.'}
			acoes={acoes}>
			{aviso && <div className="mb-4">{aviso}</div>}
			<FormCenarioView f={f} erros={erros} itens={itens} cenario={cenario} onMudar={x => setF(v => ({ ...v, ...x }))} />
			{blocker.state === 'blocked' && (
				<Modal titulo="Sair sem salvar?" texto="Há alterações neste cenário que ainda não foram salvas." onFechar={() => blocker.reset()}
					acoes={<>
						<Botao tipo="secundario" onClick={() => blocker.reset()}>Continuar editando</Botao>
						<Botao tipo="perigo" onClick={() => blocker.proceed()}>Descartar</Botao>
						<Botao onClick={async () => { const id = await salvar(publicado ? 'publicado' : 'rascunho'); if (id != null) blocker.proceed(); else blocker.reset(); }} disabled={ocupado}>{publicado ? 'Salvar e sair' : 'Salvar rascunho e sair'}</Botao>
					</>} />
			)}
		</MolduraRP>
	);
}

function Campo({ rotulo, erro, dica, children, inteiro }: { rotulo: string; erro?: string; dica?: ReactNode; children: (id: string, desc: string | undefined) => ReactNode; inteiro?: boolean }) {
	const id = useId();
	const desc = erro || dica ? `${id}-d` : undefined;
	return (
		<div className={`flex min-w-0 flex-col gap-1 ${inteiro ? 'sm:col-span-2' : ''}`}>
			<label htmlFor={id} className="text-[12px] font-medium text-[var(--base-texto-2)]">{rotulo}</label>
			{children(id, desc)}
			{(erro || dica) && <small id={desc} className={`text-[11.5px] ${erro ? 'font-medium text-[var(--estado-erro-texto)]' : 'text-[var(--base-texto-3)]'}`}>{erro || dica}</small>}
		</div>
	);
}

/** Lista de textos curtos (comportamentos, frases): tira com ×, acrescenta pelo campo. */
function ListaTextos({ rotulo, itens, max, erro, onMudar, aspas, exemplo }: { rotulo: string; itens: string[]; max: number; erro?: string; onMudar: (l: string[]) => void; aspas?: boolean; exemplo: string }) {
	const [novo, setNovo] = useState('');
	const id = useId();
	const somar = () => { const t = novo.trim(); if (!t || itens.length >= max) return; onMudar([...itens, t.slice(0, LIMITES_CENARIO.texto)]); setNovo(''); };
	return (
		<div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
			<label htmlFor={id} className="text-[12px] font-medium text-[var(--base-texto-2)]">{rotulo} <span className="font-normal text-[var(--base-texto-3)]">({itens.length} de {max})</span></label>
			{itens.length > 0 && (
				<ul className="flex flex-wrap gap-1.5">
					{itens.map((t, i) => (
						<li key={`${i}-${t}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-[var(--base-fill)] py-0.5 pl-2 pr-1 text-[12.5px]">
							<span className="min-w-0 break-words">{aspas ? `“${t}”` : t}</span>
							<button type="button" className="grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-[var(--base-cartao)]" aria-label={`Tirar “${t}”`} onClick={() => onMudar(itens.filter((_, k) => k !== i))}><X size={13} aria-hidden="true" /></button>
						</li>
					))}
				</ul>
			)}
			<div className="flex min-w-0 flex-wrap gap-2">
				<input id={id} value={novo} maxLength={LIMITES_CENARIO.texto} onChange={e => setNovo(e.target.value)} placeholder={exemplo}
					onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); somar(); } }}
					className={`${campoCls} flex-[1_1_220px]`} style={campoStyle} disabled={itens.length >= max} />
				<Botao tipo="secundario" onClick={somar} disabled={!novo.trim() || itens.length >= max}>Acrescentar</Botao>
			</div>
			{erro && <small className="text-[11.5px] font-medium text-[var(--estado-erro-texto)]">{erro}</small>}
		</div>
	);
}

/** O formulário (sem banco e sem roteador de dados: é o que os testes renderizam). */
export function FormCenarioView({ f, erros, itens, cenario, onMudar }: {
	f: FormCenario; erros: ErrosCenario; itens: Record<string, ItemChecklistRP>; cenario: CenarioRP | null; onMudar: (x: Partial<FormCenario>) => void;
}) {
	const nErros = Object.keys(erros).length;
	const checklist = Object.keys(itens).length ? itens : ITENS_PADRAO;
	const ids = [...new Set([...Object.keys(checklist), ...f.itens_foco])];
	const foco = f.itens_foco.map(i => itemChecklist(i, itens));
	const alcada = textoAlcada({ parcelas: Number(f.parcelas) || undefined, desconto_max: f.desconto_max.trim() ? Number(f.desconto_max) : undefined });
	const objecoesLivres = Object.keys(OBJECOES_TREINO).filter(k => !f.objecoes.some(o => o.codigo === k));
	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
			<form className="min-w-0 space-y-4" noValidate onSubmit={e => e.preventDefault()} aria-label="Cenário">
				{nErros > 0 && <div role="alert"><Aviso tom="erro" titulo={`${nErros === 1 ? 'Um campo precisa' : `${nErros} campos precisam`} de ajuste.`}>Os campos marcados abaixo seguem as mesmas regras do banco: nada de CPF, telefone ou e-mail, e o cliente sempre “(fictícia)” ou “(fictício)”.</Aviso></div>}
				{cenario && <div className="flex flex-wrap items-center gap-2"><PilulasCenario c={cenario} /></div>}

				<Cartao titulo="Cliente simulado" linha="Quem o operador vai atender. Tudo fictício.">
					<div className="grid gap-3 sm:grid-cols-2">
						<Campo rotulo="Nome do cenário" erro={erros.nome}>{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!erros.nome} value={f.nome} maxLength={80} onChange={e => onMudar({ nome: e.target.value })} className={campoCls} style={campoStyle} placeholder="Ex.: Pagou, mas a baixa não caiu" />}</Campo>
						<Campo rotulo="Nome do cliente simulado" erro={erros.persona_nome} dica="Sempre com “(fictícia)” ou “(fictício)”. Nunca o nome de um cliente.">{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!erros.persona_nome} value={f.persona_nome} maxLength={60} onChange={e => onMudar({ persona_nome: e.target.value })} className={campoCls} style={campoStyle} placeholder="Rita (fictícia)" />}</Campo>
						<Campo rotulo="Tipo de cliente" erro={erros.perfil}>{(id, d) => (
							<select id={id} aria-describedby={d} value={f.perfil} onChange={e => onMudar({ perfil: e.target.value })} className={campoCls} style={campoStyle}>
								{Object.entries(TIPOS_CLIENTE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
							</select>
						)}</Campo>
						<Campo rotulo="Resumo (aparece na biblioteca)" erro={erros.descricao}>{(id, d) => <input id={id} aria-describedby={d} value={f.descricao} maxLength={400} onChange={e => onMudar({ descricao: e.target.value })} className={campoCls} style={campoStyle} placeholder="Diz que já pagou e quer que parem de cobrar." />}</Campo>
						<Campo rotulo="Como o cliente age" erro={erros.objetivo} dica="O que a IA segue no papel do cliente: o que ele quer, quando se acalma, o que aceita." inteiro>{(id, d) => <textarea id={id} aria-describedby={d} aria-invalid={!!erros.objetivo} rows={3} value={f.objetivo} maxLength={500} onChange={e => onMudar({ objetivo: e.target.value })} className={textareaCls} style={campoStyle} />}</Campo>
						<ListaTextos rotulo="Comportamentos" itens={f.comportamentos} max={LIMITES_CENARIO.comportamentos} erro={erros.comportamentos} onMudar={l => onMudar({ comportamentos: l })} exemplo="Ex.: insiste que pagou" />
						<ListaTextos rotulo="Frases que o cliente usa" itens={f.frases} max={LIMITES_CENARIO.frases} erro={erros.frases} onMudar={l => onMudar({ frases: l })} aspas exemplo="Ex.: Mas eu já paguei isso!" />
					</div>
				</Cartao>

				<Cartao titulo="Dívida fictícia" linha="O que aparece na ficha durante o treino. O saldo é sorteado dentro da faixa, nunca copiado de um cliente.">
					<div className="grid gap-3 sm:grid-cols-2">
						<Campo rotulo="Produto" erro={erros.produto} dica="Sempre de exemplo (Cartão Exemplo, Conta da loja Exemplo).">{(id, d) => <input id={id} aria-describedby={d} value={f.produto} maxLength={60} onChange={e => onMudar({ produto: e.target.value })} className={campoCls} style={campoStyle} />}</Campo>
						<Campo rotulo="Faixa de saldo" erro={erros.faixa}>{(id, d) => (
							<select id={id} aria-describedby={d} value={f.faixa} onChange={e => onMudar({ faixa: e.target.value })} className={campoCls} style={campoStyle}>
								<option value="">Sem faixa</option>
								{Object.entries(FAIXAS_SALDO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
							</select>
						)}</Campo>
						<Campo rotulo="Dias de atraso" erro={erros.dias_atraso}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={f.dias_atraso} onChange={e => onMudar({ dias_atraso: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={campoCls} style={campoStyle} />}</Campo>
						<div className="grid min-w-0 grid-cols-2 gap-2">
							<Campo rotulo="Alçada: parcelas" erro={erros.parcelas}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={f.parcelas} onChange={e => onMudar({ parcelas: e.target.value.replace(/\D/g, '').slice(0, 3) })} className={campoCls} style={campoStyle} placeholder="até" />}</Campo>
							<Campo rotulo="Desconto máximo (%)" erro={erros.desconto_max}>{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={f.desconto_max} onChange={e => onMudar({ desconto_max: e.target.value.replace(/\D/g, '').slice(0, 3) })} className={campoCls} style={campoStyle} />}</Campo>
						</div>
					</div>
				</Cartao>

				<Cartao titulo="Objeções e dificuldade" linha="Na ordem em que o cliente levanta. A dificuldade muda a insistência e o tom.">
					{f.objecoes.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma objeção ainda.</p> : (
						<ol className="space-y-2.5">
							{f.objecoes.map((o, i) => (
								<li key={i} className="grid min-w-0 gap-2 rounded-xl bg-[var(--base-fill)] p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center">
									<span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--base-cartao)] text-[12px] font-bold">{i + 1}</span>
									<select aria-label={`Objeção ${i + 1}`} value={o.codigo} onChange={e => onMudar({ objecoes: f.objecoes.map((x, k) => (k === i ? { ...x, codigo: e.target.value } : x)) })} className={campoCls} style={campoStyle}>
										{[o.codigo, ...objecoesLivres].filter((v, k, a) => a.indexOf(v) === k).map(k => <option key={k} value={k}>{rotuloObjecao(k)}</option>)}
									</select>
									<input aria-label={`Quando o cliente levanta a objeção ${i + 1}`} value={o.quando} maxLength={LIMITES_CENARIO.quando} placeholder="Quando (ex.: logo depois de ouvir o valor)"
										onChange={e => onMudar({ objecoes: f.objecoes.map((x, k) => (k === i ? { ...x, quando: e.target.value } : x)) })} className={campoCls} style={campoStyle} />
									<span className="flex gap-1">
										<button type="button" disabled={i === 0} aria-label={`Subir a objeção ${i + 1}`} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--base-cartao)] disabled:opacity-40"
											onClick={() => { const l = [...f.objecoes]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; onMudar({ objecoes: l }); }}><ArrowUp size={14} aria-hidden="true" /></button>
										<button type="button" aria-label={`Tirar a objeção ${i + 1}`} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--base-cartao)]" onClick={() => onMudar({ objecoes: f.objecoes.filter((_, k) => k !== i) })}><X size={14} aria-hidden="true" /></button>
									</span>
								</li>
							))}
						</ol>
					)}
					{erros.objecoes && <p className="mt-2 text-[11.5px] font-medium text-[var(--estado-erro-texto)]">{erros.objecoes}</p>}
					<div className="mt-2.5"><Botao tipo="secundario" pequeno disabled={f.objecoes.length >= LIMITES_CENARIO.objecoes || !objecoesLivres.length}
						onClick={() => onMudar({ objecoes: [...f.objecoes, { codigo: objecoesLivres[0], quando: '' }] })}>+ Objeção</Botao></div>
					<fieldset className="mt-4 min-w-0">
						<legend className="text-[12px] font-medium text-[var(--base-texto-2)]">Dificuldade</legend>
						<div className="mt-1.5 grid grid-cols-5 gap-1.5">
							{[1, 2, 3, 4, 5].map(k => (
								<label key={k} className={`flex cursor-pointer flex-col items-center rounded-lg border px-1 py-1.5 text-[13px] font-semibold ${f.dificuldade === k ? 'border-[var(--destaque)] bg-[var(--destaque-suave)]' : ''}`} style={f.dificuldade === k ? undefined : { borderColor: 'var(--base-borda)' }}>
									<input type="radio" name="dificuldade" value={k} checked={f.dificuldade === k} onChange={() => onMudar({ dificuldade: k })} className="sr-only" />
									{k}<small className="hidden text-center text-[10.5px] font-normal text-[var(--base-texto-3)] sm:block">{DIFICULDADE[k]}</small>
								</label>
							))}
						</div>
					</fieldset>
				</Cartao>

				<Cartao titulo="Critérios de nota" linha="O mesmo checklist de qualidade que dá nota às ligações. Todos os itens contam; os marcados ficam em foco no briefing e no feedback.">
					<ul className="space-y-1.5">
						{ids.map(id => {
							const i = itemChecklist(id, checklist);
							const marcado = f.itens_foco.includes(id);
							return (
								<li key={id}>
									<label className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
										<input type="checkbox" className="mt-1" checked={marcado} disabled={!marcado && f.itens_foco.length >= LIMITES_CENARIO.itens_foco}
											onChange={e => onMudar({ itens_foco: e.target.checked ? [...f.itens_foco, id] : f.itens_foco.filter(x => x !== id) })} />
										<span className="min-w-0">{i.texto}<small className="block text-[12px] text-[var(--base-texto-3)]">{GRAVIDADE_RP[i.gravidade] ?? 'Importante'}{i.gravidade === 'bloqueante' ? ' (reprova a sessão)' : ''}</small></span>
									</label>
								</li>
							);
						})}
					</ul>
					{erros.itens_foco && <p className="mt-2 text-[11.5px] font-medium text-[var(--estado-erro-texto)]">{erros.itens_foco}</p>}
					<div className="mt-3 grid gap-3">
						<Campo rotulo="Objetivo do cenário (vira feedback; não muda a nota)" erro={erros.objetivo_cenario}>{(id, d) => <input id={id} aria-describedby={d} value={f.objetivo_cenario} maxLength={200} onChange={e => onMudar({ objetivo_cenario: e.target.value })} className={campoCls} style={campoStyle} placeholder="Ex.: Pedir data e canal do pagamento" />}</Campo>
					</div>
					<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">O checklist muda em Speech › Qualidade. O cenário só escolhe o foco.</p>
				</Cartao>
			</form>

			<aside className="min-w-0 space-y-4">
				<Cartao titulo="Sessão">
					<fieldset className="min-w-0">
						<legend className="text-[12px] font-medium text-[var(--base-texto-2)]">Modo</legend>
						<div className="mt-1 flex flex-wrap gap-3 text-[13px]">
							{([['voz', 'Voz'], ['texto', 'Texto']] as const).map(([m, n]) => (
								<label key={m} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={f.modos.includes(m)} onChange={e => onMudar({ modos: e.target.checked ? [...f.modos, m] : f.modos.filter(x => x !== m) })} />{n}</label>
							))}
						</div>
						{erros.modos && <small className="text-[11.5px] font-medium text-[var(--estado-erro-texto)]">{erros.modos}</small>}
					</fieldset>
					<div className="mt-3"><Campo rotulo="Duração máxima (minutos)" erro={erros.duracao_min} dica="De 1 a 15. A sessão encerra sozinha no limite.">{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={f.duracao_min} onChange={e => onMudar({ duracao_min: e.target.value.replace(/\D/g, '').slice(0, 2) })} className={campoCls} style={campoStyle} />}</Campo></div>
				</Cartao>
				<Cartao titulo="Prévia do briefing" linha="O que o operador lê antes de começar.">
					<p className="text-[13px] leading-relaxed text-[var(--base-texto-2)]">
						“Você vai ligar para <b className="text-[var(--base-texto)]">{f.persona_nome.trim() || 'o cliente simulado'}</b>{f.produto.trim() ? `, cliente do ${f.produto.trim()}` : ''}{f.dias_atraso ? `, ${f.dias_atraso} dias de atraso` : ''}{f.faixa ? `, saldo ${FAIXAS_SALDO[f.faixa]?.toLowerCase() ?? ''}` : ''}. Alçada: {alcada.toLowerCase()}.{foco.length ? ` Em foco: ${foco.map(i => i.texto.toLowerCase()).join('; ')}.` : ''}”
					</p>
				</Cartao>
				{cenario?.situacao === 'publicado' && (
					<Cartao titulo="Usar este cenário">
						<LinkRP to={rotaAtribuir({ cen: cenario.id })} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Atribuir treino com este cenário</LinkRP>
					</Cartao>
				)}
				<Aviso tom="neutro">Frases com CPF, telefone ou e-mail são bloqueadas automaticamente, no cenário e na fala do cliente simulado.</Aviso>
			</aside>
		</div>
	);
}
