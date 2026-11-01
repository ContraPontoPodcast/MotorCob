// Tela 2 · Cobrança › Canais › Agente virtual › Roteiro.
// Rascunho → Aprovado pela empresa → Em uso (sem jurídico). Lê voz_roteiros e voz_config;
// escreve só por RPC: salvar_roteiro_voz, aprovar_roteiro_voz e configurar_voz_empresa.
// Redesign v2: no corpo só o que se decide no roteiro (tipo de agente, quando transferir, primeira fala); as 6 regras
// fixas no selo "Regras que não mudam"; exemplo, Alô fake e variáveis recolhidos. A ação principal é a da etapa atual.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PageHeading, Loading, Notice, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { supabase, friendlyError, dateTimeBR, type Row } from '@/lib/supabase';
import {
	PERM_VOZ, SITUACAO_ROTEIRO, TIPOS_AGENTE, VARIAVEIS_VOZ, aberturaFixa, regrasDe, regrasPadrao,
	type RegrasTransferencia, type TipoAgente,
} from '@/lib/voz';
import { Botao, Cartao, Pilula, SubAbas, Trava, Vazio, campoCls, campoStyle } from './ui';
import { Detalhes, Gaveta, Passos as PassosDs, SeloRegras, Botao as BotaoDs } from '@/components/ds';

const REGRAS_FIXAS = [
	{ titulo: 'Só fala da dívida depois que a pessoa confirma ser o titular.', texto: 'Antes disso, o agente não diz valor, credor da dívida nem atraso.' },
	{ titulo: 'Se atender outra pessoa, deixa só um recado neutro.', texto: '"Peço que {{primeiro_nome}} retorne para a {{assessoria}}." Sem valor, sem motivo.' },
	{ titulo: 'Caixa postal: nenhum recado.' },
	{ titulo: 'Oferece falar com uma pessoa a qualquer momento e aceita "não me ligue mais" na hora.', texto: 'Transfere para o discador de vocês pelo tronco SIP, com o ID do cliente e o motivo no cabeçalho.' },
	{ titulo: 'Nunca pede CPF, número de cartão ou senha.', texto: 'O pagamento é sempre pelo link.' },
	{ titulo: 'Nunca vão ao provedor: CPF, endereço, número do contrato, outras dívidas, e-mail.', texto: 'Não é uma opção da tela; o servidor recusa.' },
];

type Roteiro = {
	id: number; versao: number; situacao: string; tipo_agente: TipoAgente; prompt: string; primeira_fala: string;
	apresentar_virtual: boolean; regras_transferencia: unknown; parecer: string | null;
	aprovado_em: string | null; em_uso_em: string | null; atualizado_em: string | null;
};

type Rascunho = {
	tipo: TipoAgente; regras: RegrasTransferencia; prompt: string; fala: string; virtual: boolean;
};

type VozConfig = {
	alo_fake_liberado: boolean; alo_fake: boolean; alo_fake_max_s: number; aviso_gravacao: boolean; variaveis: string[];
};

const PROMPT_PADRAO = 'Você é o agente virtual da {{assessoria}}, em nome de {{credor}}. Seja cordial e objetivo. Confirme que fala com o titular antes de qualquer assunto da conta. Depois, apresente a situação e as ofertas da carteira, dentro da alçada. Se a pessoa pedir, mande o link de pagamento por SMS.';
const FALA_PADRAO = 'Posso falar um minuto sobre a sua conta?';

const PASSOS = [
	{ id: 'rascunho', nome: 'Rascunho', desc: 'Quem edita canais e frases' },
	{ id: 'aprovado_empresa', nome: 'Aprovado pela empresa', desc: 'Quem tem Aprovar o roteiro' },
	{ id: 'em_uso', nome: 'Em uso', desc: 'Vai ao agente na próxima rodada' },
];

function deRoteiro(r: Roteiro): Rascunho {
	return { tipo: r.tipo_agente, regras: regrasDe(r.tipo_agente, r.regras_transferencia), prompt: r.prompt, fala: r.primeira_fala, virtual: !!r.apresentar_virtual };
}

function novoRascunho(): Rascunho {
	return { tipo: 'negociador', regras: regrasPadrao('negociador'), prompt: PROMPT_PADRAO, fala: FALA_PADRAO, virtual: false };
}

export function RoteiroAgente() {
	const { empresa, credor } = useMotorAuth();
	const podeEditar = usePermissao(PERM_VOZ.editarCanais);
	const podeAprovar = usePermissao(PERM_VOZ.aprovarRoteiro);
	const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
	const [config, setConfig] = useState<VozConfig | null>(null);
	const [selId, setSelId] = useState<number | null>(null);
	const [draft, setDraft] = useState<Rascunho | null>(null);
	const [sujo, setSujo] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [confirma, setConfirma] = useState<null | 'aprovado_empresa' | 'em_uso'>(null);
	const [aloMax, setAloMax] = useState('4');
	const [verVariaveis, setVerVariaveis] = useState(false);

	const credorId = credor?.id ?? null;

	async function reload(manterSel?: number | null) {
		if (!supabase || !empresa) return;
		setLoading(true); setError('');
		let q = supabase.from('voz_roteiros')
			.select('id,versao,situacao,tipo_agente,prompt,primeira_fala,apresentar_virtual,regras_transferencia,parecer,aprovado_em,em_uso_em,atualizado_em')
			.eq('empresa_id', empresa.id).order('versao', { ascending: false });
		q = credorId ? q.eq('credor_id', credorId) : q.is('credor_id', null);
		const [r, c] = await Promise.all([
			q,
			supabase.from('voz_config').select('alo_fake_liberado,alo_fake,alo_fake_max_s,aviso_gravacao,variaveis').eq('empresa_id', empresa.id).maybeSingle(),
		]);
		if (r.error) { setError(friendlyError(r.error)); setLoading(false); return; }
		const lista = (r.data ?? []) as Roteiro[];
		setRoteiros(lista);
		const cfg = (c.data as Row | null) as VozConfig | null;
		setConfig(cfg);
		setAloMax(String(cfg?.alo_fake_max_s ?? 4));
		const alvo = (manterSel != null ? lista.find(x => x.id === manterSel) : null)
			?? lista.find(x => x.situacao === 'rascunho') ?? lista.find(x => x.situacao === 'aprovado_empresa')
			?? lista.find(x => x.situacao === 'em_uso') ?? lista[0] ?? null;
		setSelId(alvo?.id ?? null);
		setDraft(alvo ? deRoteiro(alvo) : null);
		setSujo(false);
		setLoading(false);
	}

	useEffect(() => { void reload(); }, [empresa?.id, credorId]);

	const sel = useMemo(() => roteiros.find(r => r.id === selId) ?? null, [roteiros, selId]);
	const emUso = roteiros.find(r => r.situacao === 'em_uso') ?? null;
	const situacao = sel?.situacao ?? 'rascunho';
	const ixPasso = situacao === 'em_uso' ? 2 : situacao === 'aprovado_empresa' ? 1 : 0;
	const editavel = podeEditar && !!draft && (sel == null || sel.situacao !== 'arquivado');

	function patch(p: Partial<Rascunho>) { setDraft(d => (d ? { ...d, ...p } : d)); setSujo(true); }
	function trocarTipo(t: TipoAgente) {
		// Saindo do localizador (ou indo para ele), volta ao padrão do tipo; entre negociador e ambos, mantém o que a pessoa marcou.
		const manter = draft && draft.tipo !== 'localizador' && t !== 'localizador';
		patch({ tipo: t, regras: manter ? draft.regras : regrasPadrao(t) });
	}
	function trocarVersao(id: number) {
		const r = roteiros.find(x => x.id === id);
		if (!r) return;
		setSelId(id); setDraft(deRoteiro(r)); setSujo(false);
	}

	const erroValidacao = !draft ? '' :
		draft.prompt.trim().length < 50 ? 'As instruções do agente precisam ter pelo menos 50 caracteres.' :
		draft.fala.trim().length < 10 ? 'A fala depois da confirmação precisa ter pelo menos 10 caracteres.' :
		draft.fala.length > 500 ? 'A fala depois da confirmação passa de 500 caracteres.' : '';

	async function salvar() {
		if (!supabase || !empresa || !draft || erroValidacao) return;
		setOcupado(true);
		const { data, error } = await supabase.rpc('salvar_roteiro_voz', {
			empresa: empresa.id, credor: credorId, prompt: draft.prompt.trim(), primeira_fala: draft.fala.trim(),
			tipo_agente: draft.tipo, regras_transferencia: draft.regras, apresentar_virtual: draft.virtual, roteiro: sel?.id ?? null,
		});
		setOcupado(false);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(sel && sel.situacao !== 'rascunho' ? 'Nova versão criada como rascunho. A versão em uso continua valendo.' : 'Rascunho salvo.');
		await reload(Number(data));
	}

	async function avancar(etapa: 'aprovado_empresa' | 'em_uso') {
		if (!supabase || !sel) return;
		setOcupado(true);
		const { error } = await supabase.rpc('aprovar_roteiro_voz', { roteiro: sel.id, etapa, parecer: null });
		setOcupado(false); setConfirma(null);
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(etapa === 'em_uso' ? 'Roteiro em uso a partir da próxima rodada.' : 'Roteiro aprovado pela empresa.');
		await reload(sel.id);
	}

	async function salvarConfig(ajustes: Record<string, unknown>, ok: string) {
		if (!supabase || !empresa) return;
		const { error } = await supabase.rpc('configurar_voz_empresa', { empresa: empresa.id, ajustes });
		if (error) { toast.error(friendlyError(error)); return; }
		toast.success(ok);
		const { data } = await supabase.from('voz_config').select('alo_fake_liberado,alo_fake,alo_fake_max_s,aviso_gravacao,variaveis').eq('empresa_id', empresa.id).maybeSingle();
		setConfig((data as Row | null) as VozConfig | null);
	}

	const escopoTxt = credor ? `Carteira ${credor.nome}` : 'Empresa toda';
	const acaoPrincipal = !draft ? null
		: sujo && editavel ? <BotaoDs onClick={() => void salvar()} disabled={ocupado || !!erroValidacao}>{sel && sel.situacao !== 'rascunho' ? 'Salvar como nova versão' : 'Salvar rascunho'}</BotaoDs>
		: situacao === 'rascunho' && sel && podeAprovar ? <BotaoDs onClick={() => setConfirma('aprovado_empresa')} disabled={ocupado}>Aprovar pela empresa</BotaoDs>
		: situacao === 'aprovado_empresa' && podeAprovar ? <BotaoDs onClick={() => setConfirma('em_uso')} disabled={ocupado}>Colocar em uso</BotaoDs>
		: null;
	const heading = (
		<PageHeading title="Agente virtual" description={`Roteiro · ${escopoTxt}${sel ? ` · v${sel.versao}` : ''}`} actions={draft ? <>
			{roteiros.length > 0 && <select aria-label="Versão" value={selId ?? ''} onChange={e => trocarVersao(Number(e.target.value))} className={campoCls} style={campoStyle}>
				{selId == null && <option value="">nova versão</option>}
				{roteiros.map(r => <option key={r.id} value={r.id}>v{r.versao} · {SITUACAO_ROTEIRO[r.situacao]?.toLowerCase() ?? r.situacao}</option>)}
			</select>}
			{sujo && <BotaoDs tipo="secundario" onClick={() => (sel ? trocarVersao(sel.id) : void reload())} disabled={ocupado}>Descartar</BotaoDs>}
			{acaoPrincipal}
		</> : undefined} />
	);
	const sub = (
		<SubAbas atual="roteiro" itens={[
			{ id: 'canal', nome: 'Configuração do canal', to: '/canais' },
			{ id: 'frases', nome: 'Modelos de mensagem', to: '/canais?secao=frases' },
			{ id: 'roteiro', nome: 'Roteiro' },
		]} />
	);

	if (!empresa) return <>{heading}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (loading) return <>{heading}{sub}<Loading /></>;

	const escopo = credor ? `Carteira ${credor.nome}` : 'Empresa toda (sem carteira escolhida)';
	const variaveis = new Set(config?.variaveis ?? ['primeiro_nome', 'credor', 'link_pagamento']);

	return (
		<>
			{heading}
			{sub}
			{error && <div className="mb-4"><Notice>{error}</Notice></div>}

			{!draft ? (
				<Vazio titulo="Ainda não há roteiro para o agente virtual." acao={podeEditar ? <Botao onClick={() => { setDraft(novoRascunho()); setSelId(null); setSujo(true); }}>Escrever o primeiro roteiro</Botao> : undefined}>
					{escopo}. O roteiro diz como o agente se apresenta, o que pode negociar e quando transfere para o discador de vocês. {podeEditar ? 'Ele começa como rascunho e só liga depois de aprovado pela empresa.' : 'Quem edita canais e frases escreve o roteiro.'}
				</Vazio>
			) : (
				<div className="space-y-4">
					<Cartao>
						<div className="flex flex-wrap items-center justify-between gap-3">
							{situacao === 'arquivado' ? <Pilula>Versão arquivada · só consulta</Pilula> : <PassosDs rotulo="Etapas do roteiro" passos={PASSOS.map(p => p.nome)} atual={ixPasso} />}
							<span className="flex flex-wrap items-center gap-2">
								{!podeEditar && <Pilula>somente leitura</Pilula>}
								<SeloRegras rotulo={`Regras que não mudam (${REGRAS_FIXAS.length})`} subtitulo="Valem acima do texto do roteiro, em toda ligação." regras={REGRAS_FIXAS} />
							</span>
						</div>
						<p className="mt-2 text-[12.5px] text-[var(--base-texto-2)]">{situacao === 'em_uso' ? `Em uso desde ${dateTimeBR(sel?.em_uso_em)}.` : emUso ? `O v${emUso.versao} continua em uso até este ser aprovado e colocado em uso.` : 'Nenhuma versão em uso ainda: o agente não liga com esta carteira.'}
							{situacao === 'rascunho' && sel && !sujo && !podeAprovar && ' Quem tem a permissão Aprovar o roteiro aprova esta versão.'}
							{situacao === 'aprovado_empresa' && !sujo && !podeAprovar && ' Quem tem Aprovar o roteiro coloca em uso.'}
							{sujo && sel && sel.situacao !== 'rascunho' && ' Mudar uma versão aprovada ou em uso cria uma versão nova (rascunho), que passa de novo pela aprovação.'}</p>
						{sujo && erroValidacao && <p className="mt-2 text-[12.5px] text-[var(--estado-erro-texto)]">{erroValidacao}</p>}
					</Cartao>

					<Cartao titulo="Tipo de agente" linha="Quem liga é sempre o agente de IA. A operação humana fica no discador de vocês e recebe a chamada por transferência.">
						<div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de agente">
							{TIPOS_AGENTE.map(t => {
								const ativo = draft.tipo === t.id;
								return (
									<button key={t.id} type="button" role="radio" aria-checked={ativo} disabled={!editavel} onClick={() => trocarTipo(t.id)}
										className="flex flex-col gap-1 rounded-2xl border px-3.5 py-3 text-left disabled:cursor-default"
										style={{ borderColor: ativo ? 'var(--destaque)' : 'var(--base-borda)', boxShadow: ativo ? '0 0 0 1px var(--destaque)' : undefined, backgroundColor: 'var(--base-cartao)' }}>
										<b className="text-[13.5px] font-semibold text-[var(--base-texto)]">{t.nome}</b>
										<span className="text-[12.5px] leading-relaxed text-[var(--base-texto-2)]">{t.desc}</span>
									</button>
								);
							})}
						</div>

						<h3 className="mt-5 text-[14px] font-semibold text-[var(--base-texto)]">Quando transferir para o discador de vocês</h3>
						<ul className="mt-2 space-y-1.5">
							<Regra rotulo="A pessoa pede para falar com alguém" fixo travado />
							<Regra rotulo="Assim que a pessoa confirma ser o titular (CPC)" marcado={draft.regras.cpc} travado={draft.tipo === 'localizador'} desabilitado={!editavel} onChange={v => patch({ regras: { ...draft.regras, cpc: v } })} nota={draft.tipo === 'localizador' ? 'O localizador sempre transfere ao confirmar o titular.' : undefined} />
							{draft.tipo !== 'localizador' && (
								<li className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--base-texto)]">
									<label htmlFor="ofertas" className="flex items-center gap-2">Sem acordo depois de</label>
									<select id="ofertas" value={draft.regras.ofertas_sem_acordo} disabled={!editavel} onChange={e => patch({ regras: { ...draft.regras, ofertas_sem_acordo: Number(e.target.value) } })} className={`${campoCls} h-8 w-20`} style={campoStyle}>
										{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 0 ? 'nunca' : n}</option>)}
									</select>
									<span>{draft.regras.ofertas_sem_acordo === 1 ? 'oferta' : 'ofertas'}</span>
								</li>
							)}
							<Regra rotulo="Pediu valor ou prazo fora da alçada da carteira" marcado={draft.regras.fora_alcada} desabilitado={!editavel} onChange={v => patch({ regras: { ...draft.regras, fora_alcada: v } })} />
							<Regra rotulo="Contesta a dívida ou fala em Procon" marcado={draft.regras.contestacao} desabilitado={!editavel} onChange={v => patch({ regras: { ...draft.regras, contestacao: v } })} />
						</ul>
						<p className="mt-2 text-[12px] text-[var(--base-texto-3)]">Fora dessas regras o agente encerra sozinho e grava o evento (promessa, retorno, recusa). A transferência vai pelo tronco SIP com o ID do cliente e o motivo.</p>
					</Cartao>

					<Cartao titulo="Primeira fala" linha={'O começo é fixo. Não existe aviso automático de "assistente virtual": se a empresa quiser, a frase entra no texto deste roteiro.'}>
						<p className="rounded-xl bg-[var(--base-fill)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--base-texto)]"><Variaveis texto={aberturaFixa(draft.virtual, !!config?.aviso_gravacao)} /></p>
						<label htmlFor="fala" className="mt-3 block text-[12px] font-semibold text-[var(--base-texto-2)]">Depois da confirmação de identidade</label>
						<input id="fala" value={draft.fala} maxLength={500} disabled={!editavel} onChange={e => patch({ fala: e.target.value })} className={`${campoCls} mt-1 w-full`} style={campoStyle} />
						<label className="mt-3 flex items-start gap-2 text-[13px] text-[var(--base-texto)]">
							<input type="checkbox" checked={draft.virtual} disabled={!editavel} onChange={e => patch({ virtual: e.target.checked })} className="mt-0.5 accent-[var(--destaque)]" />
							<span>Escrever no roteiro "aqui é a assistente virtual" <span className="text-[var(--base-texto-3)]">(padrão: desligado)</span></span>
						</label>
						<p className="mt-1 text-[12px] text-[var(--base-texto-3)]">{config?.aviso_gravacao ? 'A abertura avisa que a ligação é gravada' : 'A abertura não avisa que a ligação é gravada'}: isso vale para a empresa toda e muda em <Link to="/empresa/privacidade" className="underline">Empresa › Privacidade e gravações</Link>.</p>
						<label htmlFor="prompt" className="mt-4 block text-[12px] font-semibold text-[var(--base-texto-2)]">Como o agente conduz a conversa</label>
						<textarea id="prompt" value={draft.prompt} maxLength={20000} rows={5} disabled={!editavel} onChange={e => patch({ prompt: e.target.value })} className={`${campoCls} mt-1 h-auto w-full py-2 leading-relaxed`} style={campoStyle} />
						<p className="mt-1 text-[11.5px] text-[var(--base-texto-3)]">Use as variáveis entre chaves duplas, como {'{{credor}}'}. As regras fixas valem acima deste texto.</p>
					</Cartao>

					<Detalhes solto resumo="Exemplo de conversa">
						<div className="space-y-2">
							<Balao quem="Agente"><Variaveis texto={aberturaFixa(draft.virtual, !!config?.aviso_gravacao)} /></Balao>
							<Balao quem="Pessoa" cliente>Sou eu.</Balao>
							<Balao quem="Agente">Obrigada. {draft.fala} {draft.tipo === 'localizador' ? 'Vou passar você para um atendente agora.' : <>Consta um valor de <Variaveis texto="{{saldo}}" /> em aberto.</>}</Balao>
							{draft.tipo !== 'localizador' && <><Balao quem="Pessoa" cliente>Consigo pagar dia 5.</Balao><Balao quem="Agente">Combinado: dia 5. Quer que eu mande o link por SMS?</Balao></>}
						</div>
					</Detalhes>

					<Detalhes solto resumo="Ao atender e o que vai ao provedor" qtd="vale para a empresa toda">
						{config?.alo_fake_liberado ? (
							<>
								<label className="flex items-start gap-2 text-[13px] text-[var(--base-texto)]">
									<input type="checkbox" checked={!!config.alo_fake} disabled={!podeEditar} onChange={e => void salvarConfig({ alo_fake: e.target.checked }, e.target.checked ? 'Alô fake ligado.' : 'Alô fake desligado.')} className="mt-0.5 accent-[var(--destaque)]" />
									<span>"Alô fake" enquanto transfere <span className="text-[var(--base-texto-3)]">(padrão: desligado)</span><small className="block text-[12px] text-[var(--base-texto-2)]">Quando o operador ainda não atendeu, toca um "Alô?" gravado na voz do agente para segurar a pessoa.</small></span>
								</label>
								{config.alo_fake ? (
									<div className="mt-3 flex flex-wrap items-end gap-2">
										<div>
											<label htmlFor="alo-max" className="block text-[12px] font-semibold text-[var(--base-texto-2)]">Tempo máximo de espera (segundos)</label>
											<input id="alo-max" type="number" min={1} max={15} value={aloMax} disabled={!podeEditar} onChange={e => setAloMax(e.target.value)} className={`${campoCls} mt-1 w-24`} style={campoStyle} />
										</div>
										{podeEditar && Number(aloMax) !== config.alo_fake_max_s && <Botao secundario disabled={!(Number(aloMax) >= 1 && Number(aloMax) <= 15)} onClick={() => void salvarConfig({ alo_fake_max_s: Number(aloMax) }, 'Tempo do Alô fake salvo.')}>Salvar tempo</Botao>}
										<p className="w-full text-[12px] text-[var(--base-texto-2)]">Se ninguém ficar livre em {config.alo_fake_max_s} s, a chamada cai e conta como abandono.</p>
									</div>
								) : <p className="mt-2 text-[12px] text-[var(--base-texto-2)]">Desligado: sem operador livre na transferência, a chamada cai na hora e conta como abandono.</p>}
							</>
						) : (
							<Trava titulo="Alô fake não liberado para a sua empresa." texto="É um recurso que a equipe MotorCX libera. Peça pelo Suporte." />
						)}
						<div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-[var(--base-texto-2)]">
							<BotaoDs tipo="secundario" pequeno onClick={() => setVerVariaveis(true)}>Ver as variáveis</BotaoDs>
							<span>O limite de abandono que freia o lote fica em <Link to="/mensageria/voz/lotes" className="underline">Ligações em curso</Link>.</span>
						</div>
					</Detalhes>
				</div>
			)}

			<Gaveta aberta={verVariaveis} onFechar={() => setVerVariaveis(false)} titulo="O que vai para o provedor" subtitulo="O mínimo, e vale para a empresa toda. Telefone e primeiro nome só ficam no servidor e no provedor durante a ligação; nunca no banco do MotorCX.">
				<ul className="divide-y [&>*]:border-[var(--base-borda)]">
					{VARIAVEIS_VOZ.map(v => (
						<li key={v.id} className="flex items-start justify-between gap-3 py-2.5 text-[13px]">
							<span className="min-w-0"><span className="font-mono text-[12px] text-[var(--base-texto)]">{v.id}</span><small className="block text-[12px] text-[var(--base-texto-2)]">{v.desc}</small></span>
							{v.sempre ? <Pilula>Sempre</Pilula> : (
								<label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[var(--base-texto)]">
									<input type="checkbox" checked={variaveis.has(v.id)} disabled={!podeEditar}
										onChange={e => {
											const s = new Set(variaveis); if (e.target.checked) s.add(v.id); else s.delete(v.id);
											s.add('primeiro_nome'); s.add('credor');
											void salvarConfig({ variaveis: [...s] }, 'Variáveis salvas.');
										}} className="accent-[var(--destaque)]" /> Enviar
								</label>
							)}
						</li>
					))}
				</ul>
				<Trava titulo="Nunca vão: CPF, endereço, número do contrato, outras dívidas, e-mail." texto="Não é uma opção da tela; o servidor recusa." />
			</Gaveta>

			<ConfirmaAcao
				aberto={confirma != null}
				titulo={confirma === 'em_uso' ? 'Colocar este roteiro em uso?' : 'Aprovar este roteiro?'}
				texto={confirma === 'em_uso'
					? `O v${sel?.versao ?? ''} passa a ser o roteiro do agente na próxima rodada${emUso && emUso.id !== sel?.id ? ` e o v${emUso.versao} é arquivado` : ''}. Fica registrado quem colocou em uso.`
					: 'A aprovação fica registrada com o seu nome. Depois, quem tem a mesma permissão coloca a versão em uso.'}
				botao={confirma === 'em_uso' ? 'Colocar em uso' : 'Aprovar'}
				onConfirm={() => confirma && void avancar(confirma)}
				onClose={() => setConfirma(null)}
				loading={ocupado}
			/>
		</>
	);
}

function Regra({ rotulo, marcado = true, fixo, travado, desabilitado, onChange, nota }: { rotulo: string; marcado?: boolean; fixo?: boolean; travado?: boolean; desabilitado?: boolean; onChange?: (v: boolean) => void; nota?: string }) {
	return (
		<li className="text-[13px] text-[var(--base-texto)]">
			<label className="flex items-start gap-2">
				<input type="checkbox" checked={fixo ? true : marcado} disabled={fixo || travado || desabilitado} onChange={e => onChange?.(e.target.checked)} className="mt-0.5 accent-[var(--destaque)]" />
				<span>{rotulo}{(fixo || travado) && <span className="ml-1.5 text-[11.5px] text-[var(--base-texto-3)]">· sempre</span>}{nota && <small className="block text-[12px] text-[var(--base-texto-3)]">{nota}</small>}</span>
			</label>
		</li>
	);
}

function Variaveis({ texto }: { texto: string }) {
	const partes = texto.split(/(\{\{[a-z_]+\}\})/g);
	return <>{partes.map((p, i) => /^\{\{[a-z_]+\}\}$/.test(p)
		? <span key={i} className="rounded px-1 font-mono text-[12px]" style={{ backgroundColor: 'var(--destaque-suave)', color: 'var(--base-texto)' }}>{p}</span>
		: <span key={i}>{p}</span>)}</>;
}

function Balao({ quem, cliente, children }: { quem: string; cliente?: boolean; children: React.ReactNode }) {
	return (
		<div className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${cliente ? 'ml-auto' : ''}`} style={{ backgroundColor: cliente ? 'var(--destaque-suave)' : 'var(--base-fill)', color: 'var(--base-texto)' }}>
			<small className="block text-[11px] font-semibold text-[var(--base-texto-3)]">{quem}</small>
			{children}
		</div>
	);
}
