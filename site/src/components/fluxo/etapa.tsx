// Detalhe da etapa (editor; PR5 do redesenho, SPEC §2.3): o modo em 4 cartões, "O agente diz" com as variáveis em
// destaque, "Como soa no telefone" (valores e datas por extenso; "Ouvir" usa a prévia de voz que já existe, SQL 66) e as
// checagens da fala; "O cliente pode responder" com exemplos e "então → etapa"; "Se não entender" e "Se não ouvir nada"
// com fala própria, vezes e destino (SQL 95); "Avançado" com certeza em palavras e os
// códigos internos. Os campos seguem o esquema 1 de public.fluxo_voz_erros: o que o banco recusa aparece nas
// pendências depois de salvar. A trava 1 (valor, oferta ou credor antes da identidade) é conferida aqui enquanto se
// digita (validarLocal, cópia do validador) e aparece como "O que corrigir". Na IA conversa, a base de respostas
// (salvar_resposta_fluxo_voz; revisa quem aprova).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Play, Trash2, X } from 'lucide-react';
import { ConfirmaAcao } from '@/components/comuns/confirma-acao';
import { Botao, Pilula, campoCls, campoStyle } from '@/components/voz/ui';
import {
	CERTEZAS, MODOS, OPCOES, TIPOS, acaoSistema, antesDaIdentidade, caminhosPara, cartoesModo, certezaEmPalavras, checarFala, comoCorrigir, correcaoDe, exemplosDaSaida, explicar, nomeDestino, nomesEtapas, resultadoFinal,
	saidasPossiveis, seNaoEntender, seNaoOuvir, tipoDaSaida, variaveisDoTexto, VARIAVEIS_SENSIVEIS, trocarBloco, validarLocal, variaveisSensiveis,
	type Bloco, type Correcao, type Definicao, type Saida,
} from '@/lib/fluxo';
import { comoSoa, preencherTeste, trechosFalados, valoresTeste } from '@/lib/falado';
import type { ConectorRow, IntencaoRow, RespostaRow } from './api';
import { Campo, Detalhes, Gaveta, Linhas } from './ds';
import { useFluxo, usePermissoesFluxo } from './contexto';
import { CartoesModo, ChecagensFala, ComoSoa, FalaDoAgente, QuadroRepeticao, Secao, SeloTrava } from './etapa-partes';
import { Fala, ModoChip } from './roteiro';
import { executar, useCarregar } from './comum';
import { ConfirmaCorrecao, OQueCorrigir, type AcaoCorrigir } from './corrigir';

export { OQueCorrigir };

const sel = `${campoCls} w-full`;
const FINALIDADES: Record<string, string> = { buscar_ofertas: 'Buscar ofertas', validar_cadastro: 'Validar cadastro', registrar_acordo: 'Registrar acordo', gerar_boleto: 'Gerar boleto', gerar_link: 'Gerar link', outro: 'Outro' };
export const nomeFinalidade = (f: string) => FINALIDADES[f] ?? f;
const slug = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(?![a-z])/, 'o_').slice(0, 40) || 'opcao';

function Opcoes({ lista, valor, onChange, disabled, vazio }: { lista: readonly (readonly [string, string])[]; valor: unknown; onChange: (v: string) => void; disabled?: boolean; vazio?: string }) {
	return (
		<select value={valor == null ? '' : String(valor)} disabled={disabled} onChange={e => onChange(e.target.value)} className={sel} style={campoStyle}>
			{vazio != null && <option value="">{vazio}</option>}
			{lista.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
		</select>
	);
}

function Marcar({ lista, valor, onChange, disabled, travado }: { lista: readonly (readonly [string, string])[]; valor: string[]; onChange: (v: string[]) => void; disabled?: boolean; travado?: string }) {
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-1.5">
			{lista.map(([k, n]) => (
				<label key={k} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--base-texto)]">
					<input type="checkbox" className="accent-[var(--destaque)]" checked={valor.includes(k) || k === travado} disabled={disabled || k === travado}
						onChange={e => onChange(e.target.checked ? [...valor, k] : valor.filter(x => x !== k))} />{n}
				</label>
			))}
		</div>
	);
}

function SelConector({ conectores, finalidades, valor, onChange, disabled }: { conectores: ConectorRow[]; finalidades?: string[]; valor: unknown; onChange: (v: number | null) => void; disabled?: boolean }) {
	const lista = conectores.filter(c => !finalidades || finalidades.includes(c.finalidade));
	return (
		<select value={valor == null ? '' : String(valor)} disabled={disabled} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} className={sel} style={campoStyle}>
			<option value="">— escolher —</option>
			{lista.map(c => <option key={c.id} value={c.id}>C{c.id} · {c.nome}{c.situacao !== 'ativo' ? ` (${c.situacao})` : ''}</option>)}
		</select>
	);
}

/** Tipos que já tinham "tentativas": as vezes de "Se não entender" continuam nesse campo (um número só). */
const COM_TENTATIVAS: readonly string[] = ['identidade', 'pergunta', 'intencao'];
/** Saídas que só acontecem quando o agente não entende ou não ouve: ficam nos quadros "Se não entender" e "Se não
 *  ouvir nada", não em "O cliente pode responder". */
const SO_SEM_ENTENDER = ['nao_entendido', 'sem_resposta'];
const SO_SEM_OUVIR = 'silencio';
/** Campo da fala de cada tipo (o conector tem a fala de espera; condição e registrar não falam; a IA conversa tem objetivo). */
const chaveFala = (tipo: string) => (tipo === 'conector' ? 'fala_espera' : ['condicao', 'registrar', 'generativa'].includes(tipo) ? null : 'fala');

/**
 * Detalhe da etapa (PR5 do redesenho; SPEC §2.3). Na ordem: O que corrigir · 1 Como o agente decide (4 cartões) ·
 * 2 O agente diz (variáveis, Como soa, checagens) ou Objetivo da IA · 3 O cliente pode responder (exemplos e "então →")
 * · 4 Se não entender / Se não ouvir nada · Respostas prontas (IA conversa) · Avançado (tentativas, certeza, repetição
 * e os códigos internos). Todos os campos de antes continuam aqui; só mudou o lugar e o nome.
 */
export function GavetaEtapa({ bloco, definicao, conectores, intencoes, erros, editavel, versao, situacao, onFechar, onSalvar, onRemover, acao, carteira, onTestar }: {
	bloco: Bloco; definicao: Definicao; conectores: ConectorRow[]; intencoes: IntencaoRow[]; erros: string[]; editavel: boolean;
	versao: number; situacao: string; onFechar: () => void; onSalvar: (b: Bloco) => Promise<boolean>; onRemover: (id: string) => Promise<boolean>;
	/** Botão do "O que corrigir" (correção de um clique sobre o rascunho salvo). */
	acao?: (codigo: string) => AcaoCorrigir | null;
	/** Nome da carteira, para o "Como soa" (o credor de teste). */
	carteira?: string | null;
	/** "Testar conversa" ao lado (PR6). */
	onTestar?: () => void;
}) {
	const { api, empresa } = useFluxo();
	const perm = usePermissoesFluxo();
	const [b, setB] = useState<Bloco>(bloco);
	const [ocupado, setOcupado] = useState(false);
	useEffect(() => { setB(bloco); }, [bloco]);
	const p = b.params ?? {};
	const setP = (k: string, v: unknown) => setB(x => ({ ...x, params: { ...x.params, [k]: v } }));
	const final = !!TIPOS[b.tipo]?.final;
	const outros = definicao.blocos.filter(x => x.id !== b.id);
	const nomes = useMemo(() => nomesEtapas(definicao), [definicao]);
	const nome = nomes.get(b.id) ?? b.id;
	const comB = useMemo(() => trocarBloco(definicao, b), [definicao, b]);
	// trava 1 ao digitar: a mesma regra do banco, sobre o rascunho desta gaveta (antes de salvar)
	const credorAntes = useMemo(() => validarLocal(comB).includes(`valor_antes_identidade:${b.id}`), [comB, b.id]);
	const antes = useMemo(() => { const a = comB.blocos.find(x => x.tipo === 'abertura'); return !!a && antesDaIdentidade(comB, a.id).has(b.id); }, [comB, b.id]);
	const meus = erros.map(explicar).filter(e => e.bloco === b.id && e.codigo.split(':')[0] !== 'valor_antes_identidade');
	const chegam = useMemo(() => caminhosPara(definicao, b.id), [definicao, b.id]);
	const [confirmaRemover, setConfirmaRemover] = useState(false);
	const dis = !editavel;
	// a correção de um clique parte do rascunho salvo: com mudança não salva na gaveta, o botão espera
	const sujo = useMemo(() => JSON.stringify(b) !== JSON.stringify(bloco), [b, bloco]);
	const botao = (codigo: string): AcaoCorrigir | null => {
		const a = editavel && acao ? acao(codigo) : null;
		return a && sujo ? { ...a, disabled: true, motivo: 'Salve a etapa antes: a correção parte do rascunho salvo.' } : a;
	};
	// trava 1 ao digitar: a correção vale sobre o texto da gaveta (antes de salvar); troca só o texto aqui
	const [previa, setPrevia] = useState<Correcao | null>(null);
	const botaoCredor = (): AcaoCorrigir | null => {
		if (!editavel) return null;
		if (!sujo) return botao(`valor_antes_identidade:${b.id}`);
		const c = correcaoDe(comB, `valor_antes_identidade:${b.id}`);
		return c ? { rotulo: c.botao, onClick: () => setPrevia(c) } : null;
	};

	// "O agente diz" → "Como soa": valores de teste (os do simulador) e números por extenso
	const kFala = chaveFala(b.tipo);
	const fala = kFala ? String(p[kFala] ?? '') : '';
	const vars = useMemo(() => valoresTeste((empresa?.nome ?? 'Assessoria de teste').replace(/\s*\(demonstração\)$/, ''), carteira ?? null), [empresa?.nome, carteira]);
	const preenchida = preencherTeste(fala, vars);
	const falada = comoSoa(preenchida);
	const checagens = kFala === 'fala' ? checarFala({ fala, falada, antesDaIdentidade: antes, credorAntes, sensiveis: variaveisSensiveis(b), trechos: trechosFalados(preenchida).filter(t => !/^\d{1,2}$/.test(t.de)) }) : [];
	async function ouvir() {
		if (!api) return;
		const r = await api.ouvir(versao, falada.slice(0, 500));
		if (!r.audio) throw new Error('Prévia sem áudio no modo de demonstração.');
		await new Audio(`data:${r.mime};base64,${r.audio}`).play();
	}

	// saídas: uma linha por saída possível (pergunta e intenção dependem das opções); a IA conversa tem lista própria
	const possiveis = useMemo(() => saidasPossiveis(b), [b]);
	function setSaida(quando: string, mudar: Partial<Saida> | null) {
		setB(x => {
			const atual = x.saidas.find(s => s.quando === quando);
			if (mudar === null || mudar.para === '') return { ...x, saidas: x.saidas.filter(s => s.quando !== quando) };
			const base: Saida = atual ?? { quando, rotulo: possiveis.find(s => s.quando === quando)?.rotulo ?? quando, para: '', tipo: tipoDaSaida(x, quando) };
			const nova = { ...base, ...mudar, tipo: tipoDaSaida(x, quando) };
			return { ...x, saidas: atual ? x.saidas.map(s => (s.quando === quando ? nova : s)) : [...x.saidas, nova] };
		});
	}
	const destino = (quando: string, rotulo?: string, vazio = '— sem saída —') => (
		<select aria-label={`Então, depois de "${rotulo ?? quando}"`} value={b.saidas.find(s => s.quando === quando)?.para ?? ''} disabled={dis} onChange={e => setSaida(quando, { para: e.target.value })} className={sel} style={campoStyle}>
			<option value="">{vazio}</option>
			{outros.map(o => <option key={o.id} value={o.id}>{nomes.get(o.id)}</option>)}
		</select>
	);

	async function salvar() {
		setOcupado(true);
		// saídas só com destino; rótulos dentro de 60
		const limpo: Bloco = { ...b, titulo: b.titulo?.trim() ? b.titulo.trim().slice(0, 60) : undefined, saidas: final ? [] : b.saidas.filter(s => s.para).map(s => ({ ...s, rotulo: (s.rotulo || s.quando).slice(0, 60) })) };
		if (!limpo.titulo) delete limpo.titulo;
		const ok = await onSalvar(limpo);
		setOcupado(false);
		if (ok) onFechar();
	}

	// campos próprios do tipo (iguais aos de antes): ficam junto da fala, em "Detalhes desta etapa"
	let campos: ReactNode = null;
	switch (b.tipo) {
		case 'identidade': campos = (<>
			<Campo rotulo="O que confere"><Opcoes lista={OPCOES.pergunta_identidade} valor={p.pergunta} disabled={dis} onChange={v => setP('pergunta', v)} /></Campo>
			<Campo inteiro rotulo="Conector que confere no CRM (Validar cadastro)" ajuda="Só o CRM confere a identidade, nunca a IA. Sem o conector, a aprovação fica pendente.">
				<SelConector conectores={conectores} finalidades={['validar_cadastro']} valor={p.conector_id} disabled={dis} onChange={v => setP('conector_id', v)} />
			</Campo>
		</>); break;
		case 'oferta': campos = (<>
			<Campo rotulo="De onde vem a oferta"><Opcoes lista={OPCOES.origem_oferta} valor={p.origem} disabled={dis} onChange={v => setP('origem', v)} /></Campo>
			{p.origem === 'conector' && <Campo rotulo="Conector (Buscar ofertas)"><SelConector conectores={conectores} finalidades={['buscar_ofertas']} valor={p.conector_id} disabled={dis} onChange={v => setP('conector_id', v)} /></Campo>}
		</>); break;
		case 'retorno': campos = <Campo rotulo="Até quantos dias (1 a 7)"><input type="number" min={1} max={7} value={Number(p.dias_max ?? 7)} disabled={dis} onChange={e => setP('dias_max', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>; break;
		case 'conector': campos = <Campo rotulo="Conector"><SelConector conectores={conectores} valor={p.conector_id} disabled={dis} onChange={v => setP('conector_id', v)} /></Campo>; break;
		case 'registrar': {
			const cs = (Array.isArray(p.conectores) ? p.conectores : []) as (number | null)[];
			campos = (<>
				<Campo rotulo="O que registra"><Opcoes lista={OPCOES.registra} valor={p.registra} disabled={dis} onChange={v => setP('registra', v)} /></Campo>
				{p.registra === 'acordo_crm' && [0, 1].map(i => (
					<Campo key={i} rotulo={i === 0 ? 'Conector do acordo' : 'Boleto ou link (opcional)'}>
						<SelConector conectores={conectores} finalidades={['registrar_acordo', 'gerar_boleto', 'gerar_link']} valor={cs[i] ?? null} disabled={dis} onChange={v => { const n = [cs[0] ?? null, cs[1] ?? null]; n[i] = v; setP('conectores', n.filter((x, j) => x != null || j === 0)); }} />
					</Campo>
				))}
			</>);
			break;
		}
		case 'link': campos = <Campo rotulo="Canal"><Opcoes lista={OPCOES.canal_link} valor={p.canal} disabled={dis} onChange={v => setP('canal', v)} /></Campo>; break;
		case 'condicao': campos = (<>
			<Campo rotulo="Campo"><Opcoes lista={OPCOES.campo_condicao} valor={p.campo} disabled={dis} onChange={v => { setP('campo', v); setP('valor', v === 'identidade_confirmada' ? true : 1); if (v === 'identidade_confirmada') setP('op', '='); }} /></Campo>
			<Campo rotulo="Comparação"><Opcoes lista={p.campo === 'identidade_confirmada' ? OPCOES.op.slice(0, 2) : OPCOES.op} valor={p.op} disabled={dis} onChange={v => setP('op', v)} /></Campo>
			<Campo rotulo="Valor">{p.campo === 'identidade_confirmada'
				? <Opcoes lista={[['true', 'sim'], ['false', 'não']]} valor={String(p.valor)} disabled={dis} onChange={v => setP('valor', v === 'true')} />
				: <input type="number" value={Number(p.valor ?? 0)} disabled={dis} onChange={e => setP('valor', Number(e.target.value))} className={sel} style={campoStyle} />}</Campo>
		</>); break;
		case 'transferir': campos = <Campo rotulo="Motivo"><Opcoes lista={OPCOES.motivo_transferir} valor={p.motivo} disabled={dis} onChange={v => setP('motivo', v)} /></Campo>; break;
		case 'encerrar': campos = <Campo rotulo="Resultado"><Opcoes lista={OPCOES.resultado_encerrar} valor={p.resultado} disabled={dis} onChange={v => setP('resultado', v)} /></Campo>; break;
	}

	const gen = b.tipo === 'generativa';
	const quandosGen = gen ? [...new Set([...possiveis.map(s => s.quando), ...b.saidas.map(s => s.quando)])] : [];
	const [novaSaida, setNovaSaida] = useState('');
	const codigoNova = slug(novaSaida);
	const ne = seNaoEntender(b);
	const no = seNaoOuvir(b);
	const respostas = (gen ? quandosGen : possiveis.map(s => s.quando)).filter(q => !(ne && q === ne.quando && SO_SEM_ENTENDER.includes(q)) && !(no && q === SO_SEM_OUVIR));
	// SQL 95: params.nao_entendi / params.silencio = {fala?, vezes?}; vazio sai do params (vale o padrão)
	function setRep(qual: 'nao_entendi' | 'silencio', campo: 'fala' | 'vezes', v: string | number | null) {
		setB(x => {
			const q = { ...x.params };
			if (qual === 'nao_entendi' && campo === 'vezes' && COM_TENTATIVAS.includes(x.tipo)) {   // um número só: o de hoje
				q.tentativas = v;
				const r = { ...(q.nao_entendi as Record<string, unknown> | undefined) };
				delete r.vezes;
				if (Object.keys(r).length) q.nao_entendi = r; else delete q.nao_entendi;
				return { ...x, params: q };
			}
			const r: Record<string, unknown> = { ...(q[qual] && typeof q[qual] === 'object' ? q[qual] as Record<string, unknown> : {}) };
			if (v === null || v === '') delete r[campo]; else r[campo] = v;
			if (Object.keys(r).length) q[qual] = r; else delete q[qual];
			return { ...x, params: q };
		});
	}
	const falaRep = (qual: 'nao_entendi' | 'silencio') => { const r = p[qual]; return r && typeof r === 'object' && typeof (r as Record<string, unknown>).fala === 'string' ? String((r as Record<string, unknown>).fala) : ''; };
	const checarRep = (t: string) => {
		const pre = preencherTeste(t, vars);
		const sens = [...new Set(variaveisDoTexto(t).filter(v => VARIAVEIS_SENSIVEIS.includes(v)))];
		return checarFala({ fala: t, falada: comoSoa(pre), antesDaIdentidade: antes, credorAntes: antes && sens.length > 0, sensiveis: sens, trechos: trechosFalados(pre).filter(x => !/^\d{1,2}$/.test(x.de)) });
	};
	const its = (Array.isArray(p.intencoes) ? p.intencoes : []) as string[];
	const ex = (p.exemplos && typeof p.exemplos === 'object' ? p.exemplos : {}) as Record<string, string[]>;
	const ops = (Array.isArray(p.opcoes) ? p.opcoes : []) as { codigo: string; rotulo: string }[];
	const tituloResp = gen ? 'A conversa termina quando' : b.modo === 'sistema' ? 'Resultado' : 'O cliente pode responder';
	const trava = b.tipo === 'abertura' ? 'Abertura' : b.tipo === 'identidade' ? 'Identidade' : b.tipo === 'encerrar' && p.resultado === 'recado' ? 'Recado neutro' : null;
	let n = 0;

	return (
		<Gaveta aberta onFechar={onFechar} largura={720} titulo={nome}
			sub={<span className="flex flex-wrap items-center gap-1.5">
				<ModoChip b={b} />
				{trava && <SeloTrava>trava: {trava}</SeloTrava>}
				<span className="rounded-full px-2 py-0.5 text-[11.5px] text-[var(--base-texto-2)]" style={{ backgroundColor: 'var(--base-fill)' }}>{b.tipo === 'abertura' ? 'começo da ligação' : chegam.length === 1 ? 'chega aqui 1 caminho' : `chegam aqui ${chegam.length} caminhos`}</span>
			</span>}
			pe={<>
				{editavel && <Botao secundario onClick={() => setConfirmaRemover(true)} disabled={ocupado}><Trash2 size={14} aria-hidden /> Remover etapa</Botao>}
				{onTestar && <Botao secundario onClick={onTestar}><Play size={14} aria-hidden /> Testar conversa</Botao>}
				{editavel && <Botao onClick={() => void salvar()} disabled={ocupado}>Salvar</Botao>}
			</>}>
			{credorAntes && <OQueCorrigir impede texto={textoCredorAntes(b)} como={comoCorrigir('valor_antes_identidade')} acao={botaoCredor()} />}
			{meus.map(e => <OQueCorrigir key={e.codigo} impede={e.impede} texto={e.texto} como={comoCorrigir(e.codigo)} acao={botao(e.codigo)} />)}
			{!editavel && <p className="text-[12.5px] text-[var(--base-texto-3)]">Somente leitura{situacao !== 'rascunho' ? ': para mudar, edite o rascunho do fluxo.' : '.'}</p>}

			<Campo rotulo="Nome da etapa (opcional)"><input value={b.titulo ?? ''} maxLength={60} disabled={dis} placeholder={TIPOS[b.tipo]?.nome} onChange={e => setB(x => ({ ...x, titulo: e.target.value }))} className={sel} style={campoStyle} /></Campo>

			<Secao n={++n} titulo="Como o agente decide nesta etapa" id="sec-modo">
				<CartoesModo cartoes={cartoesModo(b)} disabled={dis} onEscolher={m => setB(x => ({ ...x, modo: m }))} />
			</Secao>

			{gen ? (
				<Secao n={++n} titulo="Objetivo da IA" id="sec-objetivo">
					<textarea aria-label="Objetivo da IA" rows={4} value={String(p.objetivo ?? '')} disabled={dis} onChange={e => setP('objetivo', e.target.value)} className={`${sel} h-auto py-2 leading-relaxed`} style={campoStyle} />
					<small className="block text-[11.5px] text-[var(--base-texto-3)]">Escreva como orientaria um bom negociador (pelo menos 20 caracteres). A IA nunca inventa oferta: só usa as que vieram do CRM, dentro da alçada.</small>
					<div className="grid gap-3 sm:grid-cols-2">
						<Campo rotulo="Até quantos turnos (1 a 40)"><input type="number" min={1} max={40} value={Number(p.max_turnos ?? 8)} disabled={dis} onChange={e => setP('max_turnos', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>
						<Campo rotulo="Contrapropostas no máximo (0 a 5)"><input type="number" min={0} max={5} value={Number(p.contrapropostas_max ?? 2)} disabled={dis} onChange={e => setP('contrapropostas_max', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>
					</div>
					<div><b className="text-[12px] font-semibold text-[var(--base-texto-2)]">A IA pode</b><div className="mt-1"><Marcar lista={OPCOES.ferramentas} valor={(p.ferramentas as string[]) ?? []} disabled={dis} travado="transferir_humano" onChange={v => setP('ferramentas', [...new Set([...v, 'transferir_humano'])])} /></div></div>
					<div><b className="text-[12px] font-semibold text-[var(--base-texto-2)]">Jeito de falar</b><div className="mt-1"><Marcar lista={OPCOES.tom} valor={(p.tom as string[]) ?? []} disabled={dis} onChange={v => setP('tom', v)} /></div></div>
					<p className="text-[12px] text-[var(--base-texto-3)]">"Transferir para humano" fica sempre ligado nesta etapa (trava 6).</p>
				</Secao>
			) : kFala ? (
				<Secao n={++n} titulo={kFala === 'fala_espera' ? 'O agente diz enquanto espera' : b.tipo === 'pergunta' ? 'O agente pergunta' : 'O agente diz'} id="sec-fala">
					<FalaDoAgente valor={fala} disabled={dis} antesDaIdentidade={antes} onChange={v => setP(kFala, v)} rotulo={kFala === 'fala_espera' ? 'Fala de espera' : 'O que o agente diz'} />
					<ComoSoa falada={falada} onOuvir={api && perm.editar ? ouvir : undefined} aviso={`Com o cliente de teste (${vars.primeiro_nome}, saldo ${vars.saldo}) e uma oferta de exemplo. Valores e datas por extenso.`} />
					{checagens.length > 0 && <ChecagensFala itens={checagens} />}
					{campos && <div className="grid gap-3 sm:grid-cols-2">{campos}</div>}
				</Secao>
			) : (
				<Secao n={++n} titulo="O que a etapa faz" sub={acaoSistema(b)} id="sec-faz">
					<div className="grid gap-3 sm:grid-cols-2">{campos}</div>
				</Secao>
			)}

			{!final && (
				<Secao n={++n} titulo={tituloResp} id="sec-respostas"
					sub={b.tipo === 'intencao' ? 'A IA entende jeitos diferentes de dizer a mesma coisa. Os exemplos ajudam.' : gen ? 'Quando a conversa termina, o roteiro continua pela etapa escolhida.' : undefined}>
					{b.tipo === 'intencao' && (
						<div>
							<b className="text-[12px] font-semibold text-[var(--base-texto-2)]">O que esta etapa entende (até 12; catálogo da equipe MotorCX)</b>
							<div className="mt-1"><Marcar lista={intencoes.filter(i => i.ativa || its.includes(i.codigo)).map(i => [i.codigo, i.nome] as const)} valor={its} disabled={dis} onChange={v => { setP('intencoes', v.slice(0, 12)); setP('exemplos', Object.fromEntries(Object.entries(ex).filter(([k]) => v.includes(k)))); }} /></div>
						</div>
					)}
					{b.tipo === 'pergunta' && (
						<div>
							<b className="text-[12px] font-semibold text-[var(--base-texto-2)]">Opções que o agente oferece (1 a 6)</b>
							<div className="mt-1 space-y-1.5">
								{ops.map((o, i) => (
									<div key={i} className="flex gap-2">
										<input aria-label={`Opção ${i + 1}`} value={o.rotulo} maxLength={60} disabled={dis} onChange={e => setP('opcoes', ops.map((x, j) => (j === i ? { ...x, rotulo: e.target.value, codigo: slug(e.target.value) } : x)))} className={sel} style={campoStyle} />
										{!dis && <button type="button" aria-label="Remover opção" onClick={() => setP('opcoes', ops.filter((_, j) => j !== i))} className="px-2 text-[var(--base-texto-3)]"><Trash2 size={14} /></button>}
									</div>
								))}
								{!dis && ops.length < 6 && <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => setP('opcoes', [...ops, { codigo: `opcao_${ops.length + 1}`, rotulo: `Opção ${ops.length + 1}` }])}>+ opção</button>}
							</div>
						</div>
					)}
					<div className="space-y-2">
						{respostas.map(q => {
							const pos = possiveis.find(s => s.quando === q);
							const atual = b.saidas.find(s => s.quando === q);
							const rot = atual?.rotulo ?? pos?.rotulo ?? q;
							const exs = exemplosDaSaida(b, q);
							const editaEx = b.tipo === 'intencao' && !dis;
							return (
								<div key={q} data-resposta={q} className="space-y-1.5 rounded-xl p-2.5" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
									<div className="grid items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
										<input aria-label={`Resposta: ${rot}`} value={rot} maxLength={60} disabled={dis || !atual} onChange={e => setSaida(q, { rotulo: e.target.value })} className={sel} style={campoStyle} />
										<span className="text-[12.5px] text-[var(--base-texto-2)]">então →</span>
										{destino(q, rot)}
									</div>
									{(exs.exemplos.length > 0 || editaEx) && (
										<div className="flex flex-wrap items-center gap-1.5" aria-label={`Exemplos de "${rot}"`}>
											{exs.exemplos.map((x, i) => (
												<span key={i} className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] text-[var(--base-texto-2)]" style={{ backgroundColor: 'var(--base-fill)' }}>
													“{x}”{editaEx && !exs.doCatalogo && <button type="button" aria-label={`Tirar o exemplo ${x}`} className="text-[var(--base-texto-3)]" onClick={() => setP('exemplos', { ...ex, [q]: (ex[q] ?? []).filter((_, j) => j !== i) })}><X size={12} /></button>}
												</span>
											))}
											{exs.doCatalogo && exs.exemplos.length > 0 && <small className="text-[11px] text-[var(--base-texto-3)]">exemplos</small>}
											{editaEx && <NovoExemplo onAdicionar={t => setP('exemplos', { ...ex, [q]: [...(ex[q] ?? []), t.slice(0, 120)].slice(0, 10) })} />}
										</div>
									)}
									{pos?.obrig && !atual && <small className="block text-[11.5px] text-[var(--estado-erro-texto)]">Obrigatória: escolha para onde vai.</small>}
								</div>
							);
						})}
						{gen && !dis && (
							<div className="flex gap-2">
								<input aria-label="Nova saída" placeholder="Outro fim da conversa (ex.: Pediu boleto)" value={novaSaida} maxLength={60} onChange={e => setNovaSaida(e.target.value)} className={sel} style={campoStyle} />
								<Botao secundario disabled={!/^[a-z][a-z0-9_]{1,40}$/.test(codigoNova) || quandosGen.includes(codigoNova)} onClick={() => { setB(x => ({ ...x, saidas: [...x.saidas, { quando: codigoNova, rotulo: novaSaida.trim().slice(0, 60), para: outros[0]?.id ?? '', tipo: 'devolve' }] })); setNovaSaida(''); }}>Adicionar</Botao>
							</div>
						)}
					</div>
				</Secao>
			)}
			{final && <p className="text-[12.5px] text-[var(--base-texto-2)]">Etapa final: a ligação termina aqui ({resultadoFinal(b)}).</p>}

			{ne && no && (
				<Secao n={++n} titulo="Se não entender ou não ouvir nada" id="sec-nao-entender" sub="Cada um com fala própria, quantas vezes e para onde vai depois.">
					<QuadroRepeticao qual="nao_entendi" fala={falaRep('nao_entendi')} padrao={ne.fala} vezes={ne.vezes} disabled={dis}
						onFala={v => setRep('nao_entendi', 'fala', v.trim() ? v.slice(0, 500) : null)} onVezes={v => setRep('nao_entendi', 'vezes', v)}
						checagens={falaRep('nao_entendi').trim() ? checarRep(falaRep('nao_entendi')) : undefined}
						destino={SO_SEM_ENTENDER.includes(ne.quando ?? '') ? destino(ne.quando!, 'não entender')
							: <span className="text-[12.5px] text-[var(--base-texto)]">segue “{b.saidas.find(s => s.quando === ne.quando)?.rotulo ?? possiveis.find(s => s.quando === ne.quando)?.rotulo ?? ne.quando}” → <b className="font-semibold">{(() => { const s = b.saidas.find(x => x.quando === ne.quando); return s?.para ? nomeDestino(nomes, s.para) : 'transfere para um atendente'; })()}</b></span>} />
					<QuadroRepeticao qual="silencio" fala={falaRep('silencio')} padrao={no.fala} vezes={no.vezes} disabled={dis}
						onFala={v => setRep('silencio', 'fala', v.trim() ? v.slice(0, 500) : null)} onVezes={v => setRep('silencio', 'vezes', v)}
						checagens={falaRep('silencio').trim() ? checarRep(falaRep('silencio')) : undefined}
						destino={destino(SO_SEM_OUVIR, 'não ouvir nada', b.tipo === 'abertura' ? '— encerra sem recado (caixa postal) —' : '— igual a "Se não entender" —')} />
				</Secao>
			)}

			{gen && <BaseRespostas versao={versao} bloco={b.id} editavel={editavel && situacao === 'rascunho'} />}

			<Detalhes titulo="Avançado" qtd="certeza, repetição e códigos internos">
				<div className="space-y-3">
					{b.tipo === 'intencao' && (
						<Campo rotulo="Certeza mínima para escolher o caminho" ajuda={CERTEZAS.find(([v]) => Math.abs(v - Number(p.confianca_min ?? 0.7)) < 0.001)?.[2] ?? 'Valor escolhido antes; vale como está.'}>
							<select value={String(Number(p.confianca_min ?? 0.7))} disabled={dis} onChange={e => setP('confianca_min', Number(e.target.value))} className={sel} style={campoStyle}>
								{!CERTEZAS.some(([v]) => Math.abs(v - Number(p.confianca_min ?? 0.7)) < 0.001) && <option value={String(Number(p.confianca_min ?? 0.7))}>{certezaEmPalavras(p.confianca_min)}</option>}
								{CERTEZAS.map(([v, t]) => <option key={v} value={String(v)}>{t}</option>)}
							</select>
						</Campo>
					)}
					<Campo rotulo="Se voltar para esta etapa" ajuda={'Numa volta (ex.: "Quer outra condição" voltando à negociação), uma das etapas precisa de um limite.'}>
						<select value={b.repetir_max ?? ''} disabled={dis} onChange={e => setB(x => { const nb = { ...x }; if (e.target.value) nb.repetir_max = Number(e.target.value); else delete nb.repetir_max; return nb; })} className={sel} style={campoStyle}>
							<option value="">sem limite</option>
							{[1, 2, 3, 4, 5].map(k => <option key={k} value={k}>no máximo {k} {k === 1 ? 'vez' : 'vezes'}</option>)}
						</select>
					</Campo>
					{b.tipo === 'encerrar' && (
						<Campo rotulo="Código do resultado (opcional)" ajuda="Minúsculas e _ (ex.: acordo_registrado). Aparece nos relatórios.">
							<input value={String(p.codigo ?? '')} maxLength={41} disabled={dis} onChange={e => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); setB(x => { const q = { ...x.params }; if (v) q.codigo = v; else delete q.codigo; return { ...x, params: q }; }); }} className={sel} style={campoStyle} />
						</Campo>
					)}
					<div className="rounded-xl px-3 py-2.5 text-[12px] text-[var(--base-texto-2)]" style={{ backgroundColor: 'var(--base-fill)' }} data-codigos>
						<b className="block font-semibold text-[var(--base-texto)]">Códigos internos</b>
						<span className="block">Etapa <code>{b.id}</code> · tipo <code>{b.tipo}</code> · modo <code>{MODOS[b.modo]?.antigo ?? b.modo}</code></span>
						{b.saidas.length > 0 && <span className="block">Respostas: {b.saidas.map(s => <span key={s.quando} className="mr-2 inline-block"><code>{s.quando}</code> ({s.rotulo})</span>)}</span>}
					</div>
				</div>
			</Detalhes>

			{trava && <p className="flex items-start gap-1.5 text-[12px] text-[var(--base-texto-3)]">Etapa com trava fixa. Nenhum fluxo desliga; as 7 travas ficam no topo do editor.</p>}
			<ConfirmaCorrecao local correcao={previa} onFechar={() => setPrevia(null)}
				onConfirmar={c => { const nb = c.definicao.blocos.find(x => x.id === b.id); if (nb) setB(nb); setPrevia(null); }} />
			<ConfirmaAcao
				aberto={confirmaRemover}
				titulo={`Remover "${nome}"?`}
				texto={chegam.length
					? <>{chegam.length === 1 ? 'Um caminho chega' : `${chegam.length} caminhos chegam`} a esta etapa e {chegam.length === 1 ? 'fica' : 'ficam'} sem destino: {chegam.map(c => `"${c.rotulo}" em ${nomes.get(c.de)}`).join(', ')}. Depois, ligue {chegam.length === 1 ? 'esse caminho' : 'esses caminhos'} a outra etapa. A mudança vai para o rascunho.</>
					: 'Nenhum caminho chega a esta etapa. A mudança vai para o rascunho.'}
				botao="Remover etapa"
				corBotao="var(--estado-erro)"
				loading={ocupado}
				onClose={() => setConfirmaRemover(false)}
				onConfirm={() => void (async () => { setOcupado(true); const ok = await onRemover(b.id); setOcupado(false); setConfirmaRemover(false); if (ok) onFechar(); })()}
			/>
		</Gaveta>
	);
}

/** "+ exemplo": uma frase curta que a pessoa diria (até 120 caracteres). */
function NovoExemplo({ onAdicionar }: { onAdicionar: (t: string) => void }) {
	const [aberto, setAberto] = useState(false);
	const [t, setT] = useState('');
	if (!aberto) return <button type="button" onClick={() => setAberto(true)} className="h-7 rounded-full px-2.5 text-[12px] font-semibold text-[var(--destaque)]" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>+ exemplo</button>;
	const ok = () => { if (t.trim()) onAdicionar(t.trim()); setT(''); setAberto(false); };
	return (
		<input autoFocus aria-label="Novo exemplo" value={t} maxLength={120} placeholder="como a pessoa diria" onChange={e => setT(e.target.value)}
			onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') setAberto(false); }} onBlur={ok}
			className={`${campoCls} h-7 w-48 text-[12px]`} style={campoStyle} />
	);
}

/** O que a etapa diz antes da identidade, em palavras: "Esta fala cita {{credor}} antes de confirmar a identidade." */
export function textoCredorAntes(b: Bloco): string {
	const vs = variaveisSensiveis(b);
	if (vs.length) return `Esta ${b.tipo === 'generativa' ? 'etapa' : 'fala'} cita ${vs.map(v => `{{${v}}}`).join(', ')} antes de confirmar a identidade, em algum caminho.`;
	return `${TIPOS[b.tipo]?.nome ?? 'Esta etapa'} fala de valor ou oferta e algum caminho chega aqui antes de confirmar a identidade.`;
}

/** Base de respostas da conversa livre (FL8): edita quem edita; só as revisadas por quem aprova vão para a ligação. */
function BaseRespostas({ versao, bloco, editavel }: { versao: number; bloco: string; editavel: boolean }) {
	const { api, permissoes, equipe } = useFluxo();
	const podeRevisar = !equipe && permissoes.includes('aprovar_roteiro_voz');
	const { dados, recarregar } = useCarregar(async () => (api ? (await api.respostas(versao)).filter(r => r.bloco_id === bloco) : [] as RespostaRow[]), [api, versao, bloco]);
	const [q, setQ] = useState('');
	const [r, setR] = useState('');
	const lista = dados ?? [];
	const pend = lista.filter(x => !x.revisado_em).length;
	async function salvar() {
		if (!api) return;
		if (await executar(() => api.salvarResposta(versao, bloco, q.trim(), r.trim(), null), 'Resposta guardada. Vai para a ligação depois de revisada por quem aprova.')) { setQ(''); setR(''); void recarregar(); }
	}
	return (
		<Detalhes titulo="Base de respostas" qtd={`${lista.length}${pend ? ` · ${pend} sem revisão` : ''}`}>
			<Linhas itens={lista.map(x => ({
				e: x.pergunta, s: x.resposta,
				d: x.revisado_em ? <Pilula tom="ok">revisada</Pilula> : podeRevisar ? <button type="button" className="text-[12.5px] font-semibold text-[var(--destaque)]" onClick={() => void executar(() => api!.revisarResposta(x.id), 'Resposta revisada.').then(() => recarregar())}>Revisar</button> : <Pilula tom="atencao">sem revisão</Pilula>,
			}))} />
			{editavel && (
				<div className="mt-2 space-y-2">
					<input placeholder="Pergunta da pessoa (ex.: Isso suja meu nome?)" value={q} maxLength={300} onChange={e => setQ(e.target.value)} className={sel} style={campoStyle} />
					<textarea rows={2} placeholder="Resposta do agente (sem dado de cliente)" value={r} maxLength={600} onChange={e => setR(e.target.value)} className={`${sel} h-auto py-2`} style={campoStyle} />
					<Botao secundario disabled={q.trim().length < 3 || r.trim().length < 3 || /[0-9]{9,}/.test(r)} onClick={() => void salvar()}>Guardar resposta</Botao>
				</div>
			)}
		</Detalhes>
	);
}
