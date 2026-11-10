// Console › Fornecedores e rotas › Agente virtual › Todas as empresas: robôs vendidos × teto contratado com o provedor
// de voz (Robôs contratados, PR 5; protótipo proto-robos `#/console/voz`, SPEC §4.1). Lê voz_divisao_concorrencia
// (SQL 101: limite real de cada empresa, licenças e motivo) e voz_contrato; grava o teto por
// definir_concorrencia_contratada (equipe com gerenciar_troncos_voz). Baixar o teto abaixo dos robôs vendidos pede
// confirmação (o banco avisa a equipe no sino). Só a equipe vê esta tela: o cliente nunca vê o teto global.
import { useEffect, useMemo, useState } from 'react';
import { Phone } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import { inteiro } from '@/lib/voz';
import {
	ROTULO_MOTIVO, TOM_MOTIVO, comLicenca, linhaDivisao, porQueEquipe, resumoRobos, type LinhaDivisao,
} from '@/lib/robos-voz';
import { Cadeado, Cartao, Dialogo, Pilula, Trava, btnLink, btnPrim, btnSec, campoCls } from '@/components/comuns/voz-ui';
import { Aviso, Gaveta, Kpis, Tabela } from '@/components/ds';

/** Paleta categórica da barra (tokens que valem no claro e no escuro); da 7ª empresa em diante, "outras". */
const CORES = ['var(--canal-voz)', 'var(--canal-whatsapp)', 'var(--canal-sms)', 'var(--canal-rcs)', 'var(--canal-email)', 'var(--canal-discador)'];
const COR_OUTRAS = 'var(--base-texto-3)';

function erroRpc(e: unknown): string {
	const x = e as { code?: string; message?: string } | null;
	if (x?.code === 'P0001' && x.message) return x.message.charAt(0).toUpperCase() + x.message.slice(1) + '.';
	return friendlyError(e);
}

export function RobosTeto({ divisao, contrato, nomeEmpresa, podeTroncos, loading, onSalvo, onEscolher }: {
	divisao: Row[]; contrato: Row | null; nomeEmpresa: (id: unknown) => string; podeTroncos: boolean; loading: boolean;
	onSalvo: () => void; onEscolher: (id: string) => void;
}) {
	const linhas = useMemo(() => divisao.map(linhaDivisao), [divisao]);
	const teto = Number(contrato?.concorrencia_contratada ?? linhas[0]?.contratado ?? 0);
	const r = useMemo(() => resumoRobos(linhas, teto), [linhas, teto]);
	const semSql101 = divisao.length > 0 && !('motivo' in divisao[0]);
	const [como, setComo] = useState(false);

	const ordenadas = useMemo(() => [...linhas].sort((a, b) =>
		Number(comLicenca(b)) - Number(comLicenca(a)) || (b.licencas ?? 0) - (a.licencas ?? 0) || b.canais - a.canais
		|| nomeEmpresa(a.empresa_id).localeCompare(nomeEmpresa(b.empresa_id), 'pt-BR')), [linhas, nomeEmpresa]);

	const estado = r.estado === 'over' ? <Pilula tom="erro">Overbooking</Pilula>
		: r.estado === 'quase' ? <Pilula tom="atencao">Quase no teto</Pilula> : <Pilula tom="ok">Dentro do teto</Pilula>;

	return (
		<Cartao semPad titulo="Robôs vendidos × teto contratado"
			desc="1 robô = 1 conversa ao mesmo tempo com a IA. O teto é o contrato com o provedor de voz; as licenças de cada empresa disputam esse teto, e quem não tem licença fica só com a sobra."
			acoes={<>{estado}<button type="button" onClick={() => setComo(true)} className={btnLink}>Como dividimos</button></>}>
			<div className="space-y-4 px-5 pb-5 sm:px-6">
				{semSql101 && <Aviso tom="atencao" titulo="Falta o SQL 101 no banco.">A divisão ainda é a antiga (pelos canais, sem as licenças). Rode o APLICAR_SQL101.sql.</Aviso>}
				<Kpis itens={[
					{ rotulo: 'Teto contratado com o provedor', valor: inteiro(r.teto), detalhe: 'conversas ao mesmo tempo' },
					{ rotulo: 'Robôs vendidos', valor: inteiro(r.vendidos), detalhe: r.teto > 0 ? `${inteiro(r.pct)}% do teto` : 'sem teto definido', tom: r.estado === 'over' ? 'alerta' : r.estado === 'quase' ? 'atencao' : undefined },
					{ rotulo: 'Usáveis', valor: inteiro(r.usaveis), detalhe: 'licenças cortadas pelos canais: o que disputa o teto', tom: r.usaveis > r.teto ? 'alerta' : undefined },
					{ rotulo: 'Sobra para quem não tem licença', valor: inteiro(r.sobra), detalhe: `${inteiro(r.semLicenca)} ${r.semLicenca === 1 ? 'empresa' : 'empresas'} no modelo antigo` },
				]} />
				<BarraTeto linhas={ordenadas.filter(comLicenca)} teto={r.teto} nomeEmpresa={nomeEmpresa} />
				{r.estado === 'over' ? (
					<Aviso tom="erro" titulo={`Vendido ${inteiro(r.vendidos)} para um teto de ${inteiro(r.teto)} (${inteiro(r.pct)}%).`}>
						{r.usaveis > r.teto
							? 'Quando todas usam ao mesmo tempo, o limite de cada empresa cai proporcionalmente e quem não tem licença para de discar.'
							: `Por enquanto os canais seguram o uso real em ${inteiro(r.usaveis)}, mas basta um cliente ampliar o tronco para faltar.`}
						{' '}Amplie o contrato com o provedor para pelo menos <b>{inteiro(r.vendidos)}</b>.
					</Aviso>
				) : r.estado === 'quase' ? (
					<Aviso tom="atencao">Faltam {inteiro(r.teto - r.vendidos)} robôs para o teto. Antes de vender mais, amplie o contrato com o provedor.</Aviso>
				) : null}
				<EditarTeto atual={teto} vendidos={r.vendidos} podeTroncos={podeTroncos} atualizadoEm={contrato?.atualizado_em} onSalvo={onSalvo} />
			</div>
			<div className="border-t border-[var(--base-borda)] pt-4">
				<p className="px-5 pb-2 text-[13px] text-[var(--base-texto-2)] sm:px-6">Por empresa. Limite real = o menor entre licenças, canais do tronco e a parte do teto global.</p>
				{loading ? <p className="py-4 text-center text-[13px] text-[var(--base-texto-3)]">Carregando...</p> : (
					<Tabela<LinhaDivisao> rotulo="Robôs por empresa" linhas={ordenadas} chave={l => l.empresa_id} onAbrir={l => onEscolher(String(l.empresa_id))}
						vazio="Nenhuma empresa com tronco ativo ou licença ainda."
						colunas={[
							{ id: 'emp', titulo: 'Empresa', celula: l => nomeEmpresa(l.empresa_id) },
							{ id: 'lic', titulo: 'Licenças', num: true, celula: l => l.licencas == null ? '—' : inteiro(l.licencas) },
							{ id: 'can', titulo: 'Canais', num: true, celula: l => inteiro(l.canais) },
							{ id: 'lim', titulo: 'Limite real', num: true, celula: l => <b>{inteiro(l.limite)}</b> },
							{ id: 'pq', titulo: 'Por quê', celula: l => <PorQue l={l} /> },
						]}
						celular={l => ({ titulo: nomeEmpresa(l.empresa_id), valor: `${inteiro(l.limite)} ao mesmo tempo`, resumo: <PorQue l={l} /> })}
						rodape={<><span>Total</span><span className="tnum">{inteiro(r.vendidos)} vendidos · limite {inteiro(r.limiteTotal)} de {inteiro(r.teto)}</span></>} />
				)}
			</div>
			<Gaveta aberta={como} onFechar={() => setComo(false)} titulo="Como dividimos o teto">
				<div className="space-y-3 text-[13px] leading-relaxed text-[var(--base-texto-2)]">
					<p><b className="text-[var(--base-texto)]">Quem tem licença primeiro.</b> Cada empresa disputa o teto com os robôs que pode usar: o menor entre as licenças e os canais dos troncos ativos. Se a soma cabe no teto, cada uma fica com o que pode usar.</p>
					<p><b className="text-[var(--base-texto)]">Overbooking.</b> Se a soma passa do teto, o teto é dividido na proporção do que cada uma pode usar. A sobra do arredondamento vai para as maiores frações (empate: quem tem mais robôs usáveis).</p>
					<p><b className="text-[var(--base-texto)]">Sem licença (transição).</b> Divide só o que sobra do teto, pelos canais do tronco, como antes. Sem sobra, não disca. Quem tem licença não tem pico; o pico fica só para quem não tem.</p>
					<p>O cliente vê os robôs dele, os disponíveis e o motivo, nunca o teto global: para ele, o corte do teto aparece como &quot;limite temporário da plataforma&quot;.</p>
				</div>
				<div className="mt-4">
					<Trava icone={<Phone size={16} />} titulo="O limite conta conversas com a IA, não linhas tocando: cada número só é discado com um robô reservado para ele.">
						Sem robô livre, o número espera na lista do dia e não é discado; quem já está conversando nunca cai quando o limite muda (vale para as conversas novas). Se mesmo com a reserva a IA não abrir a conversa (falha do provedor), a pessoa ouve uma mensagem curta e neutra antes de a ligação acabar.
					</Trava>
				</div>
			</Gaveta>
		</Cartao>
	);
}

function PorQue({ l }: { l: LinhaDivisao }) {
	return (
		<span className="block min-w-0">
			<Pilula tom={TOM_MOTIVO[l.motivo]}>{ROTULO_MOTIVO[l.motivo]}</Pilula>
			<span className="mt-1 block text-[12.5px] text-[var(--base-texto-2)]">{porQueEquipe(l)}</span>
		</span>
	);
}

/** Barra empilhada das licenças de cada empresa, com o marco do teto. */
function BarraTeto({ linhas, teto, nomeEmpresa }: { linhas: LinhaDivisao[]; teto: number; nomeEmpresa: (id: unknown) => string }) {
	const vendidos = linhas.reduce((t, l) => t + (l.licencas ?? 0), 0);
	if (vendidos === 0) return <p className="text-[13px] text-[var(--base-texto-2)]">Nenhum robô vendido ainda: todas as empresas seguem no modelo antigo (a divisão do teto pelos canais).</p>;
	const max = Math.max(vendidos, teto, 1) * 1.08;
	const visiveis = linhas.slice(0, CORES.length);
	const outras = linhas.slice(CORES.length).reduce((t, l) => t + (l.licencas ?? 0), 0);
	const partes = [...visiveis.map((l, i) => ({ nome: nomeEmpresa(l.empresa_id), n: l.licencas ?? 0, cor: CORES[i] })),
		...(outras > 0 ? [{ nome: `Outras ${linhas.length - visiveis.length}`, n: outras, cor: COR_OUTRAS }] : [])];
	const marco = (100 * teto) / max;
	return (
		<div>
			<div className="relative pb-5 pt-2">
				<div role="img" aria-label={`Robôs vendidos por empresa: ${vendidos}, comparados ao teto de ${teto}`} className="flex h-[22px] overflow-hidden rounded-[7px] bg-[var(--base-fill)]">
					{partes.map(p => <i key={p.nome} title={`${p.nome}: ${p.n}`} className="block h-full border-r-2 border-[var(--base-cartao)]" style={{ width: `${(100 * p.n) / max}%`, backgroundColor: p.cor }} />)}
				</div>
				<span aria-hidden="true" className="absolute bottom-4 top-0.5 w-0.5 bg-[var(--base-texto)]" style={{ left: `${marco}%` }} />
				<span aria-hidden="true" className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-semibold text-[var(--base-texto)]" style={{ left: `${Math.min(Math.max(marco, 6), 94)}%` }}>teto {inteiro(teto)}</span>
			</div>
			<ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--base-texto-2)]">
				{partes.map(p => <li key={p.nome} className="flex items-center gap-1.5"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.cor }} />{p.nome} · {inteiro(p.n)}</li>)}
			</ul>
		</div>
	);
}

function EditarTeto({ atual, vendidos, podeTroncos, atualizadoEm, onSalvo }: {
	atual: number; vendidos: number; podeTroncos: boolean; atualizadoEm: unknown; onSalvo: () => void;
}) {
	const [valor, setValor] = useState(String(atual));
	const [busy, setBusy] = useState(false);
	const [confirmar, setConfirmar] = useState(false);
	useEffect(() => { setValor(String(atual)); }, [atual]);
	const n = Number(valor);
	const valido = valor !== '' && Number.isInteger(n) && n >= 0 && n <= 1000000;
	const mudou = valido && n !== atual;
	const abaixo = valido && n < vendidos;

	async function salvar() {
		if (!supabase || !mudou) return;
		setBusy(true);
		const { error } = await supabase.rpc('definir_concorrencia_contratada', { n });
		setBusy(false);
		setConfirmar(false);
		if (error) { toast.error(erroRpc(error)); return; }
		toast.success(abaixo ? 'Teto salvo abaixo dos robôs vendidos. A equipe foi avisada no sino.' : 'Teto salvo. A divisão entre as empresas foi refeita.');
		onSalvo();
	}

	return (
		<div>
			<div className="flex flex-wrap items-end gap-3">
				<div className="w-full max-w-[380px]">
					<label htmlFor="voz-teto" className="mb-1 block text-[13px] font-semibold text-[var(--base-texto)]">Teto contratado com o provedor (ao mesmo tempo)</label>
					<input id="voz-teto" value={valor} inputMode="numeric" disabled={!podeTroncos} aria-describedby="voz-teto-ajuda"
						onChange={e => setValor(e.target.value.replace(/\D/g, ''))} className={`${campoCls} tnum`} />
				</div>
				{podeTroncos ? (
					<button type="button" onClick={() => abaixo ? setConfirmar(true) : void salvar()} disabled={!mudou || busy} className={btnPrim}>{busy ? 'Salvando...' : 'Salvar teto'}</button>
				) : <Cadeado>Só a equipe com a permissão de troncos de voz</Cadeado>}
			</div>
			<p id="voz-teto-ajuda" className="mt-1.5 text-[12px] text-[var(--base-texto-3)]">
				A divisão é refeita na hora e a VM aplica na próxima leitura. Baixar abaixo dos robôs vendidos pede confirmação.{atualizadoEm ? ` Última mudança: ${dateTimeBR(atualizadoEm)}.` : ''}
			</p>
			{confirmar && (
				<Dialogo titulo="Teto abaixo dos robôs vendidos" onClose={() => setConfirmar(false)}
					texto={<>O teto passa a <b>{inteiro(n)}</b> para <b>{inteiro(vendidos)}</b> robôs vendidos. Nos horários em que todas usam juntas, o limite de cada empresa cai proporcionalmente e quem não tem licença para de discar. Quem já está conversando não cai. A equipe é avisada no sino.</>}
					acoes={<>
						<button type="button" onClick={() => setConfirmar(false)} className={btnSec}>Voltar</button>
						<button type="button" onClick={() => void salvar()} disabled={busy} className={btnPrim}>{busy ? 'Salvando...' : 'Salvar mesmo assim'}</button>
					</>} />
			)}
		</div>
	);
}
