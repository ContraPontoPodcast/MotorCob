// Peças do detalhe da etapa (PR5 do redesenho; SPEC §2.3), sem banco e sem gaveta, para renderizar nos testes:
// os 4 cartões do modo, "O agente diz" com as variáveis em destaque, "Como soa no telefone" (valores e datas por
// extenso, com "Ouvir" pela prévia de voz que já existe) e as checagens da fala. Só apresentação: o modo continua
// sendo arvore/cognicao/generativo/sistema e a regra do credor antes da identidade é a mesma do banco.
import { useRef, useState, type ReactNode } from 'react';
import { Check, Info, Lock, TriangleAlert, Volume2, X } from 'lucide-react';
import { campoCls, campoStyle } from '@/components/voz/ui';
import { MODOS, VARIAVEIS, VARIAVEIS_SENSIVEIS, variaveisDoTexto, type CartaoModo, type Checagem, type Modo } from '@/lib/fluxo';
import { Fala } from './roteiro';

/** Seção numerada do detalhe ("1 Como o agente decide nesta etapa"). */
export function Secao({ n, titulo, sub, children, id }: { n?: number; titulo: ReactNode; sub?: ReactNode; children: ReactNode; id?: string }) {
	return (
		<section aria-labelledby={id} className="space-y-2">
			<h3 id={id} className="flex items-center gap-2 text-[14px] font-semibold text-[var(--base-texto)]">
				{n != null && <span aria-hidden className="grid h-5 w-5 place-items-center rounded-md text-[11px] font-bold text-[var(--base-texto-2)]" style={{ backgroundColor: 'var(--base-fill)' }}>{n}</span>}
				{titulo}
			</h3>
			{sub && <p className="text-[12.5px] text-[var(--base-texto-2)]">{sub}</p>}
			{children}
		</section>
	);
}

/** "Como o agente decide nesta etapa": 4 cartões (rádio). O que não vale aparece apagado, com o motivo. */
export function CartoesModo({ cartoes, onEscolher, disabled }: { cartoes: CartaoModo[]; onEscolher: (m: Modo) => void; disabled?: boolean }) {
	return (
		<div role="radiogroup" aria-label="Como o agente decide nesta etapa" className="grid gap-2 sm:grid-cols-2">
			{cartoes.map(c => {
				const off = !c.disponivel || (disabled && !c.escolhido);
				return (
					<button key={c.modo} type="button" role="radio" aria-checked={c.escolhido} disabled={off || disabled} data-modo={c.modo}
						onClick={() => !c.escolhido && onEscolher(c.modo)}
						className="flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2.5 text-left disabled:cursor-not-allowed"
						style={{ backgroundColor: 'var(--base-cartao)', boxShadow: c.escolhido ? `0 0 0 2px ${MODOS[c.modo].cor}` : '0 0 0 1px var(--base-borda)', opacity: off ? 0.55 : 1 }}>
						<span aria-hidden className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full" style={{ border: `1.5px solid ${c.escolhido ? MODOS[c.modo].cor : 'var(--base-borda)'}` }}>
							{c.escolhido && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MODOS[c.modo].cor }} />}
						</span>
						<span className="min-w-0">
							<b className="block text-[13.5px] font-semibold text-[var(--base-texto)]">{c.nome}</b>
							<span className="mt-0.5 block text-[12px] leading-snug text-[var(--base-texto-2)]">{c.frase}</span>
							{!c.disponivel && <span className="mt-1 block text-[11.5px] text-[var(--base-texto-3)]">{c.motivo}</span>}
						</span>
					</button>
				);
			})}
		</div>
	);
}

/**
 * "O agente diz": o texto, as variáveis em chips (as usadas em destaque; as sensíveis riscadas quando a etapa vem antes
 * da identidade) e um clique insere {{variável}} onde está o cursor.
 */
export function FalaDoAgente({ valor, onChange, disabled, antesDaIdentidade, rotulo = 'O que o agente diz' }: {
	valor: string; onChange: (v: string) => void; disabled?: boolean; antesDaIdentidade: boolean; rotulo?: string;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const usadas = new Set(variaveisDoTexto(valor));
	function inserir(v: string) {
		const el = ref.current;
		const ini = el?.selectionStart ?? valor.length, fim = el?.selectionEnd ?? valor.length;
		const novo = `${valor.slice(0, ini)}{{${v}}}${valor.slice(fim)}`.slice(0, 500);
		onChange(novo);
		requestAnimationFrame(() => { el?.focus(); const p = ini + v.length + 4; el?.setSelectionRange(p, p); });
	}
	return (
		<div className="space-y-2">
			<textarea ref={ref} aria-label={rotulo} rows={3} value={valor} maxLength={500} disabled={disabled} onChange={e => onChange(e.target.value)}
				className={`${campoCls} h-auto w-full py-2 leading-relaxed`} style={campoStyle} />
			{valor.trim() && <p className="rounded-xl px-3 py-2 text-[13px] text-[var(--base-texto)]" style={{ backgroundColor: 'var(--base-fill)' }} aria-label="Fala com as variáveis em destaque"><Fala texto={valor} /></p>}
			<div className="flex flex-wrap gap-1.5" aria-label="Variáveis">
				{VARIAVEIS.filter(v => v !== 'oferta.id').map(v => {
					const bloqueada = antesDaIdentidade && VARIAVEIS_SENSIVEIS.includes(v);
					const usada = usadas.has(v);
					return (
						<button key={v} type="button" disabled={disabled || (bloqueada && !usada)} onClick={() => inserir(v)} data-variavel={v} data-usada={usada || undefined} data-bloqueada={bloqueada || undefined}
							title={bloqueada ? 'Só depois de confirmar a identidade (trava 1)' : usada ? 'Já está na fala' : 'Inserir na fala'}
							className={`h-7 rounded-full px-2.5 font-mono text-[11.5px] disabled:cursor-not-allowed ${bloqueada ? 'line-through' : ''}`}
							style={usada
								? { backgroundColor: bloqueada ? 'color-mix(in srgb, var(--estado-erro) 14%, transparent)' : 'color-mix(in srgb, var(--area-voz) 14%, transparent)', color: bloqueada ? 'var(--estado-erro-texto)' : 'var(--area-voz)' }
								: { boxShadow: '0 0 0 1px var(--base-borda)', color: bloqueada ? 'var(--base-texto-3)' : 'var(--base-texto-2)' }}>
							{`{{${v}}}`}
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** "Ouvir" + "Como soa no telefone": a fala com os valores de teste e os números por extenso. */
export function ComoSoa({ falada, onOuvir, aviso }: { falada: string; onOuvir?: () => Promise<void>; aviso?: string }) {
	const [tocando, setTocando] = useState(false);
	const [erro, setErro] = useState('');
	return (
		<div className="rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--base-fill)' }} data-como-soa>
			<div className="flex flex-wrap items-center gap-2">
				{onOuvir && (
					<button type="button" disabled={tocando || !falada.trim()} onClick={() => { setErro(''); setTocando(true); onOuvir().catch(e => setErro(e instanceof Error ? e.message : String(e))).finally(() => setTocando(false)); }}
						className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-[var(--base-texto)] disabled:opacity-60" style={{ backgroundColor: 'var(--base-cartao)', boxShadow: '0 0 0 1px var(--base-borda)' }}>
						<Volume2 size={14} aria-hidden className={tocando ? 'animate-pulse' : ''} /> Ouvir
					</button>
				)}
				<b className="text-[13px] font-semibold text-[var(--base-texto)]">Como soa no telefone</b>
			</div>
			<p className="mt-1.5 text-[13px] leading-relaxed text-[var(--base-texto)]">{falada.trim() ? `“${falada.trim()}”` : <span className="text-[var(--base-texto-3)]">Escreva a fala para ver como soa.</span>}</p>
			{aviso && <small className="mt-1 block text-[11.5px] text-[var(--base-texto-3)]">{aviso}</small>}
			{erro && <small role="alert" className="mt-1 block text-[12px] text-[var(--estado-erro-texto)]">{erro}</small>}
		</div>
	);
}

const ICONE: Record<Checagem['estado'], ReactNode> = {
	ok: <Check size={14} aria-hidden style={{ color: 'var(--estado-pronto-texto)' }} />,
	atencao: <TriangleAlert size={14} aria-hidden style={{ color: 'var(--estado-atencao-texto)' }} />,
	erro: <X size={14} aria-hidden style={{ color: 'var(--estado-erro-texto)' }} />,
	info: <Info size={14} aria-hidden style={{ color: 'var(--base-texto-3)' }} />,
};
const SR: Record<Checagem['estado'], string> = { ok: 'ok: ', atencao: 'atenção: ', erro: 'corrigir: ', info: '' };

/** Checagens ao vivo da fala (tamanho, uma pergunta, trava 1, senha, números lidos). */
export function ChecagensFala({ itens }: { itens: Checagem[] }) {
	return (
		<ul className="space-y-1" aria-label="Checagem da fala">
			{itens.map((c, i) => (
				<li key={i} data-checagem={c.estado} className="flex items-start gap-2 text-[12.5px] text-[var(--base-texto)]">
					<span className="mt-[2px] shrink-0">{ICONE[c.estado]}</span><span className="min-w-0"><span className="sr-only">{SR[c.estado]}</span>{c.texto}</span>
				</li>
			))}
		</ul>
	);
}

/**
 * "Se não entender" e "Se não ouvir nada" (SQL 95; SPEC §2.3 item 4): a fala própria da etapa (vazia = a padrão do
 * executor, com aviso de fala genérica), quantas vezes até seguir e para onde vai depois (`destino`, montado pela
 * gaveta). As checagens da fala valem também aqui (a trava 1 e a de senha).
 */
export function QuadroRepeticao({ qual, fala, padrao, vezes, onFala, onVezes, destino, disabled, checagens }: {
	qual: 'nao_entendi' | 'silencio'; fala: string; padrao: string; vezes: number;
	onFala: (v: string) => void; onVezes: (n: number) => void; destino: ReactNode; disabled?: boolean; checagens?: Checagem[];
}) {
	const ouvir = qual === 'silencio';
	const titulo = ouvir ? 'Se não ouvir nada' : 'Se não entender';
	return (
		<div className="space-y-2 rounded-xl px-3 py-2.5" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }} {...{ [ouvir ? 'data-se-nao-ouvir' : 'data-se-nao-entender']: '' }}>
			<b className="block text-[13px] font-semibold text-[var(--base-texto)]">{titulo}</b>
			<p className="text-[12px] text-[var(--base-texto-2)]">{ouvir ? 'Depois de 6 s sem a pessoa falar (fixo pela MotorCX).' : 'Quando a resposta não bate com nenhuma das esperadas.'}</p>
			<textarea aria-label={`${titulo}: o que o agente diz`} rows={2} value={fala} maxLength={500} disabled={disabled} placeholder={padrao} onChange={e => onFala(e.target.value)}
				className={`${campoCls} h-auto w-full py-2 leading-relaxed`} style={campoStyle} />
			{!fala.trim() && (
				<small className="flex items-start gap-1.5 text-[11.5px] text-[var(--estado-atencao-texto)]" data-fala-generica>
					<TriangleAlert size={12} className="mt-[2px] shrink-0" aria-hidden />
					<span>Fala padrão: “{padrao}”. Ela é genérica; escreva uma própria, que diga de outro jeito e dê um exemplo do que responder.</span>
				</small>
			)}
			{fala.trim() && checagens && checagens.length > 0 && <ChecagensFala itens={checagens} />}
			<div className="grid items-center gap-1.5 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
				<select aria-label={`${titulo}: quantas vezes`} value={vezes} disabled={disabled} onChange={e => onVezes(Number(e.target.value))} className={campoCls} style={campoStyle}>
					{[1, 2, 3].map(n => <option key={n} value={n}>{n === 1 ? 'Na 1ª vez' : `Depois de ${n} vezes`}</option>)}
				</select>
				<span className="text-[12.5px] text-[var(--base-texto-2)]">{vezes === 1 ? 'sem ' : ''}{ouvir ? (vezes === 1 ? 'ouvir' : 'sem ouvir') : (vezes === 1 ? 'entender' : 'sem entender')}, então →</span>
				{destino}
			</div>
			<small className="block text-[11.5px] text-[var(--base-texto-3)]">{vezes === 1 ? 'Não pede de novo.' : `Pede de novo ${vezes - 1 === 1 ? '1 vez' : `${vezes - 1} vezes`} antes de seguir.`}</small>
		</div>
	);
}

/** Selo de cadeado (trava fixa) para o cabeçalho e as ferramentas travadas. */
export function SeloTrava({ children }: { children: ReactNode }) {
	return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-[var(--area-voz)]" style={{ backgroundColor: 'var(--base-fill)' }}><Lock size={11} aria-hidden />{children}</span>;
}
