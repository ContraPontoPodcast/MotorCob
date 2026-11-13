// Agente de voz › Ofertas (SQL 130/131/132; SPEC_OFERTAS_v2 e o protótipo aprovado, telas #/ofertas e #/testar).
// "Ofertas da carteira": de onde vêm as ofertas (a API do credor, o arquivo do dia ou os dois, em que ordem), o estado da
// API nas últimas 24 h, o que a última carga trouxe (só contagens), a trava da alçada (só leitura) e o que acontece sem
// oferta. ATIVA só o Admin do cliente (editar_orquestracao; o banco confere em ativar_ofertas_voz); a equipe MotorCX
// monta o rascunho. "Testar com cliente fictício": as situações prontas com a MESMA regra do executor da VM
// (lib/ofertas-voz.ts › avaliar), com a origem de cada oferta e a conversa. Nenhum dado de cliente aparece aqui.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { Loading, Notice } from '@/components/app-shell';
import { Aviso, Botao, Pilula, Vazio, campoCls, campoStyle } from '@/components/voz/ui';
import {
	ALCADA_EXEMPLO, CAMPOS_ARQUIVO, ESTADO_API, MODOS, NOME_FONTE, NOME_MOTIVO, RESPOSTAS, avaliar, cenarios, conversa, dma, nomeModo, ordemDe,
	paraSalvarOfertas, recomendado, rotulo, validarOfertas, type ConfigOfertas, type Fonte, type Modo, type PainelOfertas, type Resposta,
} from '@/lib/ofertas-voz';
import { dataCurta, nTxt } from '@/lib/fluxo';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo } from './contexto';
import { executar, hojeSP, useCarregar, useNomeCarteira } from './comum';
import type { ConectorRow } from './api';

const card = 'rounded-2xl bg-[var(--base-cartao)] px-4 py-3.5 min-w-0';
const sombra = { boxShadow: '0 0 0 1px var(--base-borda)' };
const H2 = ({ id, children, extra }: { id: string; children: ReactNode; extra?: ReactNode }) => (
	<div className="mb-2.5 flex flex-wrap items-center justify-between gap-2"><h2 id={id} className="text-[15px] font-semibold text-[var(--base-texto)]">{children}</h2>{extra}</div>
);
const Linha = ({ k, v }: { k: ReactNode; v: ReactNode }) => (
	<div className="flex justify-between gap-3 border-b py-1.5 text-[13px] last:border-b-0" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
		<span className="min-w-0 text-[var(--base-texto-2)]">{k}</span><span className="min-w-0 text-right tnum">{v}</span>
	</div>
);
const SeloFonte = ({ f, children }: { f: Fonte; children?: ReactNode }) => (
	<span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold"
		style={{ backgroundColor: f === 'api' ? 'color-mix(in srgb, var(--area-voz) 14%, var(--base-cartao))' : 'var(--base-fill)', color: f === 'api' ? 'var(--area-voz)' : 'var(--base-texto-2)' }}>
		{children ?? NOME_FONTE[f]}
	</span>
);
const Fixo = () => (
	<p className="flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: 'color-mix(in srgb, var(--area-voz) 10%, var(--base-cartao))', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--area-voz) 22%, transparent)' }}>
		<Lock size={15} className="mt-[2px] shrink-0 text-[var(--area-voz)]" aria-hidden />
		<span><b className="font-semibold">O agente não calcula.</b> Ele apresenta exatamente as ofertas recebidas, na ordem recebida, uma por vez. Não dá desconto, não divide parcela e não negocia. Pediu outra condição: transfere para um atendente.</span>
	</p>
);

/** De onde vêm as ofertas (só apresentação; testado em ofertas.test.tsx). */
export function FormOfertas({ valor, onTrocar, conectores, somenteLeitura }: {
	valor: ConfigOfertas; onTrocar: (c: ConfigOfertas) => void; conectores: ConectorRow[]; somenteLeitura?: boolean;
}) {
	const temApi = conectores.length > 0;
	const rec = recomendado(temApi);
	const t = (c: ConfigOfertas) => { if (!somenteLeitura) onTrocar(c); };
	const ordem = ordemDe(valor.modo);
	return (
		<section className={card} style={sombra} aria-labelledby="t-fonte">
			<H2 id="t-fonte">De onde vêm as ofertas</H2>
			<div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="t-fonte">
				{MODOS.map(m => {
					const desl = !temApi && m.ordem.includes('api');
					const marcado = valor.modo === m.id;
					return (
						<label key={m.id} className={`flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2.5 ${desl || somenteLeitura ? 'cursor-default' : 'cursor-pointer'} ${desl ? 'opacity-50' : ''}`}
							style={{ boxShadow: `0 0 0 ${marcado ? 2 : 1}px ${marcado ? 'var(--destaque)' : 'var(--base-borda)'}`, backgroundColor: marcado ? 'color-mix(in srgb, var(--destaque) 7%, var(--base-cartao))' : 'var(--base-cartao)' }}>
							<input type="radio" name="modo" className="mt-1 shrink-0" checked={marcado} disabled={desl || somenteLeitura}
								onChange={() => t({ modo: m.id, conector_id: m.id === 'so_arquivo' ? null : valor.conector_id ?? conectores[0]?.id ?? null })} />
							<span className="min-w-0">
								<b className="text-[13.5px] font-semibold text-[var(--base-texto)]">{m.nome}</b>
								{m.id === rec && <span className="ml-1.5 text-[10.5px] font-bold uppercase tracking-[0.04em] text-[var(--estado-ok-texto,var(--estado-ok))]">recomendado</span>}
								<small className="mt-0.5 block text-[12.5px] text-[var(--base-texto-2)]">{m.desc}</small>
							</span>
						</label>
					);
				})}
			</div>
			{valor.modo !== 'so_arquivo' && (
				<label className="mt-3 block max-w-[420px]">
					<span className="block text-[12.5px] font-semibold text-[var(--base-texto)]">Conector da API (Buscar ofertas)</span>
					<select className={`${campoCls} mt-1 h-9 w-full`} style={campoStyle} value={valor.conector_id ?? ''} disabled={somenteLeitura}
						onChange={e => t({ ...valor, conector_id: e.target.value ? Number(e.target.value) : null })}>
						<option value="">— escolher —</option>
						{conectores.map(c => <option key={c.id} value={c.id}>{c.nome}{c.situacao !== 'ativo' ? ` (${c.situacao})` : ''}</option>)}
					</select>
				</label>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-[13px]" aria-label="Ordem" style={{ backgroundColor: 'var(--base-fill)' }}>
				{ordem.map((f, i) => <span key={f} className="contents">{i > 0 && <span className="text-[var(--base-texto-3)]">→</span>}<SeloFonte f={f}>{i + 1} · {NOME_FONTE[f]}{i > 0 ? ' (reserva)' : ''}</SeloFonte></span>)}
				<span className="text-[var(--base-texto-3)]">→</span><Pilula tom="neutro">sem oferta: transferir</Pilula>
			</div>
			<ul className="mt-2.5 grid list-disc gap-1 pl-5 text-[13px] text-[var(--base-texto-2)]">
				<li>Vale uma fonte por ligação: a 1ª da ordem com oferta válida. As fontes não se misturam.</li>
				<li>A reserva entra quando a API falha (2,5 s, 1 nova tentativa, teto de 4 s) ou quando todas as ofertas da fonte são descartadas.</li>
				<li>Se a API responder "sem oferta para este cliente", o arquivo não é usado.</li>
				<li>Oferta vencida ou sem validade não entra. A API nunca recebe o CPF.</li>
			</ul>
		</section>
	);
}

function CartaoApi({ p, modo }: { p: PainelOfertas; modo: Modo }) {
	const a = p.api;
	if (!a) return (
		<section className={card} style={sombra} aria-labelledby="t-api">
			<H2 id="t-api" extra={<Pilula tom="neutro">Não configurada</Pilula>}>API do credor</H2>
			<p className="text-[13px] text-[var(--base-texto-2)]">Esta empresa não tem conector "Buscar ofertas". Sem API, só o arquivo pode trazer ofertas. A equipe MotorCX cadastra o conector em Integrações › Conectores.</p>
		</section>
	);
	const e = ESTADO_API[a.estado] ?? ESTADO_API.sem_dados;
	const comArquivo = ordemDe(modo).includes('arquivo');
	return (
		<section className={card} style={sombra} aria-labelledby="t-api">
			<H2 id="t-api" extra={<Pilula tom={e.tom}>{e.texto}</Pilula>}>API do credor</H2>
			<Linha k="Conector" v={<>{a.nome} · <code className="text-[12px]">{a.host}</code>{a.situacao !== 'ativo' ? ` (${a.situacao})` : ''}</>} />
			<Linha k="Envia" v="código do cliente, contrato e id da chamada (nunca o CPF)" />
			<Linha k="Tempo máximo" v={`${(a.timeout_ms / 1000).toLocaleString('pt-BR')} s · ${a.tentativas} nova(s) tentativa(s) · teto de 4 s`} />
			<Linha k="Se falhar" v={comArquivo ? 'usa o arquivo' : 'transfere para atendente'} />
			<h3 className="mt-3 mb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--base-texto-3)]">Últimas 24 horas</h3>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
				{[['Respondeu', a.ok_pct == null ? '—' : `${String(a.ok_pct).replace('.', ',')}%`], ['Tempo médio', a.media_ms == null ? '—' : `${nTxt(a.media_ms)} ms`], ['p95', a.p95_ms == null ? '—' : `${nTxt(a.p95_ms)} ms`]].map(([k, v]) => (
					<div key={k} className="rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--base-fill)' }}><small className="block text-[11.5px] text-[var(--base-texto-2)]">{k}</small><strong className="block text-[17px] tnum">{v}</strong></div>
				))}
			</div>
			<div className="mt-2">
				<Linha k="Chamadas" v={nTxt(a.chamadas)} />
				<Linha k="Falhas por tempo esgotado" v={nTxt(a.falhas_tempo)} />
				<Linha k="Falhas por erro (5xx, credencial, resposta ilegível)" v={nTxt(a.falhas_erro)} />
				{p.uso && <Linha k="Reserva usada" v={nTxt(p.uso.reserva)} />}
				{p.uso && <Linha k="Ofertas descartadas (vencidas, acima da alçada, incompletas, conta)" v={nTxt(Object.values(p.uso.descartes).reduce((s, n) => s + n, 0))} />}
			</div>
		</section>
	);
}

function CartaoArquivo({ p }: { p: PainelOfertas }) {
	const r = p.carga?.relatorio;
	return (
		<section className={card} style={sombra} aria-labelledby="t-arq">
			<H2 id="t-arq" extra={r ? <Pilula tom="ok">Última carga, {dataCurta(p.carga!.em)}</Pilula> : <Pilula tom="neutro">Sem colunas de oferta</Pilula>}>Colunas do arquivo</H2>
			<p className="mb-2 text-[13px] text-[var(--base-texto-2)]">Cada linha do mailing pode trazer até 3 ofertas prontas (oferta1 a oferta3). O agente fala os números como vieram. Aponte as colunas em <b className="font-semibold text-[var(--base-texto)]">Colunas da carga</b> (Para o agente de voz › Ofertas prontas).</p>
			<div className="flex flex-wrap gap-1.5">
				{CAMPOS_ARQUIVO.map(c => <Pilula key={c.campo} tom={c.obrig ? 'info' : 'neutro'}>{c.nome}{c.obrig ? ' · obrigatório' : ''}</Pilula>)}
			</div>
			{r && (
				<>
					<h3 className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--base-texto-3)]">Última carga (só contagens)</h3>
					<Linha k="Clientes com ao menos 1 oferta" v={`${nTxt(r.clientes_com_oferta ?? 0)} de ${nTxt(r.clientes_na_carga ?? 0)}`} />
					<Linha k="Ofertas vencidas (não entram)" v={nTxt(r.descartadas?.vencida ?? 0)} />
					<Linha k="Incompletas ou sem validade (descartadas)" v={nTxt(r.descartadas?.incompleta ?? 0)} />
					<Linha k="Conta que não fecha (descartadas)" v={nTxt(r.descartadas?.conta ?? 0)} />
					<Linha k="Clientes com vários contratos com oferta (vale o da ligação, senão o de maior saldo)" v={nTxt(r.varios_contratos ?? 0)} />
				</>
			)}
			<h3 className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--base-texto-3)]">Não existem mais</h3>
			<div className="flex flex-wrap gap-1.5 text-[12px] text-[var(--base-texto-3)]">{['desconto_max', 'parcelas_max', 'entrada_min', 'regras de desconto', 'ofertas padrão da alçada'].map(x => <span key={x} className="rounded-full px-2 py-0.5 line-through" style={{ backgroundColor: 'var(--base-fill)' }}>{x}</span>)}</div>
		</section>
	);
}

function CartaoAlcada({ p }: { p: PainelOfertas }) {
	const a = p.alcada;
	const reais = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
	return (
		<section className={card} style={sombra} aria-labelledby="t-alc">
			<H2 id="t-alc">Trava da alçada</H2>
			<p className="mb-2 text-[13px] text-[var(--base-texto-2)]">Só confere. A oferta que passa de qualquer limite é descartada inteira. Nada é cortado nem recalculado.</p>
			{a ? (<>
				<Linha k="Desconto máximo" v={`${String(a.desconto_max_pct).replace('.', ',')}%`} />
				<Linha k="Parcelas máximas" v={a.parcelas_max} />
				<Linha k="Parcela mínima" v={reais(Number(a.parcela_min))} />
				<Linha k="Entrada mínima" v={Number(a.entrada_min) > 0 ? reais(Number(a.entrada_min)) : 'não exige'} />
			</>) : <Aviso tom="erro" titulo="Sem alçada cadastrada, nenhuma oferta passa.">Cadastre a alçada da carteira (Agente de voz › fluxo › Alçada) antes de ativar.</Aviso>}
		</section>
	);
}

/** A tela "Ofertas da carteira". */
export function OfertasAgente() {
	const { api, empresa, credor, rota, equipe } = useFluxo();
	const nomeCarteira = useNomeCarteira();
	const credorId = credor?.id ?? null;
	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api || !empresa) return null;
		const [painel, conectores, historico] = await Promise.all([
			api.painelOfertas(empresa.id, credorId), api.conectores(empresa.id).catch(() => []), api.historicoOfertas(empresa.id, credorId).catch(() => []),
		]);
		return { painel, conectores: conectores.filter(c => c.finalidade === 'buscar_ofertas'), historico };
	}, [api, empresa?.id, credorId]);
	const base = useMemo<ConfigOfertas | null>(() => {
		if (!dados) return null;
		const c = dados.painel.config?.ofertas ?? dados.painel.rascunho?.ofertas;
		if (c) return c;
		const k = dados.painel.api?.conector_id ?? dados.conectores[0]?.id ?? null;
		return { modo: recomendado(k != null), conector_id: k };
	}, [dados]);
	const [valor, setValor] = useState<ConfigOfertas | null>(null);
	const [salvando, setSalvando] = useState(false);
	useEffect(() => { setValor(base); }, [base]);

	const heading = <CabecalhoAgente titulo="Ofertas da carteira" desc={`Carteira ${nomeCarteira(credorId)}: de onde vêm as ofertas que o agente apresenta. Vale para todas as ligações do agente nesta carteira.`} atual="ofertas"
		acoes={<Link to={rota('ofertas', 'testar')} className="text-[13px] font-semibold text-[var(--destaque)]">Testar com cliente fictício →</Link>} />;
	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (carregando && !dados) return <>{heading}<Loading /></>;
	if (erro && !dados) return <>{heading}<Notice>{/painel_ofertas_voz|does not exist/.test(erro) ? 'O banco ainda não tem esta tela (SQL 132). As ofertas seguem como hoje.' : erro}</Notice></>;
	if (!dados || !valor) return heading;
	const p = dados.painel;
	if (!p.pode.rascunho && !p.pode.ativar && equipe) return <>{heading}<Vazio titulo="Seu perfil não monta as ofertas desta empresa.">A equipe MotorCX precisa de Responder chamados.</Vazio></>;

	const vigente = p.config?.ofertas ?? null;
	const motivo = validarOfertas(valor);
	const mudou = JSON.stringify(paraSalvarOfertas(valor)) !== JSON.stringify(vigente);
	const ordem = ordemDe(valor.modo);
	const conSel = dados.conectores.find(c => c.id === valor.conector_id);
	async function ativar(c: ConfigOfertas | null) {
		if (!api || !empresa) return;
		setSalvando(true);
		const ok = await executar(() => api.ativarOfertas(empresa.id, credorId, c ? paraSalvarOfertas(c) : null), c ? 'Ativado. Vale a partir da próxima ligação.' : 'Voltou ao padrão: API, e o arquivo como reserva.');
		setSalvando(false);
		if (ok) await recarregar();
	}
	async function rascunho(c: ConfigOfertas | null) {
		if (!api || !empresa) return;
		setSalvando(true);
		const ok = await executar(() => api.rascunhoOfertas(empresa.id, credorId, c ? paraSalvarOfertas(c) : null), c ? 'Rascunho salvo. O Admin do cliente ativa.' : 'Rascunho apagado.');
		setSalvando(false);
		if (ok) await recarregar();
	}

	return (
		<>
			{heading}
			<div className="space-y-4">
				<Fixo />
				{vigente
					? <Aviso tom="ok" titulo={`Em vigor desde ${dataCurta(p.config!.vigente_desde)}${p.config!.credor_id == null && credorId != null ? ' (da empresa toda)' : ''}: ${nomeModo(vigente.modo)}.`} />
					: <Aviso tom="neutro" titulo="Ainda sem escolha: vale o padrão (API, e o arquivo como reserva; sem API, só o arquivo).">Nada muda até o Admin do cliente ativar.</Aviso>}
				{p.rascunho && <Aviso tom="info" titulo={`Rascunho da equipe MotorCX (${dataCurta(p.rascunho.salvo_em)}): ${nomeModo(p.rascunho.ofertas.modo)}.`}>{p.pode.ativar ? 'Confira e ative, ou apague.' : 'Esperando o Admin do cliente ativar.'}</Aviso>}
				{!p.pode.ativar && <Aviso tom="neutro" titulo={p.pode.rascunho ? 'Você monta o rascunho; só o Admin do cliente ativa.' : 'Só o Admin do cliente muda de onde vêm as ofertas.'}>A fonte e a ordem decidem o que o agente oferece. O Histórico guarda quem mudou e o quê.</Aviso>}
				{p.api?.estado === 'fora' && ordem[0] === 'api' && <Aviso tom="erro" titulo="A API está fora do ar agora.">{ordem.includes('arquivo') ? 'As ligações estão usando o arquivo como reserva.' : 'Com "só a API", as ligações estão sendo transferidas para atendente.'}</Aviso>}
				{p.api?.estado === 'instavel' && <Aviso tom="atencao" titulo="A API falhou 3 vezes seguidas.">Por 5 minutos o agente vai direto à reserva. Depois, tenta a API de novo.</Aviso>}
				{p.api && !p.api.mapeia_validade && ordem.includes('api') && <Aviso tom="atencao" titulo='O conector não mapeia a "validade" das ofertas.'>Sem validade a oferta é descartada. Peça à equipe MotorCX para mapear oferta.validade no conector.</Aviso>}
				{conSel && conSel.situacao !== 'ativo' && valor.modo !== 'so_arquivo' && <Aviso tom="atencao" titulo={`O conector "${conSel.nome}" está ${conSel.situacao}.`}>Enquanto não estiver ativo, a API conta como falha.</Aviso>}
				{!p.carga?.relatorio && ordem.includes('arquivo') && <Aviso tom="atencao" titulo="A última carga não trouxe colunas de oferta.">A fonte "arquivo" não vai ter oferta até as colunas oferta1..3 serem apontadas.</Aviso>}
				{!p.alcada && <Aviso tom="erro" titulo="Sem alçada, nenhuma oferta passa.">Cadastre a alçada antes de ativar (Q6).</Aviso>}
				<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
					<div className="grid min-w-0 gap-4">
						<FormOfertas valor={valor} onTrocar={setValor} conectores={dados.conectores} somenteLeitura={!p.pode.rascunho} />
						<CartaoArquivo p={p} />
					</div>
					<div className="grid min-w-0 gap-4">
						<CartaoApi p={p} modo={valor.modo} />
						<CartaoAlcada p={p} />
						<section className={card} style={sombra} aria-labelledby="t-sem">
							<H2 id="t-sem">Quando não há oferta ou o cliente pede outra</H2>
							<ul className="grid list-disc gap-1 pl-5 text-[13px] text-[var(--base-texto-2)]">
								<li>Nenhuma oferta válida: <b className="font-semibold text-[var(--base-texto)]">transfere para atendente</b>.</li>
								<li>O cliente pede uma condição que não está na lista: <b className="font-semibold text-[var(--base-texto)]">transfere para atendente</b>.</li>
								<li>Sem atendente no horário: segue o caminho "sem acordo" do roteiro (retorno ou recado).</li>
							</ul>
						</section>
					</div>
				</div>
				{dados.historico.length > 0 && (
					<section className={card} style={sombra} aria-labelledby="t-hist">
						<H2 id="t-hist">Histórico</H2>
						<ul className="space-y-1.5 text-[12.5px]">
							{dados.historico.map(h => (
								<li key={h.id} className="grid gap-x-3 sm:grid-cols-[150px_minmax(0,1fr)]">
									<span className="text-[var(--base-texto-3)] tnum">{dataCurta(h.vigente_desde)}{h.vigente_ate ? '' : ' · em vigor'}</span>
									<span className="text-[var(--base-texto-2)]">{h.mudancas ?? nomeModo(h.ofertas.modo)}</span>
								</li>
							))}
						</ul>
					</section>
				)}
				{(p.pode.ativar || p.pode.rascunho) && (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--base-cartao)] px-4 py-3" style={sombra}>
						<span className="min-w-0 flex-1 text-[12.5px] text-[var(--base-texto-2)]">{motivo || (p.pode.ativar ? 'Vale a partir da próxima ligação. A mudança fica no Histórico com quem fez e o que mudou.' : 'O rascunho não vale para as ligações até o Admin do cliente ativar.')}</span>
						<span className="flex flex-wrap gap-2">
							{p.pode.ativar && vigente && <Botao secundario disabled={salvando} onClick={() => void ativar(null)}>Voltar ao padrão</Botao>}
							{p.rascunho && <Botao secundario disabled={salvando} onClick={() => void rascunho(null)}>Apagar rascunho</Botao>}
							{!p.pode.ativar && <Botao disabled={salvando || !!motivo} onClick={() => void rascunho(valor)}>Salvar rascunho</Botao>}
							{p.pode.ativar && <Botao disabled={salvando || !!motivo || (!mudou && !p.rascunho)} onClick={() => void ativar(valor)}>Ativar</Botao>}
						</span>
					</div>
				)}
			</div>
		</>
	);
}

/** A tela "Testar com cliente fictício": as situações prontas, com a regra do executor. */
export function TestarOfertas() {
	const { api, empresa, credor } = useFluxo();
	const nomeCarteira = useNomeCarteira();
	const credorId = credor?.id ?? null;
	const { dados } = useCarregar(async () => (api && empresa ? api.painelOfertas(empresa.id, credorId).catch(() => null) : null), [api, empresa?.id, credorId]);
	const hoje = hojeSP();
	const lista = useMemo(() => cenarios(hoje), [hoje]);
	const [cenId, setCen] = useState('normal');
	const [modoTeste, setModo] = useState<Modo | null>(null);
	const [resp, setResp] = useState<Resposta | null>(null);
	const modoCarteira: Modo = dados?.config?.ofertas.modo ?? (dados?.api ? 'api_arquivo' : 'so_arquivo');
	const modo = modoTeste ?? modoCarteira;
	const cen = lista.find(c => c.id === cenId) ?? lista[0];
	const r0 = resp ?? cen.resposta;
	const alc = dados?.alcada ?? ALCADA_EXEMPLO;
	const r = avaliar(cen, modo, alc, hoje);
	const conv = conversa(r, r0, modo);
	const reservaPorque = r.fonte === 'arquivo' && ordemDe(modo)[0] === 'api' ? (r.apiFalhou ? ' (reserva: a API não respondeu)' : ' (reserva: as ofertas da API foram descartadas)') : '';

	return (
		<>
			<CabecalhoAgente titulo="Testar com cliente fictício" desc={`Carteira ${nomeCarteira(credorId)}: escolha uma situação. A tela mostra de onde veio cada oferta e o que o agente diria. Nada é ligado nem gravado.`} atual="ofertas" />
			<div className="space-y-4">
				<section className={card} style={sombra} aria-labelledby="t-cen">
					<H2 id="t-cen">Situações</H2>
					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						{lista.map(c => (
							<button key={c.id} type="button" aria-pressed={c.id === cenId} onClick={() => { setCen(c.id); setResp(null); }}
								className="flex min-w-0 flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left"
								style={{ boxShadow: `0 0 0 ${c.id === cenId ? 2 : 1}px ${c.id === cenId ? 'var(--destaque)' : 'var(--base-borda)'}`, backgroundColor: c.id === cenId ? 'color-mix(in srgb, var(--destaque) 7%, var(--base-cartao))' : 'var(--base-cartao)' }}>
								<b className="text-[13.5px] font-semibold">{c.titulo}</b><small className="text-[12px] text-[var(--base-texto-2)]">{c.desc}</small>
							</button>
						))}
					</div>
				</section>
				<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
					<div className="grid min-w-0 gap-4">
						<section className={card} style={sombra} aria-labelledby="t-cli">
							<H2 id="t-cli" extra={<Pilula tom="neutro">fictício</Pilula>}>O cliente</H2>
							<p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]"><b>Ana Teste</b><span className="text-[var(--base-texto-2)]">código CLI-000123</span><span className="text-[var(--base-texto-2)]">documento: oculto</span></p>
							<div className="grid gap-3 sm:grid-cols-2">
								<label className="min-w-0"><span className="block text-[12.5px] font-semibold">Ordem usada no teste</span>
									<select className={`${campoCls} mt-1 h-9 w-full`} style={campoStyle} value={modo} onChange={e => setModo(e.target.value === modoCarteira ? null : e.target.value as Modo)}>
										{MODOS.map(m => <option key={m.id} value={m.id}>{m.curto}{m.id === modoCarteira ? ' (a da carteira)' : ''}</option>)}
									</select></label>
								<label className="min-w-0"><span className="block text-[12.5px] font-semibold">O cliente…</span>
									<select className={`${campoCls} mt-1 h-9 w-full`} style={campoStyle} value={r0} onChange={e => setResp(e.target.value as Resposta)}>
										{(Object.keys(RESPOSTAS) as Resposta[]).map(k => <option key={k} value={k}>{RESPOSTAS[k]}</option>)}
									</select></label>
							</div>
						</section>
						<section className={card} style={sombra} aria-labelledby="t-ofs">
							<H2 id="t-ofs">Ofertas e de onde vieram</H2>
							{r.linhas.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma oferta chegou de nenhuma fonte.</p> : (
								<ul className="divide-y" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
									{r.linhas.map((l, i) => {
										const pos = r.usadas ? r.usadas.indexOf(l.o) : -1;
										return (
											<li key={i} data-oferta={l.o.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 py-2 text-[13px]" style={{ borderColor: 'var(--base-separator, var(--base-borda))', opacity: l.naoUsada ? 0.65 : 1 }}>
												<SeloFonte f={l.fonte}>{l.fonte === 'api' ? 'API' : 'Arquivo'}</SeloFonte>
												<span className="min-w-0"><b className={l.motivo ? 'font-semibold text-[var(--base-texto-3)] line-through' : 'font-semibold'}>{rotulo(l.o)}</b>
													<small className="block text-[12px] text-[var(--base-texto-2)]">id {l.o.id} · válida até {dma(l.o.validade)}{l.o.valor_total != null ? ` · total R$ ${l.o.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}</small></span>
												<span className="col-start-2">{l.motivo ? <Pilula tom="erro">Descartada: {NOME_MOTIVO[l.motivo]}</Pilula> : l.naoUsada ? <Pilula tom="neutro">{l.naoUsada}</Pilula> : pos >= 0 ? <Pilula tom="ok">Apresentada em {pos + 1}º</Pilula> : <Pilula tom="neutro">Além das 3 primeiras</Pilula>}</span>
											</li>
										);
									})}
								</ul>
							)}
						</section>
					</div>
					<section className={card} style={sombra} aria-labelledby="t-lig">
						<H2 id="t-lig">Como seria a ligação</H2>
						<div className="grid gap-2 rounded-xl px-3 py-2.5 text-[13.5px]" style={{ backgroundColor: 'var(--base-fill)' }}>
							<div className="grid gap-x-3 sm:grid-cols-[110px_minmax(0,1fr)]"><b className="text-[12px] uppercase tracking-[0.04em] text-[var(--base-texto-3)]">Fonte</b>
								<span>{r.fonte ? <><SeloFonte f={r.fonte} />{reservaPorque}</> : <><Pilula tom="atencao">Nenhuma</Pilula> {r.apiSemOferta ? 'a API respondeu sem oferta' : 'nenhuma fonte trouxe oferta válida'}</>}</span></div>
							<div className="grid gap-x-3 sm:grid-cols-[110px_minmax(0,1fr)]"><b className="text-[12px] uppercase tracking-[0.04em] text-[var(--base-texto-3)]">Oferece</b>
								<span>{r.usadas ? `${r.usadas.length} oferta(s), na ordem da fonte: ${r.usadas.map(rotulo).join(' → ')}` : 'Nenhuma. O agente transfere para atendente.'}</span></div>
							<div className="grid gap-x-3 sm:grid-cols-[110px_minmax(0,1fr)]"><b className="text-[12px] uppercase tracking-[0.04em] text-[var(--base-texto-3)]">Se pedir outra</b>
								<span>Transfere para atendente. Sem atendente no horário, segue o "sem acordo" do roteiro.</span></div>
						</div>
						<div className="mt-2 flex flex-col">
							{conv.map((f, i) => f.quem === 'evento'
								? <span key={i} className="my-2 self-center rounded-full px-3 py-0.5 text-center text-[12px] font-semibold" style={{ backgroundColor: f.tom === 'ok' ? 'var(--estado-pronto-fundo)' : f.tom === 'atencao' ? 'var(--estado-atencao-fundo)' : 'var(--base-fill)', color: f.tom === 'ok' ? 'var(--estado-pronto-texto)' : f.tom === 'atencao' ? 'var(--estado-atencao-texto)' : 'var(--base-texto-2)' }}>{f.texto}</span>
								: <p key={i} className={`my-1 max-w-[88%] rounded-xl px-3 py-1.5 text-[13.5px] ${f.quem === 'cliente' ? 'ml-auto' : ''}`} style={{ backgroundColor: f.quem === 'cliente' ? 'color-mix(in srgb, var(--destaque) 9%, var(--base-cartao))' : 'var(--base-fill)' }}>
									<span className="block text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--base-texto-3)]">{f.quem === 'cliente' ? 'Cliente' : 'Agente'}</span>{f.texto}</p>)}
						</div>
						<details className="mt-3 border-t pt-2.5 text-[13px]" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>
							<summary className="cursor-pointer font-semibold text-[var(--destaque)]">Ver o porquê, passo a passo</summary>
							<ol className="mt-2 grid gap-1">{r.passos.map((x, i) => <li key={i} className="flex gap-2"><span aria-hidden>{x.ok ? '✓' : x.erro ? '×' : i + 1}</span><span className="min-w-0">{x.texto}</span></li>)}</ol>
							<p className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">Hoje no teste: {dma(hoje)}. Alçada {dados?.alcada ? 'da carteira' : 'de exemplo'}: {alc.desconto_max_pct}% de desconto, {alc.parcelas_max} parcelas, parcela mínima R$ {Number(alc.parcela_min).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.</p>
						</details>
					</section>
				</div>
			</div>
		</>
	);
}
