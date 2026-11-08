// Agente de voz › Confirmar identidade (SQL 88; protótipo aprovado, tela 02). Por carteira: quem confere (CRM, arquivo
// ou os dois em ordem), quantas perguntas, quais e em que ordem, se faltar dado no arquivo e os erros no dia por
// cliente. Só quem aprova o roteiro de voz salva (aprovar_roteiro_voz; o banco confere em salvar_config_mailing_voz);
// os outros só veem. Sem configuração salva o agente faz o de hoje: a tela mostra isso e vem preenchida com a
// recomendação (com CRM, "CRM; se falhar, o arquivo"; sem CRM, "Só o arquivo"; carteira no ar, como hoje).
// Nenhum dado de cliente aparece aqui: só a configuração e o histórico em palavras.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Info, Lock } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { Aviso, Botao, Pilula, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import {
	ERROS_DIA, FONTES, PERGUNTAS, RECUSADAS, SE_FALTAR, alternar, comQuantas, iguais, inicial, mover, paraSalvarIdentidade, recomendada,
	textoFonte, textoPerguntas, usaArquivo, usaCrm, validarIdentidade, type ConfigIdentidade,
} from '@/lib/identidade-mailing';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { dataCurta } from '@/lib/fluxo';
import { executar, useCarregar, useNomeCarteira } from './comum';

const card = 'rounded-2xl bg-[var(--base-cartao)] px-4 py-3.5';
const sombra = { boxShadow: '0 0 0 1px var(--base-borda)' };
const Recomendado = () => <span className="ml-1.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-[var(--estado-ok-texto,var(--estado-ok))]">recomendado</span>;

function Opcao({ nome, desc, marcado, onEscolher, recomendado, desabilitado, grupo }: {
	nome: string; desc: ReactNode; marcado: boolean; onEscolher: () => void; recomendado?: boolean; desabilitado?: boolean; grupo: string;
}) {
	return (
		<label className={`flex min-w-0 cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 ${desabilitado ? 'cursor-default opacity-80' : ''}`}
			style={{ boxShadow: `0 0 0 ${marcado ? 2 : 1}px ${marcado ? 'var(--destaque)' : 'var(--base-borda)'}`, backgroundColor: marcado ? 'color-mix(in srgb, var(--destaque) 7%, var(--base-cartao))' : 'var(--base-cartao)' }}>
			<input type="radio" name={grupo} className="mt-1 shrink-0" checked={marcado} disabled={desabilitado} onChange={onEscolher} />
			<span className="min-w-0">
				<b className="text-[13.5px] font-semibold text-[var(--base-texto)]">{nome}</b>{recomendado && <Recomendado />}
				<small className="mt-0.5 block text-[12.5px] text-[var(--base-texto-2)]">{desc}</small>
			</span>
		</label>
	);
}

/** O formulário (só apresentação; testado em componentes.test.tsx). */
export function FormIdentidade({ valor, onTrocar, temCrm, somenteLeitura }: {
	valor: ConfigIdentidade; onTrocar: (c: ConfigIdentidade) => void; temCrm: boolean; somenteLeitura?: boolean;
}) {
	const rec = recomendada(temCrm);
	const t = (c: ConfigIdentidade) => { if (!somenteLeitura) onTrocar(c); };
	const ordem = [...valor.perguntas, ...PERGUNTAS.map(p => p.id).filter(p => !valor.perguntas.includes(p))];
	return (
		<div className="space-y-4">
			<div className="grid items-start gap-4 lg:grid-cols-2">
				<section className={card} style={sombra} aria-labelledby="t-quem">
					<h2 id="t-quem" className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Quem confere</h2>
					<div className="space-y-2" role="radiogroup" aria-labelledby="t-quem">
						{FONTES.map(f => <Opcao key={f.id} grupo="fonte" nome={f.nome} desc={f.desc} marcado={valor.fonte === f.id} recomendado={rec.fonte === f.id} desabilitado={somenteLeitura} onEscolher={() => t({ ...valor, fonte: f.id })} />)}
					</div>
					<p className="mt-2.5 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[12.5px] text-[var(--base-texto-2)]" style={{ backgroundColor: 'var(--base-fill)' }}>
						<Info size={14} className="mt-[2px] shrink-0" aria-hidden />
						<span>"Falhar" é não responder (tempo, erro, credencial) ou não ter o dado. Se uma fonte diz <b className="font-semibold text-[var(--base-texto)]">não confere</b>, isso é resposta: o agente não tenta na outra.</span>
					</p>
					{!temCrm && usaCrm(valor) && <div className="mt-2.5"><Aviso tom="atencao" titulo="Esta empresa não tem o conector Validar cadastro ativo.">Com o CRM na lista, ele é pulado até a equipe MotorCX cadastrar o conector.</Aviso></div>}
				</section>
				<section className={card} style={sombra} aria-labelledby="t-quantas">
					<h2 id="t-quantas" className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Quantas perguntas</h2>
					<div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="t-quantas">
						<Opcao grupo="quantas" nome="1 pergunta" desc="como hoje" marcado={valor.quantas === 1} desabilitado={somenteLeitura} onEscolher={() => t(comQuantas(valor, 1))} />
						<Opcao grupo="quantas" nome="2 perguntas" desc="quem atende por engano raramente sabe as duas" recomendado marcado={valor.quantas === 2} desabilitado={somenteLeitura} onEscolher={() => t(comQuantas(valor, 2))} />
					</div>
					<h3 id="t-falta" className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--base-texto-3)]">Se faltar dado no arquivo para um cliente</h3>
					<div className="space-y-2" role="radiogroup" aria-labelledby="t-falta">
						{SE_FALTAR.map(s => <Opcao key={s.id} grupo="se_faltar" nome={s.nome} desc={s.desc} recomendado={s.id === 'proxima'} marcado={valor.se_faltar === s.id} desabilitado={somenteLeitura} onEscolher={() => t({ ...valor, se_faltar: s.id })} />)}
					</div>
				</section>
			</div>

			<section className={card} style={sombra} aria-labelledby="t-quais">
				<div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
					<h2 id="t-quais" className="text-[15px] font-semibold text-[var(--base-texto)]">Quais perguntas, nesta ordem</h2>
					<span className="text-[12.5px] text-[var(--base-texto-3)]">o agente pergunta {valor.quantas === 1 ? 'a 1ª ligada' : 'as 2 primeiras ligadas'}; a de baixo é a reserva</span>
				</div>
				<ol className="space-y-2">
					{ordem.map(id => {
						const p = PERGUNTAS.find(x => x.id === id)!;
						const i = valor.perguntas.indexOf(id);
						const ligada = i >= 0;
						const pergunta = ligada && i < valor.quantas;
						return (
							<li key={id} data-pergunta={id} className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ boxShadow: '0 0 0 1px var(--base-borda)', opacity: ligada ? 1 : 0.65 }}>
								<span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ backgroundColor: ligada ? 'var(--destaque)' : 'var(--base-fill)', color: ligada ? 'var(--destaque-texto)' : 'var(--base-texto-3)' }}>{ligada ? i + 1 : '–'}</span>
								<span className="min-w-0 flex-1">
									<b className="block text-[13.5px] font-semibold text-[var(--base-texto)]">{p.nome}</b>
									<small className="block text-[12px] text-[var(--base-texto-2)]">{p.fala} · {p.respostas}</small>
								</span>
								{pergunta ? <Pilula tom="ok">pergunta</Pilula> : ligada ? <Pilula tom="neutro">reserva</Pilula> : null}
								{!somenteLeitura && (
									<span className="flex shrink-0 items-center gap-1">
										<button type="button" aria-label={`Subir ${p.nome}`} disabled={!ligada || i === 0} onClick={() => t(mover(valor, id, -1))} className="grid h-7 w-7 place-items-center rounded-lg disabled:opacity-30" style={{ border: '1px solid var(--base-borda)' }}><ArrowUp size={14} aria-hidden /></button>
										<button type="button" aria-label={`Descer ${p.nome}`} disabled={!ligada || i === valor.perguntas.length - 1} onClick={() => t(mover(valor, id, 1))} className="grid h-7 w-7 place-items-center rounded-lg disabled:opacity-30" style={{ border: '1px solid var(--base-borda)' }}><ArrowDown size={14} aria-hidden /></button>
										<input type="checkbox" aria-label={`Ligar ${p.nome}`} className="ml-1 h-4 w-4" checked={ligada} disabled={ligada && valor.perguntas.length <= valor.quantas} onChange={() => t(alternar(valor, id))} />
									</span>
								)}
							</li>
						);
					})}
				</ol>
				<p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">Recomendado: dia e mês, depois os 3 últimos dígitos do documento. Dia, mês e ano juntos formam a data inteira, que a família costuma saber.</p>
			</section>

			<section className={card} style={sombra} aria-labelledby="t-recusadas">
				<div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
					<h2 id="t-recusadas" className="text-[15px] font-semibold text-[var(--base-texto)]">Perguntas que o MotorCX não oferece</h2>
					<span className="text-[12.5px] text-[var(--base-texto-3)]">e por quê</span>
				</div>
				<dl className="divide-y" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
					{RECUSADAS.map(([q, por]) => (
						<div key={q} className="grid gap-x-4 gap-y-0.5 py-2 text-[13px] sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
							<dt className="font-semibold text-[var(--base-texto)]">{q}</dt>
							<dd className="text-[var(--base-texto-2)]">{por}</dd>
						</div>
					))}
				</dl>
			</section>

			<section className={card} style={sombra} aria-labelledby="t-protecao">
				<h2 id="t-protecao" className="mb-2.5 text-[15px] font-semibold text-[var(--base-texto)]">Proteção contra tentativa e erro</h2>
				<div className="grid gap-3 md:grid-cols-3">
					<div className="min-w-0">
						<span className="block text-[12.5px] font-semibold text-[var(--base-texto)]">Tentativas por pergunta</span>
						<span className={`${campoCls} mt-1 flex h-9 items-center`} style={campoStyle}>2 (fixo)</span>
						<small className="mt-1 block text-[12px] text-[var(--base-texto-2)]">Como hoje. Depois: "não confirmou" e recado neutro.</small>
					</div>
					<label className="min-w-0">
						<span className="block text-[12.5px] font-semibold text-[var(--base-texto)]">Erros no dia, por cliente, somando ligações</span>
						<select className={`${campoCls} mt-1 h-9 w-full`} style={campoStyle} value={valor.erros_dia} disabled={somenteLeitura}
							onChange={e => t({ ...valor, erros_dia: Number(e.target.value) as ConfigIdentidade['erros_dia'] })}>
							{ERROS_DIA.map(n => <option key={n} value={n}>{n}{n === 4 ? ' (recomendado)' : ''}</option>)}
						</select>
						<small className="mt-1 block text-[12px] text-[var(--base-texto-2)]">Atingiu: o arquivo não confere mais hoje para esse cliente (só atendente).</small>
					</label>
					<div className="min-w-0">
						<span className="block text-[12.5px] font-semibold text-[var(--base-texto)]">Contagem feita em</span>
						<span className={`${campoCls} mt-1 flex h-9 items-center`} style={campoStyle}>Banco do MotorCX (servidor)</span>
						<small className="mt-1 block text-[12px] text-[var(--base-texto-2)]">O agente não guarda os códigos: ele pergunta "confere?" e o banco conta.</small>
					</div>
				</div>
			</section>
		</div>
	);
}

/** A tela inteira (dados + permissão + salvar). */
export function IdentidadeAgente() {
	const { api, empresa, credor } = useFluxo();
	const perm = usePermissoesFluxo();
	const nomeCarteira = useNomeCarteira();
	const credorId = credor?.id ?? null;
	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api || !empresa) return null;
		const [vigente, historico, conectores, fluxos] = await Promise.all([
			api.identidade(empresa.id, credorId), api.historicoIdentidade(empresa.id, credorId).catch(() => []),
			api.conectores(empresa.id).catch(() => []), api.fluxos(empresa.id).catch(() => ({ fluxos: [], versoes: [] })),
		]);
		const temCrm = conectores.some(c => c.finalidade === 'validar_cadastro' && c.situacao === 'ativo');
		const noAr = fluxos.versoes.some(v => v.situacao === 'em_uso' && (v.credor_id ?? null) === credorId);
		return { vigente, historico, temCrm, noAr };
	}, [api, empresa?.id, credorId]);
	const base = useMemo(() => (dados ? dados.vigente?.identidade ?? inicial(dados.temCrm, dados.noAr) : null), [dados]);
	const [valor, setValor] = useState<ConfigIdentidade | null>(null);
	const [salvando, setSalvando] = useState(false);
	useEffect(() => { setValor(base); }, [base]);

	const heading = <CabecalhoAgente titulo="Confirmar identidade" desc={`Carteira ${nomeCarteira(credorId)}: quem confere a identidade antes de o agente falar da dívida.`} atual="identidade" />;
	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!perm.ver) return <>{heading}<Vazio titulo="Seu perfil não vê o agente de voz.">Precisa da permissão Editar canais ou Aprovar roteiro de voz.</Vazio></>;
	if (carregando && !dados) return <>{heading}<Loading /></>;
	if (erro && !dados) return <>{heading}<Notice>{/identidade_voz_vigente|does not exist/.test(erro) ? 'O banco ainda não tem esta configuração (SQL 88). O agente segue conferindo pelo CRM, como hoje.' : erro}</Notice></>;
	if (!dados || !valor) return heading;

	const podeSalvar = perm.aprovar;
	const mudou = !iguais(valor, dados.vigente?.identidade ?? null) || !dados.vigente;
	const motivo = validarIdentidade(valor);
	async function salvar(cfg: ConfigIdentidade | null) {
		if (!api || !empresa) return;
		setSalvando(true);
		const ok = await executar(() => api.salvarIdentidade(empresa.id, credorId, cfg ? paraSalvarIdentidade(cfg) : null),
			cfg ? 'Salvo. Vale a partir da próxima rotina do motor (ou agora com "Reenquadrar agora").' : 'Voltou ao de hoje: só o CRM confere.');
		setSalvando(false);
		if (ok) await recarregar();
	}

	return (
		<>
			{heading}
			<div className="space-y-4">
				<p className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: 'color-mix(in srgb, var(--area-voz) 10%, var(--base-cartao))', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--area-voz) 22%, transparent)' }}>
					<Lock size={15} className="mt-[2px] shrink-0 text-[var(--area-voz)]" aria-hidden />
					<span><b className="font-semibold">Fixo, não é opção:</b> valor, credor e oferta só depois de confirmar a identidade · 2 tentativas por pergunta e depois "não confirmou" · resposta errada nunca passa para outra fonte · nem a IA nem nenhuma tela veem a data ou o documento.</span>
				</p>
				{dados.vigente
					? <Aviso tom="ok" titulo={`Em vigor desde ${dataCurta(dados.vigente.vigente_desde)}${dados.vigente.credor_id == null && credorId != null ? ' (da empresa toda)' : ''}: ${textoFonte(dados.vigente.identidade)}.`}>Perguntas: {textoPerguntas(dados.vigente.identidade)}.</Aviso>
					: <Aviso tom="neutro" titulo="Ainda sem configuração: o agente faz como hoje (só o CRM confere, uma pergunta por etapa).">{dados.noAr && dados.temCrm ? 'Abaixo, o de hoje. Recomendado para carteira nova: CRM; se falhar, o arquivo, com 2 perguntas.' : 'Abaixo, a recomendação. Nada muda até alguém salvar.'}</Aviso>}
				{!podeSalvar && <Aviso tom="neutro" titulo="Só quem aprova o roteiro de voz da empresa muda quem confere.">Isso decide quem ouve a dívida. Você vê a configuração; para mudar, peça a quem tem "Aprovar roteiro de voz".</Aviso>}
				{usaArquivo(valor) && <Aviso tom="neutro" titulo="Para conferir pelo arquivo:">aponte a data de nascimento e/ou o documento em Colunas da carga ("Para o agente de voz"), e a chave de identidade da empresa precisa existir no cofre do MotorCX. Sem um dos dois, o arquivo não tem o dado e vale "Se faltar dado".</Aviso>}
				<FormIdentidade valor={valor} onTrocar={setValor} temCrm={dados.temCrm} somenteLeitura={!podeSalvar} />
				{dados.historico.length > 0 && (
					<section className={card} style={sombra} aria-labelledby="t-hist">
						<h2 id="t-hist" className="mb-1.5 text-[15px] font-semibold text-[var(--base-texto)]">Histórico</h2>
						<ul className="space-y-1.5 text-[12.5px]">
							{dados.historico.map(h => (
								<li key={h.id} className="grid gap-x-3 sm:grid-cols-[150px_minmax(0,1fr)]">
									<span className="text-[var(--base-texto-3)] tnum">{dataCurta(h.vigente_desde)}{h.vigente_ate ? '' : ' · em vigor'}</span>
									<span className="text-[var(--base-texto-2)]">{h.mudancas ?? textoFonte(h.identidade)}</span>
								</li>
							))}
						</ul>
					</section>
				)}
				{podeSalvar && (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--base-cartao)] px-4 py-3" style={sombra}>
						<span className="min-w-0 text-[12.5px] text-[var(--base-texto-2)]">{motivo || 'Vale a partir da próxima rotina do motor, ou agora com "Reenquadrar agora". Cada mudança fica no Histórico.'}</span>
						<span className="flex flex-wrap gap-2">
							{dados.vigente && <Botao secundario disabled={salvando} onClick={() => void salvar(null)}>Voltar ao de hoje</Botao>}
							<Botao secundario disabled={salvando || !mudou} onClick={() => setValor(base)}>Desfazer</Botao>
							<Botao disabled={salvando || !!motivo || !mudou} onClick={() => void salvar(valor)}>Salvar</Botao>
						</span>
					</div>
				)}
			</div>
		</>
	);
}
