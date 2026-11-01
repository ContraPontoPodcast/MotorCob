// Peças comuns das telas do Fluxo do agente: carregar dados, mensagens de erro, nome da carteira e as gavetas que
// mais de uma tela abre (alçada da carteira, quem edita e aprova, regras fixas, como ler o quadro).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { MODOS, TRAVAS } from '@/lib/fluxo';
import { Botao, campoCls, campoStyle } from '@/components/voz/ui';
import type { AlcadaRow } from './api';
import { Campo, Gaveta, Kv, Linhas, Ponto, Regras } from './ds';
import { useFluxo, usePermissoesFluxo } from './contexto';

export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[]): { dados: T | null; erro: string; carregando: boolean; recarregar: () => Promise<void> } {
	const [dados, setDados] = useState<T | null>(null);
	const [erro, setErro] = useState('');
	const [carregando, setCarregando] = useState(true);
	const seq = useRef(0);
	const recarregar = useCallback(async () => {
		const n = ++seq.current;
		setCarregando(true); setErro('');
		try {
			const d = await fn();
			if (n === seq.current) setDados(d);
		} catch (e) {
			if (n === seq.current) setErro(mensagem(e));
		} finally {
			if (n === seq.current) setCarregando(false);
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	useEffect(() => { void recarregar(); }, [recarregar]);
	return { dados, erro, carregando, recarregar };
}

/** Mensagem legível de erro do banco (as RPCs já respondem em português). */
export function mensagem(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e ?? '');
	if (/JWT|session/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
	if (/permission denied|sem permissão/i.test(m)) return m.includes('sem permissão') ? m : 'Seu perfil não tem permissão para isso.';
	return m || 'Não foi possível concluir agora.';
}

/** Executa uma ação com aviso de sucesso ou de erro. */
export async function executar(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
	try { await fn(); if (ok) toast.success(ok); return true; } catch (e) { toast.error(mensagem(e)); return false; }
}

export function useNomeCarteira() {
	const { credores } = useFluxo();
	return (id: number | null | undefined) => (id == null ? 'Empresa toda' : credores.find(c => c.id === Number(id))?.nome ?? `Carteira ${id}`);
}

export const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function diasAtras(n: number): string {
	const d = new Date(`${hojeSP()}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

export function GavetaQuem({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo="Quem edita e quem aprova">
			<Regras itens={[
				['Um fluxo em uso por carteira.', 'Sem carteira escolhida, o fluxo vale para a empresa toda.'],
				['Edita quem tem a permissão Editar canais; aprova e coloca em uso quem tem Aprovar roteiro de voz.', 'A equipe MotorCX não edita nem aprova o fluxo de vocês.'],
				['A versão em uso vale até a próxima ser aprovada e colocada em uso.', 'Entra na próxima ligação; uma ligação em curso nunca muda de versão.'],
				['Voltar para uma versão anterior é um botão.', 'A atual vai para o arquivo. Nada é apagado.'],
				['A alçada da carteira é de quem edita as carteiras.', 'É o teto de toda oferta, inclusive das que vêm do CRM.'],
			]} />
		</Gaveta>
	);
}

export function GavetaTravas({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
	return <Gaveta aberta={aberta} onFechar={onFechar} titulo={`Regras fixas · nenhum fluxo desliga`}><Regras itens={TRAVAS} /></Gaveta>;
}

export function GavetaComoLer({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo="Como ler o quadro">
			<div className="space-y-2">
				{Object.values(MODOS).map(m => (
					<div key={m.nome} className="flex items-start gap-2.5 rounded-xl bg-[var(--base-fill)] px-3 py-2.5">
						<span className="mt-1"><Ponto cor={m.cor} tam={10} /></span>
						<span className="min-w-0 text-[13px] text-[var(--base-texto)]"><b className="font-semibold">{m.nome}</b> <span className="text-[12px] text-[var(--base-texto-3)]">(antes: {m.antigo})</span><small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{m.desc}</small></span>
					</div>
				))}
			</div>
			<Linhas itens={[
				{ e: <b>Sim → N5</b>, s: 'saída para outra etapa' },
				{ e: <b>Não ↪ N13</b>, s: 'atalho para um final compartilhado' },
				{ e: <span className="font-semibold text-[var(--estado-erro-texto)]">impede</span>, s: 'pendência que segura o envio para aprovação' },
			]} />
		</Gaveta>
	);
}

/** Alçada da carteira (FL6): teto do agente, com vigência. Edita quem tem Editar carteiras (salvar_alcada_voz). */
export function GavetaAlcada({ aberta, onFechar, credor, alcada, aoSalvar }: { aberta: boolean; onFechar: () => void; credor: number | null; alcada: AlcadaRow | null; aoSalvar: () => void }) {
	const { api, empresa } = useFluxo();
	const pode = usePermissoesFluxo().alcada;
	const nome = useNomeCarteira();
	const [f, setF] = useState({ desconto: '', parcelas: '', parcelaMin: '', entradaMin: '0', validade: '5', desde: '' });
	useEffect(() => {
		if (!aberta) return;
		setF({ desconto: String(alcada?.desconto_max_pct ?? ''), parcelas: String(alcada?.parcelas_max ?? ''), parcelaMin: String(alcada?.parcela_min ?? ''), entradaMin: String(alcada?.entrada_min ?? 0), validade: String(alcada?.validade_dias ?? 5), desde: '' });
	}, [aberta, alcada]);
	const n = (s: string) => Number(String(s).replace(',', '.'));
	const valido = n(f.desconto) >= 0 && n(f.desconto) <= 100 && Number.isInteger(n(f.parcelas)) && n(f.parcelas) >= 1 && n(f.parcelas) <= 60 && n(f.parcelaMin) >= 0 && n(f.validade) >= 1 && n(f.validade) <= 30 && f.parcelaMin !== '';
	async function salvar() {
		if (!api || !empresa || !valido) return;
		const ok = await executar(() => api.salvarAlcada({ empresa: empresa.id, credor, desconto: n(f.desconto), parcelas: n(f.parcelas), parcelaMin: n(f.parcelaMin), entradaMin: n(f.entradaMin) || 0, validade: n(f.validade), desde: f.desde || null }), 'Alçada salva. Vale a partir da data de início.');
		if (ok) { aoSalvar(); onFechar(); }
	}
	const campo = (k: keyof typeof f, tipo = 'text') => <input type={tipo} inputMode={tipo === 'text' ? 'decimal' : undefined} value={f[k]} disabled={!pode} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} className={`${campoCls} w-full`} style={campoStyle} />;
	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo={`Alçada · ${nome(credor)}`} sub="Teto do agente nesta carteira: vale para a oferta da carteira, para a conversa livre e também para as ofertas do CRM."
			pe={pode ? <Botao onClick={() => void salvar()} disabled={!valido}>{alcada ? 'Salvar nova vigência' : 'Cadastrar alçada'}</Botao> : undefined}>
			{alcada ? <Kv itens={[['Desconto máximo', `${alcada.desconto_max_pct}%`], ['Parcelas', `até ${alcada.parcelas_max}×`], ['Parcela mínima', `R$ ${Number(alcada.parcela_min).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`], ['Vigente desde', alcada.vigente_desde.split('-').reverse().join('/')]]} />
				: <p className="text-[13px] text-[var(--base-texto-2)]">Sem alçada cadastrada. Sem ela, o fluxo não pode oferecer nada (nem as ofertas do CRM).</p>}
			{pode ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<Campo rotulo="Desconto máximo (%)">{campo('desconto')}</Campo>
					<Campo rotulo="Parcelas (máximo)">{campo('parcelas')}</Campo>
					<Campo rotulo="Parcela mínima (R$)">{campo('parcelaMin')}</Campo>
					<Campo rotulo="Entrada mínima (R$)">{campo('entradaMin')}</Campo>
					<Campo rotulo="Validade da proposta (dias)">{campo('validade')}</Campo>
					<Campo rotulo="Vale a partir de" ajuda="Vazio = hoje. Mudar é criar uma vigência nova; a anterior fecha no dia de antes.">{campo('desde', 'date')}</Campo>
				</div>
			) : <p className="text-[12.5px] text-[var(--base-texto-3)]">Quem tem a permissão Editar carteiras cadastra a alçada.</p>}
		</Gaveta>
	);
}

export function Erro({ children }: { children: ReactNode }) {
	return <p role="alert" className="rounded-xl px-3 py-2 text-[13px]" style={{ backgroundColor: 'var(--estado-erro-fundo)', color: 'var(--estado-erro-texto)' }}>{children}</p>;
}
