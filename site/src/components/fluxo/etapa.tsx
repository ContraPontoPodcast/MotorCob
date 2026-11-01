// Gaveta da etapa (editor): modo, fala ou objetivo, campos do tipo, saídas ("Sim → N5") e, na conversa livre, a base
// de respostas (salvar_resposta_fluxo_voz; revisa quem aprova). Os campos seguem o esquema 1 de public.fluxo_voz_erros:
// o que o banco recusa aparece nas pendências depois de salvar.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Aviso, Botao, Pilula, campoCls, campoStyle } from '@/components/voz/ui';
import {
	MODOS, OPCOES, TIPOS, explicar, modosDoTipo, saidasPossiveis, tipoDaSaida, tituloBloco,
	type Bloco, type Definicao, type Modo, type Saida,
} from '@/lib/fluxo';
import type { ConectorRow, IntencaoRow, RespostaRow } from './api';
import { Campo, Detalhes, Gaveta, Linhas } from './ds';
import { useFluxo } from './contexto';
import { executar, useCarregar } from './comum';

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

export function GavetaEtapa({ bloco, definicao, conectores, intencoes, erros, editavel, versao, situacao, onFechar, onSalvar, onRemover }: {
	bloco: Bloco; definicao: Definicao; conectores: ConectorRow[]; intencoes: IntencaoRow[]; erros: string[]; editavel: boolean;
	versao: number; situacao: string; onFechar: () => void; onSalvar: (b: Bloco) => Promise<boolean>; onRemover: (id: string) => Promise<boolean>;
}) {
	const [b, setB] = useState<Bloco>(bloco);
	const [ocupado, setOcupado] = useState(false);
	useEffect(() => { setB(bloco); }, [bloco]);
	const p = b.params ?? {};
	const setP = (k: string, v: unknown) => setB(x => ({ ...x, params: { ...x.params, [k]: v } }));
	const final = !!TIPOS[b.tipo]?.final;
	const outros = definicao.blocos.filter(x => x.id !== b.id);
	const meus = erros.map(explicar).filter(e => e.bloco === b.id);
	const dis = !editavel;

	// saídas: uma linha por saída possível (pergunta e intenção dependem das opções); conversa livre tem lista própria
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
	const destino = (quando: string) => (
		<select aria-label={`Destino de ${quando}`} value={b.saidas.find(s => s.quando === quando)?.para ?? ''} disabled={dis} onChange={e => setSaida(quando, { para: e.target.value })} className={sel} style={campoStyle}>
			<option value="">— sem saída —</option>
			{outros.map(o => <option key={o.id} value={o.id}>→ {o.id} · {tituloBloco(o)}</option>)}
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

	let campos: ReactNode = null;
	const fala = (rotulo = 'Fala', chave = 'fala') => (
		<Campo inteiro rotulo={rotulo} ajuda={'Variáveis entre chaves duplas, como {{primeiro_nome}}. Até 500 caracteres.'}>
			<textarea rows={3} value={String(p[chave] ?? '')} maxLength={500} disabled={dis} onChange={e => setP(chave, e.target.value)} className={`${sel} h-auto py-2 leading-relaxed`} style={campoStyle} />
		</Campo>
	);
	const tentativas = <Campo rotulo="Tentativas (1 a 3)"><input type="number" min={1} max={3} value={Number(p.tentativas ?? 1)} disabled={dis} onChange={e => setP('tentativas', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>;
	switch (b.tipo) {
		case 'abertura': campos = fala(); break;
		case 'identidade': campos = (<>
			{fala()}
			<Campo rotulo="O que confere"><Opcoes lista={OPCOES.pergunta_identidade} valor={p.pergunta} disabled={dis} onChange={v => setP('pergunta', v)} /></Campo>
			{tentativas}
			<Campo inteiro rotulo="Conector que confere no CRM (Validar cadastro)" ajuda="Só o CRM confere a identidade, nunca a IA. Sem o conector, a aprovação fica pendente.">
				<SelConector conectores={conectores} finalidades={['validar_cadastro']} valor={p.conector_id} disabled={dis} onChange={v => setP('conector_id', v)} />
			</Campo>
		</>); break;
		case 'pergunta': {
			const ops = (Array.isArray(p.opcoes) ? p.opcoes : []) as { codigo: string; rotulo: string }[];
			campos = (<>
				{fala('Pergunta')}
				{tentativas}
				<div className="sm:col-span-2">
					<b className="text-[12px] font-semibold text-[var(--base-texto-2)]">Opções (1 a 6)</b>
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
			</>);
			break;
		}
		case 'intencao': {
			const its = (Array.isArray(p.intencoes) ? p.intencoes : []) as string[];
			const ex = (p.exemplos && typeof p.exemplos === 'object' ? p.exemplos : {}) as Record<string, string[]>;
			campos = (<>
				{fala()}
				{tentativas}
				<Campo rotulo="Confiança mínima (0,50 a 0,95)"><input type="number" step={0.05} min={0.5} max={0.95} value={Number(p.confianca_min ?? 0.7)} disabled={dis} onChange={e => setP('confianca_min', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>
				<div className="sm:col-span-2">
					<b className="text-[12px] font-semibold text-[var(--base-texto-2)]">Intenções que esta etapa entende (até 12; catálogo da equipe MotorCX)</b>
					<div className="mt-1"><Marcar lista={intencoes.filter(i => i.ativa || its.includes(i.codigo)).map(i => [i.codigo, i.nome] as const)} valor={its} disabled={dis} onChange={v => { setP('intencoes', v.slice(0, 12)); setP('exemplos', Object.fromEntries(Object.entries(ex).filter(([k]) => v.includes(k)))); }} /></div>
				</div>
				<div className="sm:col-span-2">
					<Detalhes titulo="Frases de exemplo" qtd="uma por linha, até 10 por intenção">
						<div className="space-y-2">
							{its.map(i => (
								<Campo key={i} inteiro rotulo={intencoes.find(x => x.codigo === i)?.nome ?? i}>
									<textarea rows={2} disabled={dis} value={(ex[i] ?? []).join('\n')} onChange={e => setP('exemplos', { ...ex, [i]: e.target.value.split('\n').map(x => x.slice(0, 120)).filter(Boolean).slice(0, 10) })} className={`${sel} h-auto py-2`} style={campoStyle} />
								</Campo>
							))}
						</div>
					</Detalhes>
				</div>
			</>);
			break;
		}
		case 'generativa': {
			campos = (<>
				<Campo inteiro rotulo="Objetivo da conversa livre" ajuda="Pelo menos 20 caracteres. Só ofertas do conector ou da alçada; nunca inventa.">
					<textarea rows={4} value={String(p.objetivo ?? '')} disabled={dis} onChange={e => setP('objetivo', e.target.value)} className={`${sel} h-auto py-2 leading-relaxed`} style={campoStyle} />
				</Campo>
				<Campo rotulo="Limite de turnos (1 a 40)"><input type="number" min={1} max={40} value={Number(p.max_turnos ?? 8)} disabled={dis} onChange={e => setP('max_turnos', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>
				<Campo rotulo="Contrapropostas (0 a 5)"><input type="number" min={0} max={5} value={Number(p.contrapropostas_max ?? 2)} disabled={dis} onChange={e => setP('contrapropostas_max', Number(e.target.value))} className={sel} style={campoStyle} /></Campo>
				<div className="sm:col-span-2"><b className="text-[12px] font-semibold text-[var(--base-texto-2)]">Tom</b><div className="mt-1"><Marcar lista={OPCOES.tom} valor={(p.tom as string[]) ?? []} disabled={dis} onChange={v => setP('tom', v)} /></div></div>
				<div className="sm:col-span-2"><b className="text-[12px] font-semibold text-[var(--base-texto-2)]">Ferramentas desta etapa</b><div className="mt-1"><Marcar lista={OPCOES.ferramentas} valor={(p.ferramentas as string[]) ?? []} disabled={dis} travado="transferir_humano" onChange={v => setP('ferramentas', [...new Set([...v, 'transferir_humano'])])} /></div></div>
			</>);
			break;
		}
		case 'oferta': campos = (<>
			<Campo rotulo="De onde vem a oferta"><Opcoes lista={OPCOES.origem_oferta} valor={p.origem} disabled={dis} onChange={v => setP('origem', v)} /></Campo>
			{p.origem === 'conector' && <Campo rotulo="Conector (Buscar ofertas)"><SelConector conectores={conectores} finalidades={['buscar_ofertas']} valor={p.conector_id} disabled={dis} onChange={v => setP('conector_id', v)} /></Campo>}
			{fala()}
		</>); break;
		case 'retorno': campos = (<>{fala()}<Campo rotulo="Até quantos dias (1 a 7)"><input type="number" min={1} max={7} value={Number(p.dias_max ?? 7)} disabled={dis} onChange={e => setP('dias_max', Number(e.target.value))} className={sel} style={campoStyle} /></Campo></>); break;
		case 'conector': campos = (<>
			<Campo rotulo="Conector"><SelConector conectores={conectores} valor={p.conector_id} disabled={dis} onChange={v => setP('conector_id', v)} /></Campo>
			{fala('Fala de espera', 'fala_espera')}
		</>); break;
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
		case 'link': campos = (<>
			<Campo rotulo="Canal"><Opcoes lista={OPCOES.canal_link} valor={p.canal} disabled={dis} onChange={v => setP('canal', v)} /></Campo>
			{fala()}
		</>); break;
		case 'condicao': campos = (<>
			<Campo rotulo="Campo"><Opcoes lista={OPCOES.campo_condicao} valor={p.campo} disabled={dis} onChange={v => { setP('campo', v); setP('valor', v === 'identidade_confirmada' ? true : 1); if (v === 'identidade_confirmada') setP('op', '='); }} /></Campo>
			<Campo rotulo="Comparação"><Opcoes lista={p.campo === 'identidade_confirmada' ? OPCOES.op.slice(0, 2) : OPCOES.op} valor={p.op} disabled={dis} onChange={v => setP('op', v)} /></Campo>
			<Campo rotulo="Valor">{p.campo === 'identidade_confirmada'
				? <Opcoes lista={[['true', 'sim'], ['false', 'não']]} valor={String(p.valor)} disabled={dis} onChange={v => setP('valor', v === 'true')} />
				: <input type="number" value={Number(p.valor ?? 0)} disabled={dis} onChange={e => setP('valor', Number(e.target.value))} className={sel} style={campoStyle} />}</Campo>
		</>); break;
		case 'transferir': campos = (<><Campo rotulo="Motivo"><Opcoes lista={OPCOES.motivo_transferir} valor={p.motivo} disabled={dis} onChange={v => setP('motivo', v)} /></Campo>{fala()}</>); break;
		case 'encerrar': campos = (<>
			<Campo rotulo="Resultado"><Opcoes lista={OPCOES.resultado_encerrar} valor={p.resultado} disabled={dis} onChange={v => setP('resultado', v)} /></Campo>
			<Campo rotulo="Código (opcional)" ajuda="Minúsculas e _ (ex.: acordo_registrado)."><input value={String(p.codigo ?? '')} maxLength={41} disabled={dis} onChange={e => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); setB(x => { const q = { ...x.params }; if (v) q.codigo = v; else delete q.codigo; return { ...x, params: q }; }); }} className={sel} style={campoStyle} /></Campo>
			{fala()}
		</>); break;
	}

	const gen = b.tipo === 'generativa';
	const quandosGen = gen ? [...new Set([...possiveis.map(s => s.quando), ...b.saidas.map(s => s.quando)])] : [];
	const [novoQuando, setNovoQuando] = useState('');

	return (
		<Gaveta aberta onFechar={onFechar} titulo={`${b.id} · ${tituloBloco(b)}`} sub={`${MODOS[b.modo]?.nome ?? b.modo} (no editor antigo: ${MODOS[b.modo]?.antigo ?? b.modo}) · ${TIPOS[b.tipo]?.nome}`}
			pe={editavel ? <>
				<Botao secundario onClick={() => void (async () => { setOcupado(true); const ok = await onRemover(b.id); setOcupado(false); if (ok) onFechar(); })()} disabled={ocupado}><Trash2 size={14} aria-hidden /> Remover etapa</Botao>
				<Botao onClick={() => void salvar()} disabled={ocupado}>Salvar etapa</Botao>
			</> : undefined}>
			{meus.map(e => <Aviso key={e.codigo} tom={e.impede ? 'erro' : 'atencao'} titulo={e.impede ? 'Impede o envio:' : 'Atenção:'}>{e.texto}</Aviso>)}
			{!editavel && <p className="text-[12.5px] text-[var(--base-texto-3)]">Somente leitura{situacao !== 'rascunho' ? ': para mudar, edite o rascunho do fluxo.' : '.'}</p>}
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Título (opcional)"><input value={b.titulo ?? ''} maxLength={60} disabled={dis} placeholder={TIPOS[b.tipo]?.nome} onChange={e => setB(x => ({ ...x, titulo: e.target.value }))} className={sel} style={campoStyle} /></Campo>
				<Campo rotulo="Modo da etapa">
					<select value={b.modo} disabled={dis || modosDoTipo(b.tipo).length < 2} onChange={e => setB(x => ({ ...x, modo: e.target.value as Modo }))} className={sel} style={campoStyle}>
						{modosDoTipo(b.tipo).map(m => <option key={m} value={m}>{MODOS[m].nome}</option>)}
					</select>
				</Campo>
				{campos}
			</div>
			{!final && (
				<div>
					<b className="text-[12.5px] font-semibold">Saídas</b>
					<div className="mt-1.5 space-y-2">
						{(gen ? quandosGen : possiveis.map(s => s.quando)).map(q => {
							const pos = possiveis.find(s => s.quando === q);
							const atual = b.saidas.find(s => s.quando === q);
							return (
								<div key={q} className="grid gap-1.5 rounded-xl border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" style={{ borderColor: 'var(--base-borda)' }}>
									<input aria-label={`Rótulo de ${q}`} value={atual?.rotulo ?? pos?.rotulo ?? q} maxLength={60} disabled={dis || !atual} onChange={e => setSaida(q, { rotulo: e.target.value })} className={sel} style={campoStyle} />
									{destino(q)}
									<small className="text-[11.5px] text-[var(--base-texto-3)] sm:col-span-2">{gen ? 'devolve o controle ao roteiro' : q === 'falhou' ? 'quando o conector ou o envio falha' : 'quando'}: <code>{q}</code>{pos?.obrig ? ' · obrigatória' : ''}</small>
								</div>
							);
						})}
						{gen && !dis && (
							<div className="flex gap-2">
								<input aria-label="Nova saída" placeholder="nova saída (ex.: pediu_boleto)" value={novoQuando} onChange={e => setNovoQuando(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} className={sel} style={campoStyle} />
								<Botao secundario disabled={!/^[a-z][a-z0-9_]{1,40}$/.test(novoQuando) || quandosGen.includes(novoQuando)} onClick={() => { setB(x => ({ ...x, saidas: [...x.saidas, { quando: novoQuando, rotulo: novoQuando.replace(/_/g, ' '), para: outros[0]?.id ?? '', tipo: 'devolve' }] })); setNovoQuando(''); }}>Adicionar</Botao>
							</div>
						)}
					</div>
				</div>
			)}
			{final && <p className="text-[12.5px] text-[var(--base-texto-2)]">Etapa final, sem saída.</p>}
			<Detalhes titulo="Repetição" qtd={b.repetir_max ? `até ${b.repetir_max}×` : 'sem limite definido'}>
				<p className="mb-2 text-[12.5px] text-[var(--base-texto-2)]">Numa volta (ex.: "Quer outra condição" voltando à negociação), uma das etapas precisa de um limite.</p>
				<select value={b.repetir_max ?? ''} disabled={dis} onChange={e => setB(x => { const n = { ...x }; if (e.target.value) n.repetir_max = Number(e.target.value); else delete n.repetir_max; return n; })} className={sel} style={campoStyle}>
					<option value="">sem limite</option>
					{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>repetir no máximo {n}×</option>)}
				</select>
			</Detalhes>
			{gen && <BaseRespostas versao={versao} bloco={b.id} editavel={editavel && situacao === 'rascunho'} />}
			{(b.tipo === 'abertura' || b.tipo === 'identidade' || b.tipo === 'generativa') && (
				<p className="flex items-start gap-1.5 text-[12px] text-[var(--base-texto-3)]">Etapa com trava fixa. Nenhum fluxo desliga; veja "Regras fixas".</p>
			)}
		</Gaveta>
	);
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
