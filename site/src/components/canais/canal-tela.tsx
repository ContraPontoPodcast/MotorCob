// Cobrança › Configurações › Canais › (canal): a tela do canal (SPEC Canais §1.1, §3.2, §4.2, §4.3 e §5; PRs 6 e 7;
// protótipo aprovado em 08/11). No topo o estado (estado_canais, SQL 84), a última atividade, 4 números, o problema +
// "o que fazer" e Pausar / Retomar (com "Pausado desde", SQL 86). Embaixo, as seções do canal, fechadas com um resumo de
// uma frase; "Editar" abre só aquela e "Salvar <seção>" grava só os campos dela. "Configuração de:" Empresa ou uma
// carteira, com a herança "da empresa" / "desta carteira · voltar ao da empresa".
// PR 7: as regras de retorno da carteira, o mapeamento do retorno do fornecedor, o centro de custo da Lista do dia e o
// RCS sem aparelho aparecem aqui; continuam também em Carteiras › Configurações › Canais e em Mensageria › Configurações
// por 1 ciclo (SPEC §8, pergunta 6). Editar = editar_canais (retorno e mapeamento: editar_credores, como na carteira);
// sem a permissão, a tela é só leitura. Só tokens do tema: vale no claro e no escuro.
// PR 9 (SQL 116): "Testar agora" do Agente de voz do MotorCX liga de verdade para um número de teste (testar-agora.tsx);
// nos canais de mensagem, o botão segue "em breve".
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { PageHeading, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, Botao, Estado, Kpis, LinkTexto, Modal, Pilula, Rotulo, SOMBRA, campoCls, campoStyle } from '@/components/ds';
import { PilulaEstado } from '@/components/canais/visao-geral';
import { TestarAgoraVoz } from '@/components/canais/testar-agora';
import { FrasesTab } from '@/components/canais/frases';
import { MapeamentoColunas, RegrasCanal, TabelaCodigos, type CanalCodigo, type MapeamentoCanal } from '@/components/credores/aba-canais';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { friendlyError, moneyBR, supabase, type Row } from '@/lib/supabase';
import { PERM } from '@/lib/permissoes';
import { ROTA_DISCAGEM, ROTA_VOZ } from '@/lib/rotas-voz';
import { lerCusto, naoPerturbeParaTela, QUEM_ENVIA_CANAIS, VOZ, type CanalTela as LinhaCanal } from '@/lib/canais-config';
import { limparRegrasCredor, regrasMudou, type RegrasRetorno } from '@/lib/canal-retorno';
import { numerosPorClienteOpts } from '@/lib/operacao';
import { canalTipoMensagem } from '@/lib/frases';
import {
	acaoDe, dia, ESTADOS, identidade, instante, linhasAtividade, quemTexto, valorSinal,
	type CanalEstado, type CanalTelaId, type EstadoCanais, type QuemExecuta, type Trecho,
} from '@/lib/estado-canais';
import {
	ajustesCarteiraSecao, CAMPOS_SECAO, canalRetorno, lerLinha, linhaEmpresaSecao, nomeCanal, quemExecuta,
	resumoCustos, resumoEnvio, resumoLista, resumoRetorno, rotuloAbrir, SECOES, secoesDoCanal, tipoRetorno, type SecaoId,
} from '@/lib/canal-tela';

type MsgConfig = {
	modo: string | null; centro_custo_id: string | null; rcs_fallback: string; rcs_fallback_template_id: string | null;
	rcs_agente: string | null; aprovar_lotes: boolean | null;
};

const PERM_ENVIAR_MENSAGENS = 'enviar_mensagens';

// ------------------------------------------------------------------ peças
function Linha({ trechos }: { trechos: Trecho[] }) {
	return <span>{trechos.map((x, i) => x.b ? <b key={i} className="font-medium text-[var(--base-texto)]">{x.t}</b> : <span key={i}>{x.t}</span>)}</span>;
}

/** "da empresa" / "desta carteira · voltar ao da empresa" embaixo do campo, só na carteira. */
function Heranca({ carteira, sobrescrito, onVoltar, pode }: { carteira: boolean; sobrescrito: boolean; onVoltar: () => void; pode: boolean }) {
	if (!carteira) return null;
	if (!sobrescrito) return <small className="text-[11px] font-normal text-[var(--base-texto-3)]" data-heranca="empresa">da empresa</small>;
	return (
		<small className="text-[11px] font-normal text-[var(--estado-info)]" data-heranca="carteira">
			desta carteira{pode && <> · <button type="button" onClick={onVoltar} className="underline hover:text-[var(--base-texto)]">voltar ao da empresa</button></>}
		</small>
	);
}

/** Seção fechada com o resumo; aberta mostra o corpo. Número à esquerda, como no protótipo. */
function Secao({ n, id, resumo, aberta, onAlternar, rotulo, children }: {
	n: number; id: SecaoId; resumo: ReactNode; aberta: boolean; onAlternar: () => void; rotulo: string; children: ReactNode;
}) {
	return (
		<section aria-label={SECOES[id].titulo} data-secao={id} className="min-w-0 rounded-2xl bg-[var(--base-cartao)]" style={{ boxShadow: SOMBRA }}>
			<header className="flex items-start gap-3 px-4 py-4 sm:px-5">
				<span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[var(--base-fill)] text-[12px] font-bold text-[var(--base-texto-2)]">{n}</span>
				<div className="min-w-0 flex-1">
					<h2 className="text-[15px] font-semibold text-[var(--base-texto)]">{SECOES[id].titulo}</h2>
					<p className="mt-0.5 text-[13px] leading-relaxed text-[var(--base-texto-2)]">{aberta ? SECOES[id].descricao : resumo}</p>
				</div>
				<Botao tipo="secundario" pequeno onClick={onAlternar} expandido={aberta}>{aberta ? 'Fechar' : rotulo}</Botao>
			</header>
			{aberta && <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>}
		</section>
	);
}

function Rodape({ onCancelar, onSalvar, salvando, rotulo }: { onCancelar: () => void; onSalvar: () => void; salvando: boolean; rotulo: string }) {
	return (
		<div className="mt-4 flex flex-wrap justify-end gap-2">
			<Botao tipo="secundario" pequeno onClick={onCancelar}>Cancelar</Botao>
			<Botao pequeno onClick={onSalvar} disabled={salvando}>{salvando ? 'Salvando…' : rotulo}</Botao>
		</div>
	);
}

const grade = 'grid gap-3 sm:grid-cols-2';

/** Seletor da carteira dentro de Retorno e Lista quando a tela está em "Empresa" (o que eles guardam é por carteira). */
function CarteiraDaSecao({ valor, onTrocar, carteiras, fixa }: { valor: string; onTrocar: (v: string) => void; carteiras: { id: string; nome: string }[]; fixa: boolean }) {
	if (fixa) return null;
	return (
		<div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--base-texto-2)]">
			<label htmlFor="carteira-secao">Vale por carteira. Carteira:</label>
			<select id="carteira-secao" value={valor} onChange={e => onTrocar(e.target.value)} className={campoCls} style={campoStyle}>
				{carteiras.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
			</select>
		</div>
	);
}

// ------------------------------------------------------------------ tela
export function CanalTela({ canal }: { canal: CanalTelaId }) {
	const { empresa, credores, perfil } = useMotorAuth();
	const areas = useAreasLiberadas();
	const podeCanais = usePermissao(PERM.editarCanais);
	const podeCredores = usePermissao(PERM.editarCredores);
	const podeLotes = usePermissao(PERM_ENVIAR_MENSAGENS);
	const verEstado = podeCanais || !!perfil?.equipe;
	const carteiras = useMemo(() => credores.filter(c => c.ativo).map(c => ({ id: String(c.id), nome: c.nome })), [credores]);

	const [escopo, setEscopo] = useState('empresa');
	const carteira = escopo !== 'empresa';
	const [credorSecao, setCredorSecao] = useState('');
	const credorRet = carteira ? escopo : (credorSecao || carteiras[0]?.id || '');

	const [estado, setEstado] = useState<EstadoCanais | null>(null);
	const [erroEstado, setErroEstado] = useState('');
	const [lendoEstado, setLendoEstado] = useState(false);
	const [empRow, setEmpRow] = useState<Row | null>(null);
	const [cartRow, setCartRow] = useState<Row | null>(null);
	const [carregando, setCarregando] = useState(true);
	const [erro, setErro] = useState('');
	const [msg, setMsg] = useState<MsgConfig | null>(null);
	const [centros, setCentros] = useState<{ id: string; nome: string }[]>([]);
	const [nFrases, setNFrases] = useState<number | null>(null);
	const [aberta, setAberta] = useState<SecaoId | null>(null);
	const [pausar, setPausar] = useState(false);
	const [testar, setTestar] = useState(false);
	const [mudandoPausa, setMudandoPausa] = useState(false);
	const [retorno, setRetorno] = useState<{ regras: Record<string, RegrasRetorno> | null; mapeamento: MapeamentoCanal | null; codigos: CanalCodigo[] } | null>(null);

	const id = identidade(canal, VOZ.has(canal) ? (areas.agenteVoz ? 'voz_motorcx' : 'lista') : undefined);
	const linhaEmp = useMemo(() => lerLinha(canal, empRow), [canal, empRow]);
	const linhaCart = useMemo(() => lerLinha(canal, cartRow ?? empRow), [canal, cartRow, empRow]);
	const sobCart = useMemo(() => (Array.isArray(cartRow?.sobrescritos) ? (cartRow!.sobrescritos as string[]) : []), [cartRow]);
	const quem: QuemExecuta = quemExecuta(canal, empRow?.quem_envia as string | null, areas.canais, areas.agenteVoz);
	const secoes = secoesDoCanal(canal, quem, carteira);
	const est: CanalEstado | null = estado?.canais.find(c => c.canal === canal) ?? null;
	const hoje = estado?.hoje ?? new Date().toISOString().slice(0, 10);
	const pausado = est ? est.estado === 'pausado' : linhaEmp.ativo === false;
	// PR 9 do plano (SQL 116): "Testar agora" liga de verdade, só no Agente de voz do MotorCX
	const testaVoz = canal === 'agente_voz' && quem === 'voz_motorcx';

	const lerEstado = useCallback(async () => {
		if (!supabase || !empresa || !verEstado) return;
		setLendoEstado(true); setErroEstado('');
		const { data, error } = await supabase.rpc('estado_canais', { empresa: Number(empresa.id) });
		if (error) { setErroEstado(friendlyError(error)); setEstado(null); } else setEstado(data as EstadoCanais);
		setLendoEstado(false);
	}, [empresa?.id, verEstado]);

	const lerLinhas = useCallback(async () => {
		const sb = supabase;
		if (!sb || !empresa) { setCarregando(false); return; }
		setErro('');
		const emp = await sb.from('canais_empresa').select('*').eq('empresa_id', empresa.id).eq('canal', canal).maybeSingle();
		if (emp.error) { setErro(friendlyError(emp.error)); setCarregando(false); return; }
		setEmpRow((emp.data as Row | null) ?? null);
		if (escopo !== 'empresa') {
			const cr = await sb.from('canais_credor').select('*').eq('empresa_id', empresa.id).eq('credor_id', escopo).eq('canal', canal).maybeSingle();
			if (cr.error) setErro(friendlyError(cr.error));
			setCartRow((cr.data as Row | null) ?? null);
		} else setCartRow(null);
		setCarregando(false);
	}, [empresa?.id, canal, escopo]);

	const lerMensageria = useCallback(async () => {
		const sb = supabase;
		if (!sb || !empresa) return;
		const [cfg, cc, fr] = await Promise.all([
			sb.from('mensageria_config').select('*').eq('empresa_id', empresa.id).maybeSingle(),
			sb.from('mensageria_centros_custo').select('id,nome').eq('empresa_id', empresa.id).order('nome'),
			sb.from('frases').select('id').eq('empresa_id', empresa.id).eq('canal', canal).eq('ativo', true),
		]);
		const c = cfg.data as Row | null;
		setMsg(c ? {
			modo: (c.modo as string) ?? null, centro_custo_id: c.centro_custo_id != null ? String(c.centro_custo_id) : null,
			rcs_fallback: (c.rcs_fallback as string) ?? 'sms', rcs_fallback_template_id: c.rcs_fallback_template_id != null ? String(c.rcs_fallback_template_id) : null,
			rcs_agente: (c.rcs_agente as string) ?? null, aprovar_lotes: c.aprovar_lotes == null ? null : !!c.aprovar_lotes,
		} : null);
		setCentros(((cc.data ?? []) as Row[]).map(r => ({ id: String(r.id), nome: String(r.nome) })));
		setNFrases(fr.error ? null : (fr.data ?? []).length);
	}, [empresa?.id, canal]);

	const lerRetorno = useCallback(async () => {
		const sb = supabase;
		if (!sb || !empresa || !credorRet) { setRetorno(null); return; }
		const [cr, mp, cod] = await Promise.all([
			sb.from('credores').select('id,regras_retorno').eq('id', credorRet).maybeSingle(),
			sb.from('mapeamento_arquivos').select('*').eq('credor_id', credorRet).eq('tipo', tipoRetorno(canal)).maybeSingle(),
			sb.from('canal_codigos').select('*').eq('credor_id', credorRet).eq('canal', canalRetorno(canal)),
		]);
		setRetorno({
			regras: ((cr.data as Row | null)?.regras_retorno as Record<string, RegrasRetorno> | null) ?? null,
			mapeamento: (mp.data as MapeamentoCanal | null) ?? null,
			codigos: (cod.data ?? []) as CanalCodigo[],
		});
	}, [empresa?.id, credorRet, canal]);

	useEffect(() => { void lerEstado(); }, [lerEstado]);
	useEffect(() => { void lerLinhas(); }, [lerLinhas]);
	useEffect(() => { void lerMensageria(); }, [lerMensageria]);
	useEffect(() => { void lerRetorno(); }, [lerRetorno]);
	useEffect(() => { setAberta(null); }, [escopo]);

	async function mudarPausa(ativo: boolean) {
		if (!supabase || !empresa) return;
		setMudandoPausa(true);
		const { error } = await supabase.from('canais_empresa').upsert({ empresa_id: empresa.id, canal, ativo }, { onConflict: 'empresa_id,canal' });
		setMudandoPausa(false); setPausar(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(ativo ? `${nomeCanal(canal)} retomado.` : `${nomeCanal(canal)} pausado.`);
		await Promise.all([lerLinhas(), lerEstado()]);
	}

	const salvou = useCallback(async (oque: string) => {
		toast.success(`${oque} salvo.`);
		setAberta(null);
		await Promise.all([lerLinhas(), lerEstado(), lerMensageria()]);
	}, [lerLinhas, lerEstado, lerMensageria]);

	const cabecalho = (
		<PageHeading title={id.nome} description={quemTexto(canal, quem)}
			titleExtra={<span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] text-[11px] font-bold text-white" style={{ backgroundColor: id.cor }}>{id.sigla}</span>} />
	);
	if (!empresa) return <>{cabecalho}<Estado tipo="vazio" titulo="Escolha a empresa no topo para ver o canal." /></>;
	if (carregando || !areas.pronto) return <>{cabecalho}<Estado tipo="carregando" /></>;

	const centroNome = centros.find(c => c.id === msg?.centro_custo_id)?.nome ?? null;
	const motorcxDigital = quem === 'motorcx' && !VOZ.has(canal);
	const sinalDe = (k: string) => est?.sinais.find(s => s.chave === k);
	const ultimaLista = sinalDe('ultima_lista');
	const pausadoDesde = (empRow?.pausado_em as string | null | undefined) ?? (linhaEmp.ativo === false ? (empRow?.atualizado_em as string | null) : null);

	// ---------------------------------------------------------------- topo: estado
	const atividade = est ? linhasAtividade(est, hoje) : null;
	const tomProblema = est ? ESTADOS[est.estado].tom : 'neutro';
	const acao = est ? acaoDe(est.acao, canal) : null;
	const topo = (
		<section aria-label="Estado do canal" className="flex min-w-0 flex-col gap-3.5 rounded-2xl bg-[var(--base-cartao)] p-4 sm:p-5" style={{ boxShadow: SOMBRA }}>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				{est ? <PilulaEstado estado={est.estado} /> : pausado ? <PilulaEstado estado="pausado" /> : null}
				<span className="min-w-0 flex-[1_1_220px] text-[13px] text-[var(--base-texto-2)]">
					{atividade ? <Linha trechos={atividade[0]} /> : pausado ? <>Pausado desde <b className="font-medium text-[var(--base-texto)]">{dia(pausadoDesde?.slice(0, 10), hoje)}</b>.</> : null}
				</span>
				<span className="flex flex-wrap gap-2">
					{testaVoz ? (
						<Botao tipo="secundario" onClick={() => setTestar(true)} disabled={!podeCanais} title={podeCanais ? undefined : 'Testar gasta uma ligação de verdade: precisa da permissão de editar canais.'}>Testar agora</Botao>
					) : (
						<span className="inline-flex items-center gap-1.5" title="O teste dos canais de mensagem chega depois (precisa dos números de teste confirmados por código).">
							<Botao tipo="secundario" disabled>Testar agora</Botao>
							<Pilula tom="neutro">em breve</Pilula>
						</span>
					)}
					{podeCanais && (pausado
						? <Botao onClick={() => void mudarPausa(true)} disabled={mudandoPausa}><Play size={14} aria-hidden /> Retomar</Botao>
						: <Botao tipo="secundario" onClick={() => setPausar(true)} disabled={mudandoPausa}><Pause size={14} aria-hidden /> Pausar</Botao>)}
				</span>
			</div>
			{est && est.estado !== 'funcionando' && est.problema && (
				<Aviso tom={tomProblema === 'neutro' ? 'neutro' : tomProblema} titulo={est.problema}
					acao={acao && est.acao !== 'retomar' ? <Link to={acao.to} className="whitespace-nowrap text-[13px] font-semibold text-[var(--destaque)] hover:underline">{acao.rotulo}</Link> : undefined}>
					{est.o_que_fazer && <><br /><span className="text-[var(--base-texto-2)]">O que fazer: {est.o_que_fazer}</span></>}
				</Aviso>
			)}
			{est && est.sinais.length > 0 && (
				<Kpis itens={est.sinais.slice(0, 4).map(s => ({ rotulo: s.rotulo, valor: valorSinal(s, hoje), detalhe: s.detalhe ?? undefined, tom: s.ruim ? 'alerta' as const : undefined }))} />
			)}
			{!verEstado && <p className="text-[12.5px] text-[var(--base-texto-3)]">O estado e os números do canal aparecem para quem tem a permissão Editar canais e frases.</p>}
			{verEstado && !est && (
				<Aviso tom="neutro" titulo={lendoEstado ? 'Lendo o estado do canal…' : 'Não deu para ler o estado do canal agora.'}
					acao={!lendoEstado ? <Botao tipo="secundario" pequeno onClick={() => void lerEstado()}><RefreshCw size={13} aria-hidden /> Tentar de novo</Botao> : undefined}>
					{!lendoEstado && <>A configuração continua abaixo. {erroEstado}</>}
				</Aviso>
			)}
		</section>
	);

	// ---------------------------------------------------------------- seções
	const props = { canal, carteira, escopo, empresaId: String(empresa.id), quem, onSalvo: salvou, onCancelar: () => setAberta(null) };
	const resumos: Record<SecaoId, ReactNode> = {
		envio: resumoEnvio(canal, carteira ? linhaCart : linhaEmp, { carteira, quem, aprovarLotes: motorcxDigital ? (msg?.aprovar_lotes ?? true) : null }),
		mensagens: canal === 'agente_voz' && quem === 'voz_motorcx'
			? `A conversa do agente vem do fluxo da carteira (Agente Voz/CX › Agente de voz). Frases de abertura: ${nFrases ?? '—'} ativas.`
			: canal === 'email' ? 'O texto do e-mail é o modelo da Mensageria.'
				: `${nFrases ?? '—'} ${canalTipoMensagem(canal) === 'template' ? 'modelos ativos' : 'frases ativas'}${canal === 'rcs' ? ` · sem RCS no aparelho: ${msg?.rcs_fallback === 'whatsapp' ? 'enviar por WhatsApp' : msg?.rcs_fallback === 'nenhum' ? 'não enviar' : 'enviar por SMS'}` : ''}`,
		lista: resumoLista({
			ultimaLista: ultimaLista?.valor ? `${dia(String(ultimaLista.valor), hoje)}${ultimaLista.detalhe ? ` (${ultimaLista.detalhe})` : ''}` : null,
			mapeado: retorno?.mapeamento ? !!retorno.mapeamento.confirmado : null,
			semMapear: (retorno?.codigos ?? []).filter(c => !c.mapeado).length,
		}) + (!carteira && carteiras.length > 1 ? ` · em ${carteiras.find(c => c.id === credorRet)?.nome ?? ''}` : ''),
		retorno: credorRet
			? resumoRetorno(canal, retorno?.regras?.[canalRetorno(canal)]) + (!carteira && carteiras.length > 1 ? ` · em ${carteiras.find(c => c.id === credorRet)?.nome ?? ''}` : '')
			: 'Vale por carteira: nenhuma carteira ativa ainda.',
		custos: resumoCustos(carteira ? linhaCart : linhaEmp, { carteira, centro: motorcxDigital && !carteira ? centroNome : undefined }),
		conexao: canal === 'rcs'
			? `Agente RCS: ${msg?.rcs_agente === 'conversacional' ? 'conversacional' : 'não conversacional'} · modo: ${msg?.modo === 'real' ? 'envio real' : 'simulação'}`
			: `Fornecedor e rota: definidos pela equipe MotorCX · modo: ${msg?.modo === 'real' ? 'envio real' : 'simulação'}`,
	};

	function corpo(s: SecaoId) {
		switch (s) {
			case 'envio': return <SecaoEnvio {...props} salvo={carteira ? linhaCart : linhaEmp} sobSalvos={sobCart} daEmpresa={linhaEmp} pode={podeCanais}
				msg={msg} podeLotes={podeLotes} canaisMensageria={areas.canais} />;
			case 'custos': return <SecaoCustos {...props} salvo={carteira ? linhaCart : linhaEmp} sobSalvos={sobCart} daEmpresa={linhaEmp} pode={podeCanais}
				msg={msg} centros={motorcxDigital ? centros : null} />;
			case 'mensagens': return <SecaoMensagens {...props} pode={podeCanais} msg={msg} />;
			case 'retorno': return (<>
				<CarteiraDaSecao valor={credorRet} onTrocar={setCredorSecao} carteiras={carteiras} fixa={carteira} />
				{credorRet ? <SecaoRetorno {...props} credorId={credorRet} regras={retorno?.regras ?? null} pode={podeCredores} onRecarregar={lerRetorno} />
					: <p className="text-[13px] text-[var(--base-texto-2)]">Crie uma carteira em <Link to="/credores" className="font-semibold underline">Carteiras</Link> para definir o retorno.</p>}
			</>);
			case 'lista': return (<>
				<CarteiraDaSecao valor={credorRet} onTrocar={setCredorSecao} carteiras={carteiras} fixa={carteira} />
				<SecaoLista canal={canal} hoje={hoje} est={est} retorno={retorno} pode={podeCredores} onRecarregar={lerRetorno} />
			</>);
			case 'conexao': return <SecaoConexao canal={canal} msg={msg} equipe={!!perfil?.equipe} />;
		}
	}

	return (
		<>
			{cabecalho}
			{topo}
			{VOZ.has(canal) && quem === 'voz_motorcx' && (
				<div className="mt-3.5"><Aviso tom="info">Quem liga neste canal é a <b className="font-semibold">Voz MotorCX</b>. Aqui ficam só o horário, os limites e o custo do canal. Fluxos, regras de discagem e ligações em curso ficam em <Link to={ROTA_VOZ} className="font-semibold underline">Agente Voz/CX</Link>.</Aviso></div>
			)}
			{VOZ.has(canal) && quem === 'lista' && (
				<div className="mt-3.5"><Aviso tom="info">Quem liga é o {canal === 'discador' ? 'discador' : 'AGV'} da sua empresa. O MotorCX monta a lista do dia (quem, qual número e quantas vezes, pelas regras de <Link to={ROTA_DISCAGEM} className="font-semibold underline">Agente Voz/CX › Discagem</Link>) e lê o retorno.</Aviso></div>
			)}
			{erro && <div className="mt-3.5"><Aviso tom="erro">{erro}</Aviso></div>}
			{!podeCanais && <div className="mt-3.5"><Aviso tom="neutro">Só leitura: quem muda os canais tem a permissão Editar canais e frases (o Admin da empresa dá o acesso em Pessoas e perfis).</Aviso></div>}

			<div className="mb-4 mt-5 flex flex-wrap items-center gap-2 text-[13px] text-[var(--base-texto-2)]">
				<label htmlFor="escopo-canal">Configuração de:</label>
				<select id="escopo-canal" value={escopo} onChange={e => setEscopo(e.target.value)} className={campoCls} style={campoStyle}>
					<option value="empresa">Empresa (todas as carteiras)</option>
					{carteiras.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
				</select>
				{carteira && <span className="min-w-0 rounded-xl bg-[var(--estado-info-fundo)] px-2.5 py-1 text-[12px] font-medium text-[var(--estado-info)]">a carteira herda da empresa; só o que for mudado aqui vale só para ela</span>}
			</div>

			<div className="grid gap-3">
				{secoes.map((s, i) => s === 'conexao' ? (
					<details key={s} data-secao="conexao" className="group min-w-0 rounded-2xl bg-[var(--base-cartao)]" style={{ boxShadow: SOMBRA }}>
						<summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
							<span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-[var(--base-fill)] text-[12px] font-bold text-[var(--base-texto-2)]">{i + 1}</span>
							<span className="min-w-0 flex-1">
								<span className="block text-[15px] font-semibold text-[var(--base-texto)]">{SECOES.conexao.titulo}</span>
								<span className="mt-0.5 block text-[13px] text-[var(--base-texto-3)]">{resumos.conexao}</span>
							</span>
							<span aria-hidden className="text-[var(--base-texto-3)] transition-transform group-open:rotate-90">›</span>
						</summary>
						<div className="px-4 pb-4 sm:px-5 sm:pb-5">{corpo(s)}</div>
					</details>
				) : (
					<Secao key={s} n={i + 1} id={s} resumo={resumos[s]} aberta={aberta === s} onAlternar={() => setAberta(aberta === s ? null : s)}
						rotulo={(s === 'retorno' || s === 'lista' ? podeCredores : podeCanais) ? rotuloAbrir(s) : 'Ver'}>
						{corpo(s)}
					</Secao>
				))}
			</div>
			<p className="mt-4 text-[12.5px] text-[var(--base-texto-3)]">Toda mudança fica na Auditoria da empresa (quem, quando, antes e depois).</p>

			{testaVoz && <TestarAgoraVoz aberta={testar} onFechar={() => setTestar(false)} empresaId={Number(empresa.id)}
				credorId={carteira ? Number(escopo) : (carteiras[0] ? Number(carteiras[0].id) : null)} />}
			{pausar && (
				<Modal titulo={`Pausar o ${nomeCanal(canal)}?`} confirmar="Pausar" ocupado={mudandoPausa} onFechar={() => setPausar(false)} onConfirmar={() => void mudarPausa(false)}
					texto="Enquanto pausado, nenhuma estratégia usa este canal e ele sai da lista do dia (o substituto da régua entra no lugar). Retomar volta como estava." />
			)}
		</>
	);
}

// ------------------------------------------------------------------ seções
type PropsBase = { canal: string; carteira: boolean; escopo: string; empresaId: string; quem: QuemExecuta; onSalvo: (oque: string) => void | Promise<void>; onCancelar: () => void };

function useRascunho(salvo: LinhaCanal, sobSalvos: string[], daEmpresa: LinhaCanal) {
	const [r, setR] = useState<LinhaCanal>(salvo);
	const [sob, setSob] = useState<string[]>(sobSalvos);
	function mudar(p: Partial<LinhaCanal>) {
		setR(x => ({ ...x, ...p }));
		setSob(x => [...new Set([...x, ...Object.keys(p)])]);
	}
	// "voltar ao da empresa": o campo sai do ajuste da carteira e a tela mostra o valor da empresa
	function voltar(...campos: string[]) {
		setSob(x => x.filter(k => !campos.includes(k)));
		setR(x => ({ ...x, ...Object.fromEntries(campos.map(k => [k, daEmpresa[k as keyof LinhaCanal]])) }));
	}
	return { r, sob, mudar, voltar };
}

async function gravarCarteira(p: PropsBase, campos: readonly string[], salvo: LinhaCanal, sobSalvos: string[], r: LinhaCanal, sob: string[]) {
	if (!supabase) return 'Sem conexão.';
	const ajustes = ajustesCarteiraSecao(p.canal, campos, salvo, sobSalvos, r, sob);
	if (!Object.keys(ajustes).length && !sobSalvos.length) return null;
	const { error } = await supabase.from('credor_canais').upsert({ empresa_id: p.empresaId, credor_id: p.escopo, canal: p.canal, ajustes }, { onConflict: 'credor_id,canal' });
	return error ? friendlyError(error) : null;
}

function SecaoEnvio(p: PropsBase & { salvo: LinhaCanal; sobSalvos: string[]; daEmpresa: LinhaCanal; pode: boolean; msg: MsgConfig | null; podeLotes: boolean; canaisMensageria: string[] }) {
	const { r, sob, mudar, voltar } = useRascunho(p.salvo, p.sobSalvos, p.daEmpresa);
	const [aprovar, setAprovar] = useState<boolean>(p.msg?.aprovar_lotes ?? true);
	const [produtos, setProdutos] = useState<Row[]>([]);
	const [salvando, setSalvando] = useState(false);
	const [erro, setErro] = useState('');
	const voz = VOZ.has(p.canal);
	const motorcxDigital = p.quem === 'motorcx' && !voz;
	const dis = !p.pode;
	const h = (k: string, ...extra: string[]) => <Heranca carteira={p.carteira} sobrescrito={sob.includes(k)} onVoltar={() => voltar(k, ...extra)} pode={p.pode} />;

	useEffect(() => {
		const sb = supabase;
		if (!sb || !p.carteira) return;
		let vivo = true;
		void sb.rpc('produtos_liberados', { empresa: p.empresaId, canal: p.canal }).then(({ data }) => { if (vivo) setProdutos((data ?? []) as Row[]); });
		return () => { vivo = false; };
	}, [p.carteira, p.empresaId, p.canal]);

	async function salvar() {
		if (!supabase) return;
		setSalvando(true); setErro('');
		let e: string | null = null;
		if (p.carteira) e = await gravarCarteira(p, CAMPOS_SECAO.envio, p.salvo, p.sobSalvos, r, sob);
		else {
			const { error } = await supabase.from('canais_empresa').upsert(linhaEmpresaSecao(p.empresaId, p.canal, r, CAMPOS_SECAO.envio), { onConflict: 'empresa_id,canal' });
			if (error) e = friendlyError(error);
			else if (motorcxDigital && p.podeLotes && aprovar !== (p.msg?.aprovar_lotes ?? true)) {
				const { error: e2 } = await supabase.rpc('definir_aprovacao_lotes', { empresa: p.empresaId, aprovar });
				if (e2) e = friendlyError(e2);
			}
		}
		setSalvando(false);
		if (e) { setErro(e); return; }
		await p.onSalvo('Regras de envio');
	}

	return (
		<div>
			<div className={grade}>
				{p.carteira && (
					<Rotulo texto="Usar este canal nesta carteira">
						<select value={r.ativo ? 'sim' : 'nao'} disabled={dis} onChange={e => mudar({ ativo: e.target.value === 'sim' })} className={campoCls} style={campoStyle}>
							<option value="sim">Sim</option><option value="nao">Não usar nesta carteira</option>
						</select>
						{h('ativo')}
					</Rotulo>
				)}
				<Rotulo texto="Horário de segunda a sexta" dica={p.carteira ? undefined : 'Nunca passa do horário geral (08:00–20:00; sábado até 14:00).'}>
					<span className="flex items-center gap-2">
						<input type="time" aria-label="Início" value={r.janela_inicio ?? ''} disabled={dis} onChange={e => mudar({ janela_inicio: e.target.value })} className={`${campoCls} w-[132px]`} style={campoStyle} />
						<span className="text-[var(--base-texto-3)]">até</span>
						<input type="time" aria-label="Fim" value={r.janela_fim ?? ''} disabled={dis} onChange={e => mudar({ janela_fim: e.target.value })} className={`${campoCls} w-[132px]`} style={campoStyle} />
					</span>
					{p.carteira && <Heranca carteira sobrescrito={sob.includes('janela_inicio') || sob.includes('janela_fim')} onVoltar={() => voltar('janela_inicio', 'janela_fim')} pode={p.pode} />}
				</Rotulo>
				<Rotulo texto="Sábado">
					<select value={r.sabado ? 'sim' : 'nao'} disabled={dis} onChange={e => mudar({ sabado: e.target.value === 'sim' })} className={campoCls} style={campoStyle}>
						<option value="sim">Aciona no sábado (até 14:00)</option><option value="nao">Não aciona no sábado</option>
					</select>
					{h('sabado')}
				</Rotulo>
				{voz && (
					<Rotulo texto="Tentativas por dia" dica="Intervalos e renitência ficam em Agente Voz/CX › Discagem.">
						<input type="number" min={1} max={20} value={r.tentativas_dia ?? 3} disabled={dis} onChange={e => mudar({ tentativas_dia: Number(e.target.value) })} className={`${campoCls} w-[132px]`} style={campoStyle} />
						{h('tentativas_dia')}
					</Rotulo>
				)}
				<Rotulo texto="Respeitar Não Perturbe">
					<select value={r.respeitar_nao_perturbe ?? ''} disabled={dis} onChange={e => mudar({ respeitar_nao_perturbe: naoPerturbeParaTela(e.target.value) })} className={campoCls} style={campoStyle}>
						<option value="">Padrão (voz respeita, digitais não)</option><option value="sim">Sim</option><option value="nao">Não</option>
					</select>
					{h('respeitar_nao_perturbe')}
				</Rotulo>
				{!p.carteira && (
					<Rotulo texto="Números por cliente">
						<select value={String(r.numeros_por_cliente ?? 1)} disabled={dis} onChange={e => mudar({ numeros_por_cliente: Number(e.target.value) })} className={campoCls} style={campoStyle}>
							{numerosPorClienteOpts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
					</Rotulo>
				)}
				{!p.carteira && QUEM_ENVIA_CANAIS.has(p.canal) && (
					<Rotulo texto="Quem envia" dica="Mudar quem envia muda as seções desta tela depois de salvar.">
						<select aria-label={`Quem envia o ${nomeCanal(p.canal)}`} value={r.quem_envia ?? (p.quem === 'motorcx' ? 'motorcx' : 'lista')} disabled={dis} onChange={e => mudar({ quem_envia: e.target.value as 'lista' | 'motorcx' })} className={campoCls} style={campoStyle}>
							<option value="lista">Lista para baixar (seu fornecedor envia)</option>
							<option value="motorcx" disabled={!p.canaisMensageria.includes(p.canal)}>MotorCX envia{p.canaisMensageria.includes(p.canal) ? '' : ' (precisa da Mensageria)'}</option>
						</select>
					</Rotulo>
				)}
				{!p.carteira && motorcxDigital && (
					<Rotulo texto="Aprovar cada lote antes do envio" dica={p.podeLotes ? 'Vale para todos os canais da Mensageria (continua também em Mensageria › Configurações).' : 'Quem muda tem a permissão Enviar mensagens.'}>
						<select value={aprovar ? 'sim' : 'nao'} disabled={dis || !p.podeLotes} onChange={e => setAprovar(e.target.value === 'sim')} className={campoCls} style={campoStyle}>
							<option value="nao">Não: o lote sai sozinho no horário</option><option value="sim">Sim</option>
						</select>
					</Rotulo>
				)}
				{p.carteira && (
					<Rotulo texto="Produto padrão">
						<select value={r.produto_padrao ?? ''} disabled={dis} onChange={e => mudar({ produto_padrao: e.target.value || null })} className={campoCls} style={campoStyle}>
							<option value="">Padrão do canal</option>
							{produtos.map(x => <option key={String(x.codigo)} value={String(x.codigo)}>{String(x.nome)}</option>)}
						</select>
						{h('produto_padrao')}
					</Rotulo>
				)}
			</div>
			{erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
			{p.pode && <Rodape onCancelar={p.onCancelar} onSalvar={() => void salvar()} salvando={salvando} rotulo={SECOES.envio.salvar!} />}
		</div>
	);
}

function SecaoCustos(p: PropsBase & { salvo: LinhaCanal; sobSalvos: string[]; daEmpresa: LinhaCanal; pode: boolean; msg: MsgConfig | null; centros: { id: string; nome: string }[] | null }) {
	const { r, sob, mudar, voltar } = useRascunho(p.salvo, p.sobSalvos, p.daEmpresa);
	const [custo, setCusto] = useState(p.salvo.custo != null ? Number(p.salvo.custo).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : '');
	const [centro, setCentro] = useState(p.msg?.centro_custo_id ?? '');
	const [orc, setOrc] = useState<Row | null>(null);
	const [salvando, setSalvando] = useState(false);
	const [erro, setErro] = useState('');
	const dis = !p.pode;

	useEffect(() => {
		const sb = supabase;
		if (!sb || !centro) { setOrc(null); return; }
		let vivo = true;
		void sb.rpc('orcamento_centro', { centro }).then(({ data }) => { if (vivo) setOrc(((Array.isArray(data) ? data[0] : data) as Row) ?? null); });
		return () => { vivo = false; };
	}, [centro]);

	async function salvar() {
		if (!supabase) return;
		setErro('');
		let e: string | null = null;
		setSalvando(true);
		if (p.carteira) e = await gravarCarteira(p, CAMPOS_SECAO.custos, p.salvo, p.sobSalvos, r, sob);
		else {
			const lido = lerCusto(custo);
			if ('erro' in lido) { setErro(`Custo por ação: ${lido.erro}`); setSalvando(false); return; }
			const { error } = await supabase.from('canais_empresa').upsert(linhaEmpresaSecao(p.empresaId, p.canal, { ...r, custo: lido.valor }, CAMPOS_SECAO.custos), { onConflict: 'empresa_id,canal' });
			if (error) e = friendlyError(error);
			else if (p.centros && centro !== (p.msg?.centro_custo_id ?? '')) {
				// configurar_mensageria grava também o RCS sem aparelho: vai o que já estava salvo
				const { error: e2 } = await supabase.rpc('configurar_mensageria', {
					empresa: p.empresaId, centro_custo: centro || null, rcs_fallback: p.msg?.rcs_fallback ?? 'sms', rcs_fallback_template: p.msg?.rcs_fallback_template_id ?? null,
				});
				if (e2) e = friendlyError(e2);
			}
		}
		setSalvando(false);
		if (e) { setErro(e); return; }
		await p.onSalvo('Custos e limites');
	}

	const gasto = Number(orc?.gasto ?? 0);
	const limite = Number(orc?.orcamento ?? 0);
	return (
		<div>
			<div className={grade}>
				<Rotulo texto="Capacidade por dia" dica={p.carteira ? undefined : 'Passou do limite, entram primeiro quebra, preventivo e CPC; empatados, maior saldo.'}>
					<input type="number" min={0} value={r.capacidade_dia ?? ''} placeholder="sem limite" disabled={dis} onChange={e => mudar({ capacidade_dia: e.target.value ? Number(e.target.value) : null })} className={campoCls} style={campoStyle} />
					<Heranca carteira={p.carteira} sobrescrito={sob.includes('capacidade_dia')} onVoltar={() => voltar('capacidade_dia')} pode={p.pode} />
				</Rotulo>
				{!p.carteira && (
					<Rotulo texto="Custo por ação (R$)" dica="Usado para estimar o custo da estratégia.">
						<input type="text" inputMode="decimal" value={custo} placeholder="0,00" disabled={dis} onChange={e => setCusto(e.target.value)} className={campoCls} style={campoStyle} />
					</Rotulo>
				)}
				{!p.carteira && p.centros && (
					<Rotulo texto="Centro de custo da Lista do dia" dica="Vale para todos os canais da Mensageria. O orçamento do mês e o que fazer ao acabar ficam no centro de custo.">
						<select value={centro} disabled={dis} onChange={e => setCentro(e.target.value)} className={campoCls} style={campoStyle}>
							<option value="">Sem centro de custo</option>
							{p.centros.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
						</select>
						{orc && limite > 0 && <small className="text-[11.5px] font-normal text-[var(--base-texto-2)]">Gasto no mês: {moneyBR(gasto)} de {moneyBR(limite)}</small>}
					</Rotulo>
				)}
			</div>
			{!p.carteira && p.centros && <p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]">Cadastrar centros e mudar o orçamento: <LinkTexto to={`/mensageria/${p.canal}/config`}>Mensageria › Configurações</LinkTexto></p>}
			{erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
			{p.pode && <Rodape onCancelar={p.onCancelar} onSalvar={() => void salvar()} salvando={salvando} rotulo={SECOES.custos.salvar!} />}
		</div>
	);
}

function SecaoMensagens(p: PropsBase & { pode: boolean; msg: MsgConfig | null }) {
	const [fallback, setFallback] = useState(p.msg?.rcs_fallback ?? 'sms');
	const [template, setTemplate] = useState(p.msg?.rcs_fallback_template_id ?? '');
	const [templatesSms, setTemplatesSms] = useState<Row[]>([]);
	const [salvando, setSalvando] = useState(false);
	const [erro, setErro] = useState('');
	const rcsMotorcx = p.canal === 'rcs' && p.quem === 'motorcx';

	useEffect(() => {
		const sb = supabase;
		if (!sb || !rcsMotorcx) return;
		let vivo = true;
		void sb.from('mensageria_templates').select('id,nome').eq('empresa_id', p.empresaId).eq('canal', 'sms').eq('situacao', 'ativo').order('nome')
			.then(({ data }) => { if (vivo) setTemplatesSms((data ?? []) as Row[]); });
		return () => { vivo = false; };
	}, [rcsMotorcx, p.empresaId]);

	async function salvarFallback() {
		if (!supabase) return;
		setSalvando(true); setErro('');
		const { error } = await supabase.rpc('configurar_mensageria', {
			empresa: p.empresaId, centro_custo: p.msg?.centro_custo_id ?? null, rcs_fallback: fallback, rcs_fallback_template: fallback === 'sms' ? (template || null) : null,
		});
		setSalvando(false);
		if (error) { setErro(friendlyError(error)); return; }
		await p.onSalvo('RCS sem aparelho');
	}

	if (p.canal === 'email') {
		return <p className="text-[13px] text-[var(--base-texto-2)]">O MotorCX envia o e-mail com o modelo da empresa (remetente, assunto e texto): <LinkTexto to="/mensageria/email/templates">Mensageria › E-mail › Templates</LinkTexto>.</p>;
	}
	return (
		<div className="space-y-4">
			{p.canal === 'agente_voz' && (
				<Aviso tom="info">
					{p.quem === 'voz_motorcx' ? 'A conversa do agente vem do fluxo de cada carteira. Abaixo, as frases de abertura.' : 'As frases abaixo vão na lista para o AGV da sua empresa.'}{' '}
					<Link to="/voz/agente" className="font-semibold underline">Fluxos do agente: Agente Voz/CX › Agente de voz</Link>
				</Aviso>
			)}
			{rcsMotorcx && (
				<div className="rounded-xl p-3.5" style={{ boxShadow: SOMBRA }}>
					<div className={grade}>
						<Rotulo texto="Se o aparelho não tiver RCS" dica="Continua também em Mensageria › RCS › Configurações.">
							<select value={fallback} disabled={!p.pode} onChange={e => setFallback(e.target.value)} className={campoCls} style={campoStyle}>
								<option value="sms">Enviar por SMS</option><option value="whatsapp">Enviar por WhatsApp</option><option value="nenhum">Não enviar</option>
							</select>
						</Rotulo>
						{fallback === 'sms' && (
							<Rotulo texto="Texto do SMS de fallback">
								<select value={template} disabled={!p.pode} onChange={e => setTemplate(e.target.value)} className={campoCls} style={campoStyle}>
									<option value="">O texto do RCS</option>
									{templatesSms.map(t => <option key={String(t.id)} value={String(t.id)}>{String(t.nome)}</option>)}
								</select>
							</Rotulo>
						)}
					</div>
					{erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
					{p.pode && <Rodape onCancelar={p.onCancelar} onSalvar={() => void salvarFallback()} salvando={salvando} rotulo="Salvar mensagens" />}
				</div>
			)}
			<FrasesTab canal={p.canal} />
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Todas as frases dos canais: <LinkTexto to={`/canais?secao=frases&canal=${p.canal}`}>Cobrança › Estratégia › Frases</LinkTexto></p>
		</div>
	);
}

function SecaoRetorno(p: PropsBase & { credorId: string; regras: Record<string, RegrasRetorno> | null; pode: boolean; onRecarregar: () => Promise<void> }) {
	const c = canalRetorno(p.canal);
	const [r, setR] = useState<RegrasRetorno | null>(p.regras?.[c] ?? null);
	const [salvando, setSalvando] = useState(false);
	const [erro, setErro] = useState('');
	useEffect(() => { setR(p.regras?.[c] ?? null); }, [p.credorId, p.regras, c]);

	async function salvar() {
		if (!supabase) return;
		setSalvando(true); setErro('');
		// só o canal desta tela muda; os outros canais da carteira ficam como estão
		const todas: Record<string, RegrasRetorno | null> = { ...(p.regras ?? {}), [c]: r };
		const { error } = await supabase.from('credores').update({ regras_retorno: limparRegrasCredor(todas) }).eq('id', p.credorId);
		setSalvando(false);
		if (error) { setErro(friendlyError(error)); return; }
		await p.onRecarregar();
		await p.onSalvo('Retorno do canal');
	}

	return (
		<div>
			{VOZ.has(p.canal) && <p className="mb-3 text-[12.5px] text-[var(--base-texto-2)]">As regras de retorno de voz valem para o agente de voz e para o discador.</p>}
			<RegrasCanal canal={c} regras={r} canEdit={p.pode} onChange={(_, patch) => setR(x => ({ ...(x ?? {}), ...patch }))} onRestaurar={() => setR(null)} />
			<p className="mt-3 text-[12.5px] text-[var(--base-texto-2)]">Continua também em <LinkTexto to="/credores">Carteiras › (carteira) › Configurações › Canais</LinkTexto>{regrasMudou(c, r) ? ' · você mudou a sugestão MotorCX' : ''}.</p>
			{erro && <div className="mt-3"><Aviso tom="erro">{erro}</Aviso></div>}
			{p.pode && <Rodape onCancelar={p.onCancelar} onSalvar={() => void salvar()} salvando={salvando} rotulo={SECOES.retorno.salvar!} />}
		</div>
	);
}

function SecaoLista({ canal, hoje, est, retorno, pode, onRecarregar }: {
	canal: string; hoje: string; est: CanalEstado | null; pode: boolean; onRecarregar: () => Promise<void>;
	retorno: { mapeamento: MapeamentoCanal | null; codigos: CanalCodigo[] } | null;
}) {
	const s = (k: string) => est?.sinais.find(x => x.chave === k);
	const lista = s('ultima_lista');
	const ret = s('ultimo_retorno');
	return (
		<div className="space-y-4">
			<dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
				<dt className="text-[var(--base-texto-2)]">Última lista</dt>
				<dd className="m-0 text-[var(--base-texto)]">{lista?.valor ? `${dia(String(lista.valor), hoje)}${lista.detalhe ? ` · ${lista.detalhe}` : ''}` : '—'} · <LinkTexto to="/fila">baixar a lista de hoje</LinkTexto></dd>
				<dt className="text-[var(--base-texto-2)]">Último retorno</dt>
				<dd className="m-0 text-[var(--base-texto)]">{ret?.valor ? instante(String(ret.valor), hoje) : '—'} · <LinkTexto to="/envios">enviar o retorno</LinkTexto></dd>
			</dl>
			<div>
				<h3 className="mb-2 text-[13.5px] font-semibold text-[var(--base-texto)]">Arquivo do fornecedor: colunas</h3>
				{retorno?.mapeamento ? <MapeamentoColunas mapeamento={retorno.mapeamento} canEdit={pode} onSaved={() => void onRecarregar()} />
					: <p className="rounded-lg bg-[var(--base-fill)] px-3.5 py-3 text-[13px] text-[var(--base-texto-2)]">Aguardando o primeiro arquivo de retorno deste canal. Envie em <Link to="/envios" className="font-semibold underline">Enviar arquivos</Link> → Retorno dos canais; as colunas aparecem aqui para confirmar.</p>}
			</div>
			<div>
				<h3 className="mb-2 text-[13.5px] font-semibold text-[var(--base-texto)]">Status do fornecedor</h3>
				{retorno?.codigos.length ? <TabelaCodigos canal={canalRetorno(canal)} codigos={retorno.codigos} canEdit={pode} onSaved={() => void onRecarregar()} />
					: <p className="rounded-lg bg-[var(--base-fill)] px-3.5 py-3 text-[13px] text-[var(--base-texto-2)]">Os status aparecem aqui quando o primeiro arquivo chegar.</p>}
			</div>
			<p className="text-[12.5px] text-[var(--base-texto-2)]">Continua também em <LinkTexto to="/credores">Carteiras › (carteira) › Configurações › Canais</LinkTexto>.</p>
		</div>
	);
}

function SecaoConexao({ canal, msg, equipe }: { canal: string; msg: MsgConfig | null; equipe: boolean }) {
	const itens: [string, string][] = [
		['Fornecedor', 'Definido pela equipe MotorCX (rota principal e reserva)'],
		['Modo', msg?.modo === 'real' ? 'Envio real' : 'Simulação (nada sai para o cliente)'],
	];
	if (canal === 'rcs') itens.push(['Agente RCS', msg?.rcs_agente === 'conversacional' ? 'Conversacional' : 'Não conversacional']);
	itens.push(['Credenciais', 'Guardadas no cofre; nunca aparecem na tela']);
	return (
		<div>
			<dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
				{itens.map(([k, v]) => <div key={k} className="contents"><dt className="text-[var(--base-texto-2)]">{k}</dt><dd className="m-0 text-[var(--base-texto)]">{v}</dd></div>)}
			</dl>
			<p className="mt-3 text-[12.5px] text-[var(--base-texto-3)]">Só leitura. {equipe ? <>Equipe MotorCX: <LinkTexto to="/console/fornecedores">Console › Fornecedores e rotas</LinkTexto>.</> : 'Para mudar o fornecedor ou a rota, fale com a equipe MotorCX.'}</p>
		</div>
	);
}
