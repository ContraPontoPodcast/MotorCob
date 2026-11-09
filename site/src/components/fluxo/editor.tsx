// Tela 2 · Agente de voz › Editor do fluxo. Abas (PR3 do redesenho): Roteiro (padrão: a conversa de cima para baixo,
// em capítulos, com a faixa das 7 travas e "Em qualquer momento da ligação") · Mapa (o quadro por ramos, para ver o
// todo) · Respostas prontas · Testes · Versões e aprovação. A aba fica em ?aba= e a etapa aberta em ?etapa=.
// Cada mudança de etapa salva o rascunho (salvar_fluxo_voz: rascunho edita no lugar; versão aprovada ou em uso vira
// rascunho novo). As pendências vêm do banco: fluxo_voz_bloqueios (validador + conectores + alçada + intenções + casos
// de teste) e fluxo_voz_avisos (roleplay, só aviso). "Enviar para aprovação" (enviar_fluxo_voz_aprovacao, SQL 66)
// fica desabilitado com o motivo enquanto houver pendência. Aprovar: aprovar_fluxo_voz; colocar em uso: usar_fluxo_voz.
// PR4: cada pendência aparece dentro da etapa ("O que corrigir", no Roteiro, no Mapa e na gaveta), com o botão de
// correção de um clique quando ela é determinística (correcaoDe): antes → depois, confirmar, e vai para o rascunho pelo
// mesmo salvar_fluxo_voz. A aba Roteiro mostra a contagem; "Corrigir N pontos" leva à primeira.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Play, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Loading, Notice } from '@/components/app-shell';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { Aviso, Botao, Passos, Pilula, Vazio } from '@/components/voz/ui';
import {
	ORDEM_TIPOS, SITUACOES, TIPOS, TIPOS_AGENTE, comoCorrigir, correcaoDe, dataCurta, estadoEnvio, explicar, impedem, nomesEtapas, novoBloco, numerosRoteiro, removerBloco, resumoPendencias, roteiro, trocarBloco,
	type Bloco, type Correcao, type Definicao, type Pendencia, type TipoBloco,
} from '@/lib/fluxo';
import { ConfirmaCorrecao, OQueCorrigir, type AcaoCorrigir } from './corrigir';
import { BarraEnvio, LegendaModos, Quadro, type Marca } from './quadro';
import { Roteiro } from './roteiro';
import { AbaRespostas, AbaTestes, AbaVersoes, AbasEditor, abaDaUrl, type AbaEditor } from './abas-editor';
import { GavetaEtapa } from './etapa';
import { Acoes, Gaveta, Linhas, Regras } from './ds';
import { EmQualquerMomento, FaixaTravas } from './travas';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { GavetaAlcada, GavetaComoLer, executar, mensagem, useCarregar, useNomeCarteira } from './comum';
import { GavetaDescrever } from './lista';

const PASSOS = [
	{ id: 'rascunho', nome: 'Rascunho', desc: 'Quem edita canais' },
	{ id: 'aprovado_empresa', nome: 'Aprovado pela empresa', desc: 'Quem aprova roteiro de voz' },
	{ id: 'em_uso', nome: 'Em uso', desc: 'Entra na próxima ligação' },
];

export function EditorFluxo({ versaoId }: { versaoId: number }) {
	const { api, empresa, rota } = useFluxo();
	const perm = usePermissoesFluxo();
	const navigate = useNavigate();
	const nomeCarteira = useNomeCarteira();
	const [busca, setBusca] = useSearchParams();
	const aba = abaDaUrl(busca.get('aba'));
	const [gaveta, setGaveta] = useState<null | 'paleta' | 'pendencias' | 'modos' | 'descrever' | 'alcada' | { etapa: string }>(() => {
		const e = busca.get('etapa');
		return e && /^N\d{1,3}$/.test(e) ? { etapa: e } : null;
	});
	/** Abre a gaveta da etapa e guarda em ?etapa= (link direto para a etapa); fechar tira da URL. */
	function abrirEtapa(id: string | null) {
		setGaveta(id ? { etapa: id } : null);
		setBusca(q => { const n = new URLSearchParams(q); if (id) n.set('etapa', id); else n.delete('etapa'); return n; }, { replace: true });
	}
	function trocarAba(a: AbaEditor) {
		setBusca(q => { const n = new URLSearchParams(q); if (a === 'roteiro') n.delete('aba'); else n.set('aba', a); n.delete('etapa'); return n; });
		setGaveta(null);
	}
	const [ocupado, setOcupado] = useState(false);
	const [confirma, setConfirma] = useState<null | 'aprovar' | 'usar'>(null);
	const [correcao, setCorrecao] = useState<Correcao | null>(null);

	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api || !empresa) return null;
		const v = await api.versao(versaoId);
		if (!v) return { v: null } as const;
		const [f, versoes, conectores, intencoes, bloqueios, avisos, alcada, identidade] = await Promise.all([
			api.fluxo(v.fluxo_id), api.versoesDoFluxo(v.fluxo_id), api.conectores(empresa.id).catch(() => []), api.intencoes().catch(() => []),
			api.bloqueios(v.id), api.avisos(v.id).catch(() => [] as string[]), api.alcada(empresa.id, v.credor_id).catch(() => null),
			// SQL 88: quem confere a identidade na carteira (banco sem o SQL 88: undefined, e o Roteiro fica como antes)
			api.identidade(empresa.id, v.credor_id).then(x => x?.identidade ?? null).catch(() => undefined),
		]);
		return { v, f, versoes, conectores, intencoes, bloqueios, avisos, alcada, identidade };
	}, [api, empresa?.id, versaoId]);

	const marcas = useMemo(() => {
		const m = new Map<string, Marca>();
		for (const e of (dados?.v ? [...dados.bloqueios, ...dados.avisos] : []).map(explicar)) if (e.bloco) m.set(e.bloco, e.impede ? 'erro' : (m.get(e.bloco) ?? 'atencao'));
		return m;
	}, [dados]);

	const cab = (extra?: { titulo?: string }) => <CabecalhoAgente titulo={extra?.titulo ?? 'Editor do fluxo'} />;
	if (!empresa) return <>{cab()}<Notice variant="warning">Escolha a empresa no topo para ver esta página.</Notice></>;
	if (!perm.ver) return <>{cab()}<Vazio titulo="Seu perfil não vê os fluxos do agente.">Precisa da permissão Editar canais ou Aprovar roteiro de voz.</Vazio></>;
	if (carregando && !dados) return <>{cab()}<Loading /></>;
	if (erro && !dados) return <>{cab()}<Notice>{erro}</Notice></>;
	if (!dados?.v || !dados.f) return <>{cab()}<Vazio titulo="Versão não encontrada." acao={<Botao secundario onClick={() => navigate(rota('lista'))}>Voltar aos fluxos</Botao>}>Ela pode ser de outra empresa ou ter sido apagada.</Vazio></>;

	const { v, f, versoes, conectores, intencoes, bloqueios, avisos, alcada, identidade } = dados;
	const def = v.definicao;
	const emUso = versoes.find(x => x.situacao === 'em_uso') ?? null;
	const rascunhoAberto = versoes.find(x => x.situacao === 'rascunho' && x.id !== v.id) ?? null;
	const editavel = perm.editar && v.situacao !== 'arquivado' && !(v.situacao !== 'rascunho' && rascunhoAberto);
	const pend = impedem(bloqueios);
	// "O que corrigir" (PR4): pendências por etapa, dentro do cartão e da gaveta; as do fluxo (alçada, casos, personas) no topo do roteiro
	const todas = [...bloqueios, ...avisos].map(explicar);
	const ids = new Set(def.blocos.map(b => b.id));
	const porBloco = new Map<string, Pendencia[]>();
	for (const e of todas) if (e.bloco && ids.has(e.bloco)) porBloco.set(e.bloco, [...(porBloco.get(e.bloco) ?? []), e]);
	const doFluxo = todas.filter(e => !e.bloco || !ids.has(e.bloco));
	const estado = estadoEnvio({ situacao: v.situacao, erros: bloqueios, sujo: false, podeEditar: perm.editar, validando: ocupado, enviadoEm: v.enviado_aprovacao_em });
	const ixPasso = v.situacao === 'em_uso' ? 2 : v.situacao === 'aprovado_empresa' ? 1 : v.situacao === 'arquivado' ? 3 : 0;

	/** Salva a definição. Rascunho: no lugar. Aprovada ou em uso: vira rascunho novo e o editor abre nele. */
	async function salvarDef(nova: Definicao, ok: string): Promise<boolean> {
		if (!api || !empresa) return false;
		setOcupado(true);
		try {
			const id = await api.salvarFluxo({ empresa: empresa.id, credor: f!.credor_id, nome: null, tipo: null, definicao: nova, versao: v!.id });
			toast.success(id !== v!.id ? `${ok} Criada a v${Math.max(...versoes.map(x => x.versao)) + 1} (rascunho); a versão em uso continua valendo.` : ok);
			if (id !== v!.id) navigate(rota('editor', id)); else await recarregar();
			return true;
		} catch (e) { toast.error(mensagem(e)); return false; } finally { setOcupado(false); }
	}
	async function adicionar(tipo: TipoBloco) {
		const b = novoBloco(tipo, def.blocos);
		if (await salvarDef({ ...def, blocos: [...def.blocos, b] }, `${TIPOS[tipo].nome} adicionada ao rascunho.`)) setGaveta({ etapa: b.id });
	}
	async function enviar() {
		if (!api) return;
		setOcupado(true);
		await executar(() => api.enviar(v!.id), 'Enviado. Quem aprova recebeu o aviso no sino.');
		setOcupado(false); void recarregar();
	}
	async function avancar(qual: 'aprovar' | 'usar') {
		if (!api) return;
		setOcupado(true);
		await executar(() => (qual === 'aprovar' ? api.aprovar(v!.id, null) : api.usar(v!.id)), qual === 'aprovar' ? 'Aprovado pela empresa. Falta colocar em uso.' : `v${v!.versao} em uso a partir da próxima ligação.`);
		setOcupado(false); setConfirma(null); void recarregar();
	}

	/** Botão do "O que corrigir": correção de um clique (antes → depois e confirmar) ou atalho para quem resolve. */
	function acao(codigo: string): AcaoCorrigir | null {
		const base = codigo.split(':')[0];
		if (base === 'sem_alcada') return { rotulo: 'Cadastrar alçada', onClick: () => setGaveta('alcada') };
		if (base === 'caso_falhou') return { rotulo: 'Ver nos Testes', onClick: () => trocarAba('testes') };
		if (base.startsWith('roleplay_')) return { rotulo: 'Testar com personas', onClick: () => navigate(rota('personas', null, { versao: v!.id })) };
		if (!editavel) return null;
		const c = correcaoDe(def, codigo, { conectores });
		return c ? { rotulo: c.botao, onClick: () => setCorrecao(c) } : null;
	}
	async function aplicar(c: Correcao) {
		if (!(await salvarDef(c.definicao, `Corrigido no rascunho. ${c.resumo}`))) return;
		setCorrecao(null);
		if (c.bloco && !c.definicao.blocos.some(b => b.id === c.bloco)) abrirEtapa(null);
	}
	/** "Corrigir N pontos": vai ao Roteiro e rola até a primeira etapa com pendência (na ordem da conversa). */
	function irParaPrimeira() {
		const nums = numerosRoteiro(roteiro(def));
		const primeira = pend.map(p => p.bloco).filter((b): b is string => !!b && nums.has(b)).sort((a, b) => (nums.get(a) ?? 0) - (nums.get(b) ?? 0))[0];
		trocarAba('roteiro');
		setTimeout(() => document.getElementById(primeira && !doFluxo.some(e => e.impede) ? `etapa-${primeira}` : 'pendencias-fluxo')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
	}

	const nomes = nomesEtapas(def);
	const etapaSel = gaveta && typeof gaveta === 'object' ? def.blocos.find(b => b.id === gaveta.etapa) ?? null : null;
	const grupos = ['Conversa', 'Integração', 'Controle'] as const;

	return (
		<>
			<CabecalhoAgente
				titulo={`${f.nome} · ${nomeCarteira(f.credor_id)}`}
				titleExtra={<Pilula tom={SITUACOES[v.situacao].tom}>v{v.versao} {SITUACOES[v.situacao].nome}</Pilula>}
				desc={`${TIPOS_AGENTE[f.tipo_agente]}. ${emUso && emUso.id !== v.id ? `Em uso: v${emUso.versao}. A v${v.versao} só entra na próxima ligação depois de aprovada e colocada em uso.` : emUso ? `Em uso desde ${dataCurta(emUso.em_uso_em)}.` : 'Nenhuma versão em uso nesta carteira ainda.'}`}
				acoes={<BarraEnvio situacao={v.situacao} estado={estado} podeEditar={perm.editar} podeAprovar={perm.aprovar} ocupado={ocupado}
					onEnviar={() => void enviar()} onAprovar={() => setConfirma('aprovar')} onUsar={() => setConfirma('usar')} />}
			/>
			<div className="space-y-4">
				{v.situacao === 'arquivado'
					? <Aviso tom="neutro" titulo="Versão arquivada.">Fica só para consulta. Quem aprova pode voltar para ela na lista de fluxos.</Aviso>
					: <Passos passos={PASSOS} atual={ixPasso} />}
				{v.situacao !== 'rascunho' && rascunhoAberto && perm.editar && (
					<Aviso tom="info" titulo={`Há um rascunho (v${rascunhoAberto.versao}) deste fluxo.`}>As mudanças são feitas nele. <button type="button" className="font-semibold underline" onClick={() => navigate(rota('editor', rascunhoAberto.id))}>Abrir o rascunho</button></Aviso>
				)}
				{v.situacao === 'rascunho' && v.enviado_aprovacao_em && <Aviso tom="info" titulo={`Enviado para aprovação em ${dataCurta(v.enviado_aprovacao_em)}.`}>Mudar uma etapa cancela o envio: quem aprova precisa ver a versão nova.</Aviso>}
				{pend.length > 0 ? (
					<Aviso tom="erro" titulo={`${pend.length} ${pend.length === 1 ? 'pendência impede' : 'pendências impedem'} o envio para aprovação.`}>
						{resumoPendencias(pend.map(p => p.codigo))} <button type="button" className="ml-1 font-semibold underline" onClick={irParaPrimeira}>Corrigir {pend.length} {pend.length === 1 ? 'ponto' : 'pontos'}</button> <button type="button" className="ml-1 font-semibold underline" onClick={() => setGaveta('pendencias')}>Ver a lista</button>
					</Aviso>
				) : avisos.length > 0 ? (
					<Aviso tom="atencao" titulo="Antes de aprovar:">{avisos.map(a => explicar(a).texto).join(' ')} <button type="button" className="ml-1 font-semibold underline" onClick={() => navigate(rota('personas', null, { versao: v.id }))}>Testar com personas</button></Aviso>
				) : v.situacao === 'rascunho' ? <Aviso tom="ok" titulo="Nada impede o envio.">O validador, os conectores, a alçada e os casos de teste estão em dia.</Aviso> : null}

			</div>

			<div className="mt-5">
				<AbasEditor atual={aba} onTrocar={trocarAba} contagens={{ roteiro: pend.length }} />
				{aba === 'roteiro' ? (
					<div className="space-y-4">
						<FaixaTravas />
						{doFluxo.length > 0 && (
							<div id="pendencias-fluxo" className="scroll-mt-20 space-y-2" aria-label="O que corrigir no fluxo">
								{doFluxo.map(e => <OQueCorrigir key={e.codigo} fluxo impede={e.impede} texto={e.texto} como={comoCorrigir(e.codigo)} acao={acao(e.codigo)} />)}
							</div>
						)}
						<div className="flex flex-wrap items-center justify-between gap-2">
							<LegendaModos />
							<Acoes>
								{editavel && <Botao secundario onClick={() => setGaveta('paleta')} disabled={ocupado}><Plus size={14} aria-hidden /> Etapa</Botao>}
								{perm.editar && <Botao secundario onClick={() => setGaveta('descrever')}><Sparkles size={14} aria-hidden /> Descrever mudanças</Botao>}
								<Botao onClick={() => navigate(rota('testar', null, { versao: v.id }))}><Play size={14} aria-hidden /> Testar conversa</Botao>
								<button type="button" onClick={() => setGaveta('modos')} className="inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Como ler</button>
							</Acoes>
						</div>
						<EmQualquerMomento />
						{def.blocos.length ? <Roteiro definicao={def} marcas={marcas} onAbrir={abrirEtapa} pendencias={porBloco} acao={acao} identidade={identidade} onMudarIdentidade={() => navigate(rota('identidade'))} />
							: <Vazio titulo="Fluxo sem etapas.">Use "+ Etapa" para começar pela Abertura.</Vazio>}
					</div>
				) : aba === 'mapa' ? (
					<div className="space-y-3">
						<Aviso tom="neutro" titulo="O mapa é para enxergar o desenho inteiro.">Para ler e editar a conversa, use o <button type="button" className="font-semibold underline" onClick={() => trocarAba('roteiro')}>Roteiro</button>. Toque numa etapa para abrir.</Aviso>
						<LegendaModos />
						{def.blocos.length ? <Quadro definicao={def} marcas={marcas} onAbrir={abrirEtapa} pendencias={porBloco} identidade={identidade} />
							: <Vazio titulo="Fluxo sem etapas.">Comece pelo Roteiro.</Vazio>}
					</div>
				) : aba === 'respostas' ? <AbaRespostas versao={v.id} definicao={def} onAbrirEtapa={abrirEtapa} />
					: aba === 'testes' ? <AbaTestes versao={v.id} fluxo={f.id} pendencias={{ casos: bloqueios.filter(c => c.startsWith('caso_falhou')).length, avisos: avisos.map(a => explicar(a).texto) }} />
					: <AbaVersoes v={v} versoes={versoes} onAbrir={id => navigate(rota('editor', id))} />}
			</div>

			{etapaSel && (
				<GavetaEtapa bloco={etapaSel} definicao={def} conectores={conectores} intencoes={intencoes} erros={[...bloqueios, ...avisos]} editavel={editavel}
					versao={v.id} situacao={v.situacao} onFechar={() => abrirEtapa(null)} acao={acao}
					onSalvar={(b: Bloco) => salvarDef(trocarBloco(def, b), `Etapa ${b.id} salva no rascunho.`)}
					onRemover={id => salvarDef(removerBloco(def, id), `Etapa ${id} removida do rascunho.`)} />
			)}
			<Gaveta aberta={gaveta === 'paleta'} onFechar={() => setGaveta(null)} titulo="Adicionar etapa" sub={'Entra no roteiro como rascunho, em "Etapas que nenhum caminho alcança". Depois, ligue uma resposta de outra etapa a ela.'}>
				{grupos.map(g => (
					<div key={g}>
						<b className="text-[12.5px] font-semibold">{g}</b>
						<div className="mt-1.5 flex flex-wrap gap-1.5">
							{ORDEM_TIPOS.filter(t => TIPOS[t].grupo === g).map(t => (
								<button key={t} type="button" disabled={ocupado} onClick={() => void adicionar(t)} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12.5px] font-semibold text-[var(--base-texto)] hover:bg-[var(--base-fill)] disabled:opacity-50" style={{ borderColor: 'var(--base-borda)' }}>
									<Plus size={13} aria-hidden />{TIPOS[t].nome}
								</button>
							))}
						</div>
					</div>
				))}
			</Gaveta>
			<Gaveta aberta={gaveta === 'pendencias'} onFechar={() => setGaveta(null)} titulo={`Pendências da v${v.versao}`} sub={`${pend.length} ${pend.length === 1 ? 'impede' : 'impedem'} o envio para aprovação${avisos.length ? ` · ${avisos.length} ${avisos.length === 1 ? 'aviso' : 'avisos'}` : ''}`}>
				<Linhas itens={[...bloqueios, ...avisos].map(explicar).map(p => ({
					e: <><Pilula tom={p.impede ? 'erro' : 'atencao'}>{p.impede ? 'impede' : 'atenção'}</Pilula> <b className="font-semibold">{p.bloco ? nomes.get(p.bloco) ?? 'Etapa que não existe mais' : 'Fluxo'}</b></>,
					s: <>{p.texto}{comoCorrigir(p.codigo) && <span className="block text-[var(--base-texto-3)]">O que corrigir: {comoCorrigir(p.codigo)}</span>}</>,
					d: (() => {
						const a = acao(p.codigo);
						const lk = 'text-[12.5px] font-semibold text-[var(--destaque)]';
						return (
							<span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
								{a && <button type="button" className={lk} onClick={a.onClick}>{p.bloco ? 'Corrigir' : a.rotulo}</button>}
								{p.bloco && <button type="button" className={lk} onClick={() => abrirEtapa(p.bloco!)}>Abrir</button>}
							</span>
						);
					})(),
				}))} />
				<Regras itens={[['Conectores e intenções do catálogo são da equipe MotorCX.', 'Conector em rascunho ou pausado segura a aprovação até ser testado e ativado (Empresa › Integrações › Conectores do CRM).'], ['Testar com personas é aviso, nunca bloqueio.', 'Sem lote, o envio mostra o aviso "sem teste com personas", mas não segura.']]} />
			</Gaveta>
			<ConfirmaCorrecao correcao={correcao} ocupado={ocupado} onConfirmar={c => void aplicar(c)} onFechar={() => setCorrecao(null)} />
			<GavetaComoLer aberta={gaveta === 'modos'} onFechar={() => setGaveta(null)} />
			<GavetaDescrever aberta={gaveta === 'descrever'} onFechar={() => setGaveta(null)} versaoOrigem={v.id} credorFixo={f.credor_id} aoPedir={id => navigate(rota('pedido', id))} />
			<GavetaAlcada aberta={gaveta === 'alcada'} onFechar={() => setGaveta(null)} credor={f.credor_id} alcada={alcada} aoSalvar={() => void recarregar()} />
			<ConfirmaAcao
				aberto={confirma != null}
				titulo={confirma === 'usar' ? `Colocar a v${v.versao} em uso?` : `Aprovar a v${v.versao}?`}
				texto={confirma === 'usar' ? `Vale a partir da próxima ligação${emUso && emUso.id !== v.id ? `; a v${emUso.versao} vai para o arquivo (nada é apagado)` : ''}. Fica registrado quem colocou em uso.` : 'A aprovação fica registrada com o seu nome. Depois, quem tem a mesma permissão coloca a versão em uso.'}
				botao={confirma === 'usar' ? 'Colocar em uso' : 'Aprovar'}
				onConfirm={() => confirma && void avancar(confirma)}
				onClose={() => setConfirma(null)}
				loading={ocupado}
			/>
		</>
	);
}
