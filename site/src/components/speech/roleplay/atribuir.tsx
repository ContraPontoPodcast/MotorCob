// Roleplay › Atribuir treino (/speech-analytics/roleplay/atribuir?cen=&ops=&sug=). Cenário publicado, quem treina
// (pessoas ou a equipe inteira), prazo, meta, tentativas e modo. Pré-marca só quem originou: as pessoas do ?ops= (vindo
// da pessoa ou do treino) ou da sugestão (?sug=, que também traz o cenário sugerido). Grava por atribuir_treino (SQL 90).
// Ao enviar, o formulário dá lugar ao treino recém-criado (replace): o ⟵ do navegador não volta ao formulário já enviado.
// O operador não tem login: recebe o link pessoal de treino (gerado em Treinos atribuídos) ou treina lado a lado.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { origemDoEstado } from '@/components/comuns/voltar';
import { Aviso, Botao, Cartao, Estado, campoCls, campoStyle } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { diaSP, nf } from '@/lib/speech';
import {
	MODOS_ATRIBUIR, OPCOES_TENTATIVAS, REGRA_SUGESTAO, ROTA_RP_ATRIBUICOES, ROTA_RP_CADASTRO, ehPadraoMotorCX, idsDaQuery, noCadastro, prazoPadrao,
	rotaAtribuicaoRP, textoDuracao, validarAtribuicao,
	type CenarioRP, type EquipeRP, type FormAtribuir, type OperadorRP,
} from '@/lib/roleplay';
import { LinkRP, MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { atribuirTreino, lerParaAtribuir, type DadosAtribuir } from './dados';
import type { PodeRP } from './index';

export function AtribuirTreino({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const [q] = useSearchParams();
	const loc = useLocation();
	const navegar = useNavigate();
	const sug = /^\d{1,18}$/.test(q.get('sug') ?? '') ? Number(q.get('sug')) : null;
	const [d, setD] = useState<DadosAtribuir | null>(null);
	const [erro, setErro] = useState('');
	useEffect(() => {
		if (!supabase || !pode.treinar) return;
		let ativo = true;
		lerParaAtribuir(supabase, empresa, sug).then(x => { if (ativo) setD(x); }).catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, sug, pode.treinar]);

	const origem = origemDoEstado(loc.state);
	const cancelar = () => (origem ? navegar(-1) : navegar(ROTA_RP_ATRIBUICOES, { replace: true }));

	async function enviar(f: FormAtribuir) {
		if (!supabase) return;
		const id = await atribuirTreino(supabase, empresa, {
			cenario: f.cenario!, operadores: f.operadores, prazo: f.prazo, nota_minima: Number(f.meta),
			tentativas: f.tentativas ? Number(f.tentativas) : null, modos: f.modos, sugestao: d?.sugestao?.id ?? null,
		});
		toast.success(`Treino atribuído a ${f.operadores.length} ${f.operadores.length === 1 ? 'pessoa' : 'pessoas'}.`);
		navegar(`${rotaAtribuicaoRP(id)}?criada=1`, { replace: true });
	}

	return (
		<MolduraRP titulo="Atribuir treino" descricao={d?.sugestao ? `A partir da sugestão: ${REGRA_SUGESTAO[d.sugestao.regra] ?? 'sugestão de treino'}.` : 'Escolha o cenário, quem treina e as regras.'} acoes={<SeloLgpdTreino />}>
			{!pode.treinar
				? <Estado tipo="semPermissao" titulo="Seu perfil não atribui treinos.">Quem tem a permissão de treinar operadores atribui os treinos. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado>
				: erro ? <Estado tipo="erro" titulo="Não deu para carregar agora.">{erro}</Estado>
				: !d ? <Estado tipo="carregando" />
				: <FormAtribuirView d={d} hoje={diaSP(0)} cenInicial={idsDaQuery(q.get('cen'))[0] ?? d.sugestao?.cenario_id ?? null}
					opsIniciais={q.get('ops') ? idsDaQuery(q.get('ops')) : d.sugestao?.operadores ?? []} onEnviar={enviar} onCancelar={cancelar} rotuloCancelar={origem ? `Cancelar e voltar para ${origem.deRotulo}` : 'Cancelar'} />}
		</MolduraRP>
	);
}

/** O formulário com os dados já lidos (sem banco: é o que os testes renderizam). */
export function FormAtribuirView({ d, hoje, cenInicial, opsIniciais, onEnviar, onCancelar, rotuloCancelar = 'Cancelar' }: {
	d: Pick<DadosAtribuir, 'cenarios' | 'operadores' | 'equipes' | 'uso'>; hoje: string; cenInicial: number | null; opsIniciais: number[];
	onEnviar: (f: FormAtribuir) => Promise<void>; onCancelar: () => void; rotuloCancelar?: string;
}) {
	const publicados = useMemo(() => d.cenarios.filter(c => c.situacao === 'publicado')
		.sort((a, b) => Number(a.empresa_id == null) - Number(b.empresa_id == null) || a.nome.localeCompare(b.nome, 'pt-BR')), [d.cenarios]);
	const cen0 = publicados.find(c => c.id === cenInicial) ?? null;
	const [f, setF] = useState<FormAtribuir>(() => ({
		cenario: cen0?.id ?? null,
		// só quem originou e está ativo; quem não existe na empresa some da pré-seleção
		operadores: opsIniciais.filter(id => d.operadores.some(o => o.id === id && o.ativo)),
		prazo: prazoPadrao(hoje), meta: '75', tentativas: '2', modos: cen0 ? [...cen0.modos] : ['voz', 'texto'],
	}));
	const [erros, setErros] = useState<Partial<Record<keyof FormAtribuir, string>>>({});
	const [ocupado, setOcupado] = useState(false);
	const [falha, setFalha] = useState('');
	const cen: CenarioRP | null = publicados.find(c => c.id === f.cenario) ?? null;
	// Pessoas: o Cadastro para treino ativo, mais quem veio pré-marcado (mesmo sem equipe).
	const pessoas = d.operadores.filter(o => o.ativo && (noCadastro(o) || f.operadores.includes(o.id)));
	const grupos = gruposPorEquipe(pessoas, d.equipes);
	const set = (x: Partial<FormAtribuir>) => setF(v => ({ ...v, ...x }));
	const marcar = (ids: number[], on: boolean) => set({ operadores: on ? [...new Set([...f.operadores, ...ids])] : f.operadores.filter(x => !ids.includes(x)) });
	const nTent = f.tentativas ? Number(f.tentativas) : null;
	const minutos = cen && f.modos.includes('voz') ? f.operadores.length * (nTent ?? 3) * Math.round(cen.duracao_max_s / 60) : 0;
	const modoAtual = f.modos.join(',');
	const opcoesModo = MODOS_ATRIBUIR.filter(m => !cen || m.v.split(',').every(x => cen.modos.includes(x)));

	async function enviar() {
		const e = validarAtribuicao(f, hoje, cen?.modos ?? null);
		setErros(e); setFalha('');
		if (Object.keys(e).length) return;
		setOcupado(true);
		try { await onEnviar(f); } catch (err) { setFalha(err instanceof Error ? err.message : 'Não deu para atribuir agora.'); } finally { setOcupado(false); }
	}

	if (!publicados.length) return <Estado tipo="vazio" titulo="Nenhum cenário publicado para atribuir.">Publique um cenário da empresa ou use um do Padrão MotorCX em Cenários.</Estado>;
	return (
		<div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
			<form className="min-w-0 space-y-4" noValidate aria-label="Atribuir treino" onSubmit={e => { e.preventDefault(); void enviar(); }}>
				{(falha || Object.keys(erros).length > 0) && <div role="alert"><Aviso tom="erro" titulo="Não deu para atribuir ainda.">{falha || Object.values(erros).join(' ')}</Aviso></div>}
				<Cartao titulo="1. Cenário">
					<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Cenário
						<select value={f.cenario ?? ''} aria-invalid={!!erros.cenario} onChange={e => { const c = publicados.find(x => x.id === Number(e.target.value)) ?? null; set({ cenario: c?.id ?? null, modos: c ? [...c.modos] : f.modos }); }} className={campoCls} style={campoStyle}>
							<option value="">Escolha um cenário</option>
							{publicados.map(c => <option key={c.id} value={c.id}>{c.nome} · {ehPadraoMotorCX(c) ? 'Padrão MotorCX' : 'da empresa'} · dificuldade {c.dificuldade}</option>)}
						</select>
					</label>
					{cen && <p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">{cen.persona_nome} · até {textoDuracao(cen.duracao_max_s)} por sessão.</p>}
				</Cartao>

				<Cartao titulo="2. Quem treina" linha="Marque uma equipe inteira ou escolha pessoas.">
					{pessoas.length === 0 ? (
						<Estado tipo="vazio" titulo="Ninguém no Cadastro para treino." acoes={<LinkRP to={ROTA_RP_CADASTRO} className="text-[13px] font-semibold text-[var(--destaque)] hover:underline">Abrir o cadastro</LinkRP>} compacto>Cadastre as pessoas (apelido e equipe) para atribuir treinos.</Estado>
					) : (
						<fieldset className="min-w-0 space-y-3">
							<legend className="sr-only">Pessoas</legend>
							{grupos.map(g => {
								const ids = g.pessoas.map(o => o.id);
								const todos = ids.every(id => f.operadores.includes(id));
								return (
									<div key={g.chave} className="min-w-0">
										<div className="mb-1 flex flex-wrap items-center gap-2">
											<span className="text-[12.5px] font-semibold text-[var(--base-texto)]">{g.nome}</span>
											<button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)] hover:underline" onClick={() => marcar(ids, !todos)}>{todos ? 'Desmarcar a equipe' : 'Marcar a equipe'}</button>
										</div>
										<div className="flex flex-wrap gap-1.5">
											{g.pessoas.map(o => (
												<label key={o.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] ${f.operadores.includes(o.id) ? 'border-[var(--destaque)] bg-[var(--destaque-suave)]' : ''}`} style={f.operadores.includes(o.id) ? undefined : { borderColor: 'var(--base-borda)' }}>
													<input type="checkbox" checked={f.operadores.includes(o.id)} onChange={e => marcar([o.id], e.target.checked)} />{o.apelido}
												</label>
											))}
										</div>
									</div>
								);
							})}
						</fieldset>
					)}
				</Cartao>

				<Cartao titulo="3. Regras">
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Prazo
							<input type="date" value={f.prazo} min={hoje} aria-invalid={!!erros.prazo} onChange={e => set({ prazo: e.target.value })} className={campoCls} style={campoStyle} />
							<small className="text-[11.5px] font-normal text-[var(--base-texto-3)]">O link de treino vale até o prazo + 1 dia.</small>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Meta (nota para concluir)
							<input inputMode="numeric" value={f.meta} aria-invalid={!!erros.meta} onChange={e => set({ meta: e.target.value.replace(/\D/g, '').slice(0, 3) })} className={campoCls} style={campoStyle} />
							<small className="text-[11.5px] font-normal text-[var(--base-texto-3)]">Item crítico com “não” reprova a sessão, como nas ligações.</small>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Tentativas
							<select value={f.tentativas} onChange={e => set({ tentativas: e.target.value })} className={campoCls} style={campoStyle}>
								{OPCOES_TENTATIVAS.map(o => <option key={o.v} value={o.v}>{o.n}</option>)}
							</select>
							<small className="text-[11.5px] font-normal text-[var(--base-texto-3)]">Vale a melhor nota. Tentativa abandonada não conta.</small>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-[var(--base-texto-2)]">Modo
							<select value={modoAtual} aria-invalid={!!erros.modos} onChange={e => set({ modos: e.target.value.split(',') })} className={campoCls} style={campoStyle}>
								{opcoesModo.map(m => <option key={m.v} value={m.v}>{m.n}</option>)}
								{!opcoesModo.some(m => m.v === modoAtual) && <option value={modoAtual}>{modoAtual}</option>}
							</select>
							<small className="text-[11.5px] font-normal text-[var(--base-texto-3)]">O treino por voz no navegador chega numa próxima versão; até lá, a sessão roda por texto.</small>
						</label>
					</div>
				</Cartao>

				<Cartao titulo="4. Como o operador recebe" linha="O operador não tem login no MotorCX.">
					<ul className="space-y-2 text-[13px] text-[var(--base-texto-2)]">
						<li><b className="text-[var(--base-texto)]">Link pessoal de treino.</b> Um link por pessoa, válido até o prazo + 1 dia. Abre “Meus treinamentos”, só com os treinos dela, sem o menu do MotorCX. Quem já tem link ativo vê o treino novo no mesmo link.</li>
						<li><b className="text-[var(--base-texto)]">Treino lado a lado.</b> Você abre a sessão nesta máquina e a pessoa treina ao seu lado, sem link (em cada linha do treino atribuído).</li>
					</ul>
				</Cartao>
			</form>

			<aside className="min-w-0 space-y-4">
				<Cartao titulo="Resumo">
					<p className="text-[13.5px] text-[var(--base-texto-2)]" aria-live="polite">
						{cen ? <b className="text-[var(--base-texto)]">{cen.nome}</b> : <i>Sem cenário</i>} para {f.operadores.length ? `${f.operadores.length} ${f.operadores.length === 1 ? 'pessoa' : 'pessoas'}` : 'ninguém ainda'}.
						{' '}Prazo {f.prazo ? f.prazo.split('-').reverse().slice(0, 2).join('/') : '—'} · meta {f.meta || '—'} · {nTent ? `${nTent} ${nTent === 1 ? 'tentativa' : 'tentativas'}` : 'sem limite de tentativas'}.
					</p>
					{f.modos.includes('voz') && cen && (
						<p className="mt-2 text-[12.5px] text-[var(--base-texto-3)]">Até {nf(minutos)} min de voz se todos usarem {nTent ? 'todas as tentativas' : '3 tentativas'}.{d.uso ? ` Saldo do mês: ${d.uso.voz_bloqueada ? '0 min (só texto)' : `${nf(Math.max(0, d.uso.franquia_voz - d.uso.minutos_voz))} min`}.` : ''}</p>
					)}
					<div className="mt-3 flex flex-col gap-2">
						<Botao onClick={() => void enviar()} disabled={ocupado}>{ocupado ? 'Atribuindo…' : 'Atribuir treino'}</Botao>
						<Botao tipo="secundario" onClick={onCancelar}>{rotuloCancelar}</Botao>
					</div>
				</Cartao>
			</aside>
		</div>
	);
}

export function gruposPorEquipe(pessoas: OperadorRP[], equipes: EquipeRP[]) {
	const out: { chave: string; nome: string; pessoas: OperadorRP[] }[] = [];
	for (const e of [...equipes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
		const ps = pessoas.filter(o => o.equipe_id === e.id);
		if (ps.length) out.push({ chave: `e${e.id}`, nome: e.nome, pessoas: ps.sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR')) });
	}
	const sem = pessoas.filter(o => !equipes.some(e => e.id === o.equipe_id));
	if (sem.length) out.push({ chave: 'sem', nome: 'Sem equipe', pessoas: sem.sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR')) });
	return out;
}
