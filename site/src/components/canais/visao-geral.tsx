// Cobrança › Configurações › Canais: visão geral (SPEC Canais §3.2; protótipo aprovado em 08/11, PR 5).
// Nenhum campo nesta tela: um cartão por canal com estado, quem executa, última atividade, problema + o que fazer, a
// ação principal e "Configurar". O estado vem da RPC estado_canais (SQL 84). "Configurar" abre a configuração de hoje
// do canal (/canais/:canal) até a tela nova do canal (PR 6). Só tokens do tema: vale no claro e no escuro.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Pause, RefreshCw, Upload } from 'lucide-react';
import { PageHeading, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, Botao, BotaoLink, Estado, SOMBRA, TOM } from '@/components/ds';
import { ImportarPlaybookModal } from '@/components/canais/importar-playbook';
import { friendlyError, supabase } from '@/lib/supabase';
import { PERM } from '@/lib/permissoes';
import { ROTA_DISCAGEM, ROTA_VOZ } from '@/lib/rotas-voz';
import {
	acaoDe, CANAIS_TELA, chipsResumo, ESTADOS, identidade, instante, linhasAtividade, quemTexto,
	type CanalEstado, type EstadoCanais, type EstadoCanal, type Trecho,
} from '@/lib/estado-canais';

function PilulaEstado({ estado, children }: { estado: EstadoCanal; children?: ReactNode }) {
	const e = ESTADOS[estado];
	const marca = estado === 'pausado'
		? <Pause size={10} aria-hidden strokeWidth={3} />
		: <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full" style={estado === 'nao_configurado'
			? { boxShadow: `inset 0 0 0 1.5px ${TOM.neutro.ponto}` } : { backgroundColor: TOM[e.tom].ponto }} />;
	const t = TOM[e.tom];
	return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ backgroundColor: t.fundo, color: t.texto }}>{marca}{children ?? e.rotulo}</span>;
}

function Linha({ trechos }: { trechos: Trecho[] }) {
	return <span>{trechos.map((x, i) => x.b ? <b key={i} className="font-medium text-[var(--base-texto)]">{x.t}</b> : <span key={i}>{x.t}</span>)}</span>;
}

export function CartaoCanal({ c, hoje }: { c: CanalEstado; hoje: string }) {
	const id = identidade(c.canal, c.quem);
	const acao = acaoDe(c.acao, c.canal);
	const tom = ESTADOS[c.estado].tom;
	return (
		<article aria-label={id.nome} className="flex min-w-0 flex-col gap-3 rounded-2xl bg-[var(--base-cartao)] p-4 sm:p-5" style={{ boxShadow: SOMBRA }} data-canal={c.canal} data-estado={c.estado}>
			<div className="flex items-start gap-3">
				<span aria-hidden className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-[12.5px] font-bold text-white" style={{ backgroundColor: id.cor }}>{id.sigla}</span>
				<div className="min-w-0 flex-1">
					<h3 className="text-[16px] font-semibold leading-tight text-[var(--base-texto)]">{id.nome}</h3>
					<p className="mt-0.5 text-[12.5px] leading-snug text-[var(--base-texto-2)]">{quemTexto(c.canal, c.quem)}</p>
				</div>
				<span className="shrink-0"><PilulaEstado estado={c.estado} /></span>
			</div>
			<div className="flex flex-col gap-0.5 text-[13px] text-[var(--base-texto-2)]">
				{linhasAtividade(c, hoje).map((l, i) => <Linha key={i} trechos={l} />)}
			</div>
			{c.estado !== 'funcionando' && c.problema && c.estado !== 'pausado' && (
				<div className="rounded-[10px] px-3 py-2.5 text-[13px] leading-relaxed" style={{ backgroundColor: TOM[tom].fundo, color: tom === 'neutro' ? 'var(--base-texto-2)' : TOM[tom].texto }}>
					<b className="font-semibold" style={tom === 'neutro' ? { color: 'var(--base-texto)' } : undefined}>{c.problema}</b>
					{c.o_que_fazer && <><br /><span>{c.o_que_fazer}</span></>}
				</div>
			)}
			<div className="mt-auto flex flex-wrap gap-2 pt-1">
				<BotaoLink tipo="primario" pequeno to={acao.to}>{acao.rotulo}</BotaoLink>
				<BotaoLink pequeno to={`/canais/${c.canal}`}>Configurar</BotaoLink>
			</div>
		</article>
	);
}

/** Sem a RPC (SQL 84 ainda não aplicado) a configuração de cada canal continua a um clique. */
function CartoesSemEstado() {
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{CANAIS_TELA.map(c => {
				const id = identidade(c);
				return (
					<article key={c} aria-label={id.nome} className="flex items-center gap-3 rounded-2xl bg-[var(--base-cartao)] p-4" style={{ boxShadow: SOMBRA }}>
						<span aria-hidden className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-[12.5px] font-bold text-white" style={{ backgroundColor: id.cor }}>{id.sigla}</span>
						<h3 className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--base-texto)]">{id.nome}</h3>
						<BotaoLink pequeno to={`/canais/${c}`}>Configurar</BotaoLink>
					</article>
				);
			})}
		</div>
	);
}

function Grupo({ titulo, sub, canais, hoje }: { titulo: string; sub: ReactNode; canais: CanalEstado[]; hoje: string }) {
	if (!canais.length) return null;
	return (
		<section aria-label={titulo}>
			<div className="mb-2.5 mt-6 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
				<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">{titulo}</h2>
				<span className="text-[12.5px] text-[var(--base-texto-3)]">{sub}</span>
			</div>
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{canais.map(c => <CartaoCanal key={c.canal} c={c} hoje={hoje} />)}
			</div>
		</section>
	);
}

export function CanaisVisaoGeral() {
	const { empresa, perfil } = useMotorAuth();
	const podeEditar = usePermissao(PERM.editarCanais);
	const pode = podeEditar || !!perfil?.equipe;
	const [dados, setDados] = useState<EstadoCanais | null>(null);
	const [erro, setErro] = useState('');
	const [carregando, setCarregando] = useState(true);
	const [importar, setImportar] = useState(false);

	const carregar = useCallback(async () => {
		if (!supabase || !empresa || !pode) { setCarregando(false); return; }
		setCarregando(true); setErro('');
		const { data, error } = await supabase.rpc('estado_canais', { empresa: Number(empresa.id) });
		if (error) { setErro(friendlyError(error)); setDados(null); } else setDados(data as EstadoCanais);
		setCarregando(false);
	}, [empresa?.id, pode]);
	useEffect(() => { void carregar(); }, [carregar]);

	const cabecalho = (
		<PageHeading title="Canais" description="Cada canal com o seu estado: se está funcionando, o que fazer quando não está, e a configuração dele."
			actions={podeEditar ? <Botao tipo="secundario" onClick={() => setImportar(true)}><Upload size={15} aria-hidden /> Importar playbook</Botao> : undefined} />
	);
	if (!empresa) return <>{cabecalho}<Estado tipo="vazio" titulo="Escolha a empresa no topo para ver os canais." /></>;
	if (!pode) return <>{cabecalho}<Estado tipo="semPermissao" titulo="Seu perfil não vê os canais.">Quem dá acesso é o Admin da empresa, em Pessoas e perfis (permissão Editar canais e frases).</Estado></>;

	const hoje = dados?.hoje ?? new Date().toISOString().slice(0, 10);
	const mensagens = (dados?.canais ?? []).filter(c => c.grupo === 'mensagens');
	const voz = (dados?.canais ?? []).filter(c => c.grupo === 'voz');
	const vozMotorcx = voz.some(c => c.quem === 'voz_motorcx');

	return (
		<>
			{cabecalho}
			{carregando && !dados ? <Estado tipo="carregando" /> : erro || !dados ? (
				<div className="space-y-4">
					<Aviso tom="erro" titulo="Não deu para ler o estado dos canais agora." acao={<Botao tipo="secundario" pequeno onClick={() => void carregar()}>Tentar de novo</Botao>}>
						A configuração de cada canal continua abaixo. {erro}
					</Aviso>
					<CartoesSemEstado />
				</div>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2" aria-label="Resumo dos canais">
						{chipsResumo(dados.resumo).map(x => <PilulaEstado key={x.estado} estado={x.estado}>{x.texto}</PilulaEstado>)}
						<span className="text-[12.5px] text-[var(--base-texto-3)]">· atualizado {instante(dados.gerado_em, hoje)}</span>
						<Botao tipo="fantasma" pequeno onClick={() => void carregar()} disabled={carregando}><RefreshCw size={13} aria-hidden className={carregando ? 'animate-spin motion-reduce:animate-none' : ''} /> Atualizar</Botao>
					</div>
					<Grupo titulo="Mensagens" sub="WhatsApp, SMS, RCS e e-mail" canais={mensagens} hoje={hoje} />
					<Grupo titulo="Voz" canais={voz} hoje={hoje}
						sub={vozMotorcx
							? <>quem liga é a Voz MotorCX: agente, discagem e ligações ficam em <Link to={ROTA_VOZ} className="underline hover:text-[var(--base-texto)]">Agente Voz/CX</Link></>
							: <>a sua empresa liga com AGV e discador próprios; o MotorCX entrega a lista e lê o retorno · <Link to={ROTA_VOZ} className="underline hover:text-[var(--base-texto)]">Agente Voz/CX</Link></>} />
				</>
			)}
			<div className="mt-6">
				<Aviso tom="neutro">
					As <b className="font-semibold">regras de discagem</b> (renitência, resubmit, horários por UF/DDD e chamadas curtas) saíram daqui e de Cobrança › Estratégia: agora ficam em <Link to={ROTA_DISCAGEM} className="font-semibold underline">Agente Voz/CX › Discagem</Link>. As <b className="font-semibold">frases</b> continuam em <Link to="/canais?secao=frases" className="font-semibold underline">Cobrança › Estratégia › Frases</Link> e também aparecem dentro de cada canal.
				</Aviso>
			</div>
			{importar && <ImportarPlaybookModal onClose={() => setImportar(false)} onDone={() => { /* as frases recarregam na aba de cada canal */ }} />}
		</>
	);
}
