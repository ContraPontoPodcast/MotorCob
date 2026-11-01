// Tela 2 · Agente virtual › Editor do fluxo. Quadro por ramos (caminho principal em cima, ramos embaixo, saídas "→ N5").
// Cada mudança de etapa salva o rascunho (salvar_fluxo_voz: rascunho edita no lugar; versão aprovada ou em uso vira
// rascunho novo). As pendências vêm do banco: fluxo_voz_bloqueios (validador + conectores + alçada + intenções + casos
// de teste) e fluxo_voz_avisos (roleplay, só aviso). "Enviar para aprovação" (enviar_fluxo_voz_aprovacao, SQL 65)
// fica desabilitado com o motivo enquanto houver pendência. Aprovar: aprovar_fluxo_voz; colocar em uso: usar_fluxo_voz.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Loading, Notice } from '@/components/app-shell';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { Aviso, Botao, Passos, Pilula, Vazio } from '@/components/voz/ui';
import {
	ORDEM_TIPOS, SITUACOES, TIPOS, TIPOS_AGENTE, TRAVAS, dataCurta, estadoEnvio, explicar, impedem, novoBloco, removerBloco, resumoPendencias, trocarBloco,
	type Bloco, type Definicao, type TipoBloco,
} from '@/lib/fluxo';
import { BarraEnvio, LegendaModos, Quadro, type Marca } from './quadro';
import { GavetaEtapa } from './etapa';
import { Acoes, Gaveta, Linhas, Regras, Seg, Selo } from './ds';
import { CabecalhoAgente } from './cabecalho';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { GavetaAlcada, GavetaComoLer, GavetaTravas, executar, mensagem, useCarregar, useNomeCarteira } from './comum';
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
	const [vista, setVista] = useState<'quadro' | 'lista'>('quadro');
	const [gaveta, setGaveta] = useState<null | 'paleta' | 'pendencias' | 'travas' | 'modos' | 'versoes' | 'descrever' | 'alcada' | { etapa: string }>(null);
	const [ocupado, setOcupado] = useState(false);
	const [confirma, setConfirma] = useState<null | 'aprovar' | 'usar'>(null);

	const { dados, erro, carregando, recarregar } = useCarregar(async () => {
		if (!api || !empresa) return null;
		const v = await api.versao(versaoId);
		if (!v) return { v: null } as const;
		const [f, versoes, conectores, intencoes, bloqueios, avisos, alcada] = await Promise.all([
			api.fluxo(v.fluxo_id), api.versoesDoFluxo(v.fluxo_id), api.conectores(empresa.id).catch(() => []), api.intencoes().catch(() => []),
			api.bloqueios(v.id), api.avisos(v.id).catch(() => [] as string[]), api.alcada(empresa.id, v.credor_id).catch(() => null),
		]);
		return { v, f, versoes, conectores, intencoes, bloqueios, avisos, alcada };
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

	const { v, f, versoes, conectores, intencoes, bloqueios, avisos, alcada } = dados;
	const def = v.definicao;
	const emUso = versoes.find(x => x.situacao === 'em_uso') ?? null;
	const rascunhoAberto = versoes.find(x => x.situacao === 'rascunho' && x.id !== v.id) ?? null;
	const editavel = perm.editar && v.situacao !== 'arquivado' && !(v.situacao !== 'rascunho' && rascunhoAberto);
	const pend = impedem(bloqueios);
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
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Botao secundario onClick={() => navigate(rota('testar', null, { versao: v.id }))}>Testar conversa</Botao>
				<Botao secundario onClick={() => navigate(rota('personas', null, { versao: v.id }))}>Testar com personas</Botao>
				{perm.editar && <button type="button" onClick={() => setGaveta('descrever')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"><Sparkles size={15} aria-hidden /> Descrever mudanças</button>}
			</div>

			<div className="space-y-4">
				{v.situacao === 'arquivado'
					? <Aviso tom="neutro" titulo="Versão arquivada.">Fica só para consulta. Quem aprova pode voltar para ela na lista de fluxos.</Aviso>
					: <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Passos passos={PASSOS} atual={ixPasso} /></div><Botao secundario onClick={() => setGaveta('versoes')}>Versões</Botao></div>}
				{v.situacao !== 'rascunho' && rascunhoAberto && perm.editar && (
					<Aviso tom="info" titulo={`Há um rascunho (v${rascunhoAberto.versao}) deste fluxo.`}>As mudanças são feitas nele. <button type="button" className="font-semibold underline" onClick={() => navigate(rota('editor', rascunhoAberto.id))}>Abrir o rascunho</button></Aviso>
				)}
				{v.situacao === 'rascunho' && v.enviado_aprovacao_em && <Aviso tom="info" titulo={`Enviado para aprovação em ${dataCurta(v.enviado_aprovacao_em)}.`}>Mudar uma etapa cancela o envio: quem aprova precisa ver a versão nova.</Aviso>}
				{pend.length > 0 ? (
					<Aviso tom="erro" titulo={`${pend.length} ${pend.length === 1 ? 'pendência impede' : 'pendências impedem'} o envio para aprovação.`}>
						{resumoPendencias(pend.map(p => p.codigo))} <button type="button" className="ml-1 font-semibold underline" onClick={() => setGaveta('pendencias')}>Ver pendências</button>
					</Aviso>
				) : avisos.length > 0 ? (
					<Aviso tom="atencao" titulo="Antes de aprovar:">{avisos.map(a => explicar(a).texto).join(' ')} <button type="button" className="ml-1 font-semibold underline" onClick={() => navigate(rota('personas', null, { versao: v.id }))}>Testar com personas</button></Aviso>
				) : v.situacao === 'rascunho' ? <Aviso tom="ok" titulo="Nada impede o envio.">O validador, os conectores, a alçada e os casos de teste estão em dia.</Aviso> : null}

				<div className="flex flex-wrap items-center justify-between gap-2">
					<Seg rotulo="Visualização" valor={vista} onChange={setVista} itens={[{ v: 'quadro', n: 'Quadro por ramos' }, { v: 'lista', n: 'Lista' }]} />
					<Acoes>
						{editavel && <Botao secundario onClick={() => setGaveta('paleta')} disabled={ocupado}><Plus size={14} aria-hidden /> Adicionar etapa</Botao>}
						<button type="button" onClick={() => setGaveta('modos')} className="inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-semibold text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]">Como ler</button>
						<Selo onClick={() => setGaveta('travas')}>Regras fixas ({TRAVAS.length})</Selo>
					</Acoes>
				</div>
				<LegendaModos />
				{def.blocos.length ? <Quadro definicao={def} marcas={marcas} vista={vista} onAbrir={id => setGaveta({ etapa: id })} />
					: <Vazio titulo="Fluxo sem etapas.">Use "Adicionar etapa" para começar pela Abertura.</Vazio>}
			</div>

			{etapaSel && (
				<GavetaEtapa bloco={etapaSel} definicao={def} conectores={conectores} intencoes={intencoes} erros={[...bloqueios, ...avisos]} editavel={editavel}
					versao={v.id} situacao={v.situacao} onFechar={() => setGaveta(null)}
					onSalvar={(b: Bloco) => salvarDef(trocarBloco(def, b), `Etapa ${b.id} salva no rascunho.`)}
					onRemover={id => salvarDef(removerBloco(def, id), `Etapa ${id} removida do rascunho.`)} />
			)}
			<Gaveta aberta={gaveta === 'paleta'} onFechar={() => setGaveta(null)} titulo="Adicionar etapa" sub="Entra no quadro como rascunho, sem ligação. Depois, ligue as saídas.">
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
					e: <><Pilula tom={p.impede ? 'erro' : 'atencao'}>{p.impede ? 'impede' : 'atenção'}</Pilula> <b className="font-semibold">{p.bloco ? `${p.bloco} · ${tituloDe(def, p.bloco)}` : 'Fluxo'}</b></>,
					s: p.texto,
					d: p.bloco ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => setGaveta({ etapa: p.bloco! })}>Abrir</button>
						: p.codigo === 'sem_alcada' ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => setGaveta('alcada')}>Alçada</button>
						: p.codigo.startsWith('caso_falhou') ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => navigate(rota('testar', null, { versao: v.id }))}>Testar</button>
						: p.codigo.startsWith('roleplay') ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => navigate(rota('personas', null, { versao: v.id }))}>Personas</button> : null,
				}))} />
				<Regras itens={[['Conectores e intenções do catálogo são da equipe MotorCX.', 'Conector em rascunho ou pausado segura a aprovação até ser testado e ativado (Empresa › Integrações › Conectores do CRM).'], ['Testar com personas é aviso, nunca bloqueio.', 'Sem lote, o envio mostra o aviso "sem teste com personas", mas não segura.']]} />
			</Gaveta>
			<GavetaTravas aberta={gaveta === 'travas'} onFechar={() => setGaveta(null)} />
			<GavetaComoLer aberta={gaveta === 'modos'} onFechar={() => setGaveta(null)} />
			<Gaveta aberta={gaveta === 'versoes'} onFechar={() => setGaveta(null)} titulo="Versões" sub="Voltar para uma versão arquivada fica na lista de fluxos (quem aprova).">
				<Linhas itens={versoes.map(x => ({
					e: <><b className="font-semibold">v{x.versao}</b> · {SITUACOES[x.situacao].nome}{x.id === v.id ? ' · aberta' : ''}</>,
					s: x.motivo ?? dataCurta(x.atualizado_em ?? x.criado_em),
					d: x.id !== v.id ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => { setGaveta(null); navigate(rota('editor', x.id)); }}>Abrir</button> : null,
				}))} />
			</Gaveta>
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

function tituloDe(d: Definicao, id: string) {
	const b = d.blocos.find(x => x.id === id);
	return b ? (b.titulo || TIPOS[b.tipo]?.nome) : 'etapa removida';
}
