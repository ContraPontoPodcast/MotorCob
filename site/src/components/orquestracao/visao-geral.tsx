import { type Definicao } from '@/lib/estrategia';
import { numberBR, type PersonaUsuario, type Credor, type SegmentoEmUso } from '@/lib/supabase';
import { statusEstagios, ESTAGIOS } from './regua-topo';
import { Check, AlertTriangle } from 'lucide-react';

type Cartao = { ok: boolean; titulo: string; linhas: React.ReactNode[] };

function CartaoConferencia({ ok, titulo, linhas, acao }: Cartao & { acao?: React.ReactNode }) {
	return (
		<div className="flex items-start gap-3 rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-4">
			<span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${ok ? 'bg-[var(--estado-pronto-fundo)] text-[var(--estado-pronto)]' : 'bg-[var(--estado-atencao-fundo)] text-[var(--estado-atencao)]'}`}>
				{ok ? <Check size={14} strokeWidth={3} /> : <AlertTriangle size={14} />}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-[13px] font-bold text-[var(--base-texto)]">{titulo}</p>
				<div className="mt-1 space-y-0.5 text-[12px] text-[var(--base-texto-2)]">
					{linhas.map((l, i) => <div key={i}>{l}</div>)}
				</div>
				{acao && <div className="mt-2">{acao}</div>}
			</div>
		</div>
	);
}

export function VisaoGeral({ def, personas, credor, segmentos, countBySeg, demaisCount, semEstagio, canEdit, guardarModelo, setGuardarModelo, onSalvar, saving, estrDirty, onVerEstagios, onMontarAgora }: {
	def: Definicao;
	personas: PersonaUsuario[];
	credor: Credor | null;
	segmentos: SegmentoEmUso[];
	countBySeg: Record<string, number>;
	demaisCount: number | null;
	semEstagio: number;
	canEdit: boolean;
	guardarModelo: boolean;
	setGuardarModelo: (v: boolean) => void;
	onSalvar: () => void;
	saving: boolean;
	estrDirty: boolean;
	onVerEstagios: () => void;
	onMontarAgora: () => void;
}) {
	const status = statusEstagios(def);
	const totalClientes = Object.values(countBySeg).reduce((a, b) => a + b, 0) + (demaisCount ?? 0);
	const estagiosAtivos = ESTAGIOS.filter(e => status[e.id].ativo).length;
	const estagiosDesligados = ESTAGIOS.length - estagiosAtivos;
	const comRegua = ESTAGIOS.filter(e => status[e.id].temRegua).length;
	const semRegua = ESTAGIOS.filter(e => status[e.id].ativo && !status[e.id].temRegua);

	const cartoes: Cartao[] = [
		{
			ok: !!credor,
			titulo: 'Carteira',
			linhas: [
				<span key="n"><strong>{credor?.nome ?? '—'}</strong></span>,
				<span key="t">Tipo: {credor?.entrada_carga === 'api' ? 'carga por API' : 'carga por arquivo'}</span>,
				<span key="c">{numberBR(totalClientes)} clientes</span>,
			],
		},
		{
			ok: segmentos.length > 0,
			titulo: 'Quem',
			linhas: segmentos.length === 0
				? ['Nenhum segmento em uso nesta carteira.']
				: segmentos.map(s => <span key={s.cluster_id}>{s.codigo} {s.nome} · {numberBR(countBySeg[s.codigo] ?? 0)} clientes</span>),
		},
		{
			ok: semEstagio === 0,
			titulo: `Em que estágio · ${estagiosAtivos} estágios${estagiosDesligados > 0 ? ` (${estagiosDesligados} desligado${estagiosDesligados > 1 ? 's' : ''})` : ''}`,
			linhas: semEstagio > 0
				? [<span key="s">≈ {numberBR(semEstagio)} clientes sem estágio ficam sem ação. Pode salvar assim, se for de propósito.</span>]
				: [<span key="ok">Todos os clientes caem num estágio.</span>],
		},
		{
			ok: semRegua.length === 0,
			titulo: `O que fazer · ${comRegua} de ${ESTAGIOS.length} estágios com régua`,
			linhas: semRegua.length === 0
				? ['Todos os estágios ativos têm régua.']
				: semRegua.map(e => <span key={e.id}>{e.nome}: sem régua — o motor ignora este estágio.</span>),
		},
		{
			ok: true,
			titulo: 'Regras de contato',
			linhas: ['Dentro das faixas de segurança: 08:00–20:00, intervalo mínimo de 12 h, freio do WhatsApp até 5%.'],
		},
	];

	return (
		<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
			<div className="space-y-3">
				{cartoes.map((c, i) => (
					<CartaoConferencia
						key={i}
						{...c}
						acao={i === 2 && semEstagio > 0
							? <button type="button" onClick={onVerEstagios} className="text-[12px] font-semibold text-[var(--destaque)] hover:underline">Ver estágios</button>
							: i === 3 && semRegua.length > 0
								? <button type="button" onClick={onMontarAgora} className="text-[12px] font-semibold text-[var(--destaque)] hover:underline">Montar agora</button>
								: undefined}
					/>
				))}
			</div>
			<div className="lg:sticky lg:top-[88px] lg:self-start">
				<div className="rounded-xl border border-[var(--base-borda)] bg-[var(--base-cartao)] p-5">
					<p className="text-[13px] font-bold text-[var(--base-texto)]">Salvar</p>
					{canEdit ? (
						<>
							<label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--base-borda)] bg-[var(--base-fill)] px-3 py-2.5">
								<input type="checkbox" checked={guardarModelo} onChange={e => setGuardarModelo(e.target.checked)} className="mt-0.5 accent-[var(--destaque)]" />
								<span className="text-[12px] leading-snug text-[var(--base-texto-2)]"><strong className="text-[var(--base-texto)]">Guardar como modelo da empresa</strong><br />Cria uma estratégia nova com a mesma definição, sem vínculo com segmento. Quem usar recebe uma cópia.</span>
							</label>
							<button type="button" onClick={onSalvar} disabled={saving} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg px-5 text-[14px] font-semibold text-[var(--destaque-texto)] disabled:opacity-50" style={{ backgroundColor: 'var(--destaque)' }}>
								{estrDirty && <span className="h-2 w-2 rounded-full bg-[var(--estado-atencao)]" />}
								{saving ? 'Salvando...' : estrDirty ? 'Salvar alterações' : 'Salvar estratégia'}
							</button>
							<p className="mt-2 text-center text-[11px] text-[var(--base-texto-3)]">Vale na próxima lista do dia.</p>
						</>
					) : (
						<p className="mt-3 text-[12px] text-[var(--base-texto-3)]">Somente leitura. Peça a um administrador para salvar.</p>
					)}
				</div>
			</div>
		</div>
	);
}
