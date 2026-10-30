import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Phone, Smartphone } from 'lucide-react';
import { Loading, Notice, useAllowed } from '@/components/app-shell';
import { EscolhaCarteira } from '@/components/escolha-carteira';
import { useMotorAuth } from '@/components/auth-provider';
import { friendlyError, supabase, type Row } from '@/lib/supabase';
import { CANAL_COR, CANAL_NOME } from '@/lib/personas';
import { Info } from '@/components/glossario/info';

type CondicaoModelo = { campo: string; op: string; valor: string | string[] };
type PersonaModelo = {
	id: string;
	propensao: 'digital' | 'analogico';
	nome: string;
	descricao: string | null;
	canais_sugeridos: string[];
	condicoes: CondicaoModelo[];
	campos_necessarios: string[];
	ordem: number;
	cor: string;
};

const CAMPO_LABEL: Record<string, string> = {
	saldo: 'Saldo total', dias_atraso: 'Dias de atraso', qtd_contratos: 'Quantidade de contratos',
	ddd: 'DDD', tem_whatsapp: 'tem WhatsApp', tem_rcs: 'tem RCS',
	idade: 'idade', tem_email: 'tem e-mail', tem_celular: 'tem celular', so_fixo: 'só fixo', qtd_telefones: 'qtd. telefones',
};
const opSimbolo: Record<string, string> = { '=': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤', em: '∈', nao_em: '∉', contem: 'contém', vazio: 'está vazio', preenchido: 'está preenchido' };
const CANAL_ORDEM = ['whatsapp', 'rcs', 'sms', 'email', 'agente_voz', 'discador'];

function condFrase(conds: CondicaoModelo[] | null | undefined): string {
	if (!conds || conds.length === 0) return 'Sem condições (vale para todos)';
	const label = (campo: string) => CAMPO_LABEL[campo] ?? campo;
	const valStr = (v: unknown) => Array.isArray(v) ? v.join('; ') : String(v ?? '');
	return conds.map(c => {
		if (c.op === 'vazio' || c.op === 'preenchido') return `${label(c.campo)} ${opSimbolo[c.op]}`;
		return `${label(c.campo)} ${opSimbolo[c.op] ?? c.op} ${valStr(c.valor)}`;
	}).join(' · ');
}

function ordenarCanais(canais: string[]): string[] {
	return [...canais].sort((a, b) => {
		const ia = CANAL_ORDEM.indexOf(a);
		const ib = CANAL_ORDEM.indexOf(b);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
	});
}

function canaisTexto(canais: string[]): string {
	return ordenarCanais(canais).map(c => CANAL_NOME[c] ?? c).join(', ');
}

function temColunaIdade(colunas: { nome: string }[]): boolean {
	return colunas.some(c => {
		const n = c.nome.toLowerCase();
		return n === 'idade' || n.includes('nasc') || n.includes('idade');
	});
}

export function ModelosMotorCob() {
	const { empresa, credor } = useMotorAuth();
	const navigate = useNavigate();
	const canEdit = useAllowed(['admin', 'planejamento']);
	const [modelos, setModelos] = useState<PersonaModelo[]>([]);
	const [colunas, setColunas] = useState<{ nome: string }[]>([]);
	const [nomesExistentes, setNomesExistentes] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState('');

	async function reload() {
		if (!supabase || !empresa) { setModelos([]); setLoading(false); return; }
		setLoading(true); setError('');
		const [m, emp, pu] = await Promise.all([
			supabase.from('personas_modelo').select('*').order('ordem', { ascending: true }),
			supabase.from('empresas').select('colunas_base').eq('id', empresa.id).maybeSingle(),
			credor ? supabase.from('personas_usuario').select('nome').eq('credor_id', credor.id) : Promise.resolve({ data: [] as Row[], error: null as unknown }),
		]);
		if (m.error) { setError(friendlyError()); setLoading(false); return; }
		setModelos((m.data ?? []) as PersonaModelo[]);
		const cb = (emp.data as Row | null)?.colunas_base;
		setColunas(Array.isArray(cb?.colunas) ? cb.colunas : []);
		setNomesExistentes(new Set(((pu.data ?? []) as Row[]).map(r => r.nome as string)));
		setLoading(false);
	}
	useEffect(() => { void reload(); }, [empresa?.id, credor?.id]);

	async function inserirModelo(modelo: PersonaModelo): Promise<'ok' | 'existe' | 'erro'> {
		if (!supabase || !credor) return 'erro';
		if (nomesExistentes.has(modelo.nome)) return 'existe';
		const payload = {
			credor_id: credor.id,
			nome: modelo.nome,
			descricao: (modelo.descricao ?? '') + (modelo.canais_sugeridos?.length ? ' · Canais sugeridos: ' + canaisTexto(modelo.canais_sugeridos) : ''),
			condicoes: (modelo.condicoes ?? []) as unknown as Record<string, unknown>,
			cor: modelo.cor,
			ordem: modelo.ordem,
			ativo: true,
		};
		const { error } = await supabase.from('personas_usuario').insert(payload);
		if (error) return 'erro';
		setNomesExistentes(prev => new Set(prev).add(modelo.nome));
		return 'ok';
	}

	async function usarModelo(modelo: PersonaModelo) {
		setBusy(modelo.id);
		const r = await inserirModelo(modelo);
		if (r === 'existe') toast('Já está na carteira');
		else if (r === 'erro') setError(friendlyError());
		else toast.success('Persona adicionada à carteira · vale a partir da próxima rotina', { action: { label: 'Ir para a Orquestração', onClick: () => navigate('/orquestracao?montar=1') } });
		setBusy('');
	}

	async function usarTodos(propensao: 'digital' | 'analogico' | 'todos') {
		if (!credor) return;
		setBusy('todos');
		const alvo = propensao === 'todos' ? modelos : modelos.filter(m => m.propensao === propensao);
		let added = 0;
		for (const m of alvo) {
			const r = await inserirModelo(m);
			if (r === 'ok') added++;
		}
		if (added > 0) toast.success(`${added} persona${added > 1 ? 's' : ''} adicionada${added > 1 ? 's' : ''} à carteira · vale a partir da próxima rotina`, { action: { label: 'Ir para a Orquestração', onClick: () => navigate('/orquestracao?montar=1') } });
		else toast('Nenhuma persona nova para adicionar');
		setBusy('');
	}

	if (!empresa) return null;
	if (loading) return (
		<section className="mb-8 rounded-xl border border-[#dfe8ea] bg-white p-6">
			<h2 className="mb-4 text-lg font-semibold text-[#163943]">Modelos MotorCX</h2>
			<Loading />
		</section>
	);

	const digitais = modelos.filter(m => m.propensao === 'digital');
	const analogicos = modelos.filter(m => m.propensao === 'analogico');
	const cargaTemIdade = temColunaIdade(colunas);
	const temCredor = !!credor;

	return (
		<section className="mb-8 rounded-xl border border-[#dfe8ea] bg-white p-6">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-lg font-semibold text-[#163943]">Modelos MotorCX</h2>
				{canEdit && temCredor && modelos.length > 0 && (
					<div className="flex flex-wrap gap-2">
						<button onClick={() => usarTodos('digital')} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#1F8A4C] px-3 text-xs font-semibold text-[#1F8A4C] hover:bg-[#eaf6ee] disabled:opacity-50"><Smartphone size={14}/> Usar todos os digitais</button>
						<button onClick={() => usarTodos('analogico')} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg border border-[#9a631b] px-3 text-xs font-semibold text-[#9a631b] hover:bg-[#fff3df] disabled:opacity-50"><Phone size={14}/> Usar todos os analógicos</button>
						<button onClick={() => usarTodos('todos')} disabled={!!busy} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#0F4C5C] px-3 text-xs font-semibold text-white hover:bg-[#0d4252] disabled:opacity-50">Usar todos</button>
					</div>
				)}
			</div>
			<p className="mb-5 max-w-3xl text-sm leading-relaxed text-slate-500">Pontos de partida com base no mercado de cobrança. Copie para a carteira e ajuste. A inteligência do MotorCX confirma ou corrige com os resultados.</p>

			{error && <div className="mb-4"><Notice>{error}</Notice></div>}

			{!credor ? (
				<EscolhaCarteira texto="Copie modelos para a carteira." />
			) : modelos.length === 0 ? (
				<p className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-6 py-10 text-center text-sm text-slate-400">Nenhum modelo disponível no momento.</p>
			) : (
				<div className="grid gap-6 lg:grid-cols-2">
					<ColunaPropensao titulo="Prefere digital" icon={<Smartphone size={16} />} cor="#1F8A4C" modelos={digitais} cargaTemIdade={cargaTemIdade} canEdit={canEdit} temCredor={temCredor} nomesExistentes={nomesExistentes} busy={busy} onUsar={usarModelo} />
					<ColunaPropensao titulo="Prefere analógico" icon={<Phone size={16} />} cor="#E9A23B" modelos={analogicos} cargaTemIdade={cargaTemIdade} canEdit={canEdit} temCredor={temCredor} nomesExistentes={nomesExistentes} busy={busy} onUsar={usarModelo} />
				</div>
			)}
		</section>
	);
}

function ColunaPropensao({ titulo, icon, cor, modelos, cargaTemIdade, canEdit, temCredor, nomesExistentes, busy, onUsar }: {
	titulo: string; icon: React.ReactNode; cor: string; modelos: PersonaModelo[];
	cargaTemIdade: boolean; canEdit: boolean; temCredor: boolean; nomesExistentes: Set<string>;
	busy: string; onUsar: (m: PersonaModelo) => void;
}) {
	return (
		<div>
			<div className="mb-3 flex items-center gap-2">
				<span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ backgroundColor: cor }}>{icon}</span>
				<h3 className="flex items-center gap-1.5 text-sm font-bold text-[#163943]">{titulo} <Info slug="prefere-digital-e-prefere-analogico" /></h3>
			</div>
			{modelos.length === 0 ? (
				<p className="rounded-lg border border-dashed border-[#cbd9dd] bg-[#fafcfc] px-4 py-8 text-center text-xs text-slate-400">Nenhum modelo nesta categoria.</p>
			) : (
				<div className="space-y-3">
					{modelos.map(m => (
						<ModeloCard key={m.id} modelo={m} cargaTemIdade={cargaTemIdade} canEdit={canEdit} temCredor={temCredor} jaExiste={nomesExistentes.has(m.nome)} busy={busy} onUsar={onUsar} />
					))}
				</div>
			)}
		</div>
	);
}

function ModeloCard({ modelo, cargaTemIdade, canEdit, temCredor, jaExiste, busy, onUsar }: {
	modelo: PersonaModelo; cargaTemIdade: boolean; canEdit: boolean; temCredor: boolean; jaExiste: boolean; busy: string; onUsar: (m: PersonaModelo) => void;
}) {
	const precisaIdade = modelo.campos_necessarios?.includes('idade');
	const canais = ordenarCanais(modelo.canais_sugeridos ?? []);
	return (
		<div className="rounded-lg border border-[#e2eaec] bg-[#fafcfc] p-4">
			<div className="flex items-center gap-2">
				<span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: modelo.cor }} />
				<h4 className="text-sm font-semibold text-[#163943]">{modelo.nome}</h4>
			</div>
			{modelo.descricao && <p className="mt-2 text-xs leading-relaxed text-slate-500">{modelo.descricao}</p>}
			<p className="mt-2 text-xs text-slate-600">{condFrase(modelo.condicoes)}</p>

			{canais.length > 0 && (
				<div className="mt-3">
					<p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Canais sugeridos</p>
					<div className="flex flex-wrap gap-1.5">
						{canais.map(c => (
							<span key={c} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: CANAL_COR[c] ?? '#475569' }}>{CANAL_NOME[c] ?? c}</span>
						))}
					</div>
				</div>
			)}

			{precisaIdade && (
				cargaTemIdade ? (
					<span className="mt-3 inline-block rounded-full bg-[#eaf2f3] px-2.5 py-0.5 text-[10px] font-semibold text-[#0F4C5C]">Precisa da data de nascimento (ou IDADE) na carga</span>
				) : (
					<span className="mt-3 inline-block rounded-full bg-[#fff7e8] px-2.5 py-0.5 text-[10px] font-semibold text-[#9a631b]">Sua carga não tem idade: este modelo não vai pegar ninguém</span>
				)
			)}

			{canEdit && temCredor && (
				<button
					onClick={() => onUsar(modelo)}
					disabled={jaExiste || !!busy}
					className={`mt-3 flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-60 ${jaExiste ? 'cursor-default border border-[#c9dadd] bg-[#f5f8f9] text-slate-400' : 'bg-[#0F4C5C] text-white hover:bg-[#0d4252]'}`}
				>
					{jaExiste ? 'Já está na carteira' : 'Usar nesta carteira'}
				</button>
			)}
		</div>
	);
}
