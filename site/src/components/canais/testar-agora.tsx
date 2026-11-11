// Canais › Agente de voz › "Testar agora" (SQL 116; PR 9 do plano Canais/Agente Voz/CX; SPEC §1.2 e §5): uma ligação
// de verdade para um número de teste confirmado, com o fluxo em uso da carteira e a rota de hoje. Quem pode:
// editar_canais. O site nunca vê o número (só a máscara): o pedido leva o id do número de teste, a VM lê o número no
// cofre. Resultado em lista ✓ / ! / ✕ e a frase final, lendo voz_testes_agora a cada 3 s até o fim.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Check, CircleAlert, Loader2, X } from 'lucide-react';
import { Aviso, Botao, Gaveta, ListaRegras, Pilula, Rotulo, campoCls, campoStyle } from '@/components/ds';
import { friendlyError, supabase } from '@/lib/supabase';
import { ROTA_TELEFONIA } from '@/lib/rotas-voz';
import {
	COLUNAS, FINAL, LIMITE_DIA, REGRAS_TESTE, fraseFinal, itensTeste, usadosHoje,
	type ItemTeste, type NumeroTeste, type TesteAgora, type TomItem,
} from '@/lib/testar-agora';

const ICONE: Record<TomItem, { cor: string; el: React.ReactNode; rotulo: string }> = {
	ok: { cor: 'var(--estado-pronto)', el: <Check size={14} aria-hidden />, rotulo: 'certo' },
	atencao: { cor: 'var(--estado-atencao)', el: <CircleAlert size={14} aria-hidden />, rotulo: 'atenção' },
	erro: { cor: 'var(--estado-erro)', el: <X size={14} aria-hidden />, rotulo: 'problema' },
	pendente: { cor: 'var(--base-texto-3)', el: <Loader2 size={14} className="animate-spin" aria-hidden />, rotulo: 'em andamento' },
};

/** O resultado (sem banco: o teste renderiza com uma linha de voz_testes_agora). */
export function ResultadoTeste({ teste }: { teste: TesteAgora }) {
	const itens: ItemTeste[] = itensTeste(teste);
	const fim = fraseFinal(itens);
	return (
		<div className="flex flex-col gap-3" aria-live="polite">
			<ul className="flex flex-col gap-2">
				{itens.map(i => (
					<li key={i.titulo} className="flex gap-2.5 text-[13px]">
						<span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white" style={{ backgroundColor: ICONE[i.tom].cor }} title={ICONE[i.tom].rotulo}>{ICONE[i.tom].el}</span>
						<span className="min-w-0">
							<b className="font-semibold text-[var(--base-texto)]">{i.titulo}</b>
							{i.texto && <span className="block text-[var(--base-texto-2)]">{i.texto}</span>}
						</span>
					</li>
				))}
			</ul>
			<p className="rounded-xl px-3.5 py-2.5 text-[13.5px] font-semibold" style={{ backgroundColor: 'var(--base-fill)', color: ICONE[fim.tom].cor }}>{fim.texto}</p>
		</div>
	);
}

export function TestarAgoraVoz({ aberta, onFechar, empresaId, credorId }: { aberta: boolean; onFechar: () => void; empresaId: number; credorId: number | null }) {
	const [numeros, setNumeros] = useState<NumeroTeste[] | null>(null);
	const [carteiras, setCarteiras] = useState<{ id: number; nome: string }[]>([]);
	const [numero, setNumero] = useState<number | null>(null);
	const [carteira, setCarteira] = useState<number | null>(credorId);
	const [hoje, setHoje] = useState<TesteAgora[]>([]);
	const [atual, setAtual] = useState<TesteAgora | null>(null);
	const [pedindo, setPedindo] = useState(false);
	const [erro, setErro] = useState('');
	const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

	useEffect(() => {
		if (!aberta || !supabase) return;
		const sb = supabase;
		setErro('');
		void Promise.all([
			sb.rpc('numeros_teste_agora_voz', { empresa: empresaId }),
			sb.from('credores').select('id,nome').eq('empresa_id', empresaId).eq('ativo', true).order('nome'),
			sb.from('voz_testes_agora').select(COLUNAS).eq('empresa_id', empresaId).order('pedido_em', { ascending: false }).limit(10),
		]).then(([n, c, t]) => {
			if (n.error) setErro(friendlyError(n.error));
			const ns = ((n.data ?? []) as NumeroTeste[]);
			setNumeros(ns);
			setNumero(v => v ?? ns.find(x => x.pronto)?.id ?? null);
			setCarteiras(((c.data ?? []) as { id: number; nome: string }[]));
			const ts = (t.data ?? []) as TesteAgora[];
			setHoje(ts);
			const vivo = ts.find(x => !FINAL.has(x.situacao));
			if (vivo) setAtual(vivo);
		});
	}, [aberta, empresaId]);
	useEffect(() => { setCarteira(c => c ?? credorId); }, [credorId]);

	// acompanha o teste até o fim (a cada 3 s; para quando chega a um estado final ou a gaveta fecha)
	useEffect(() => {
		if (!aberta || !supabase || !atual || FINAL.has(atual.situacao)) return;
		const sb = supabase, id = atual.id;
		const t = window.setInterval(() => {
			void sb.from('voz_testes_agora').select(COLUNAS).eq('id', id).maybeSingle().then(({ data }) => { if (data) setAtual(data as TesteAgora); });
		}, 3000);
		return () => window.clearInterval(t);
	}, [aberta, atual?.id, atual?.situacao]);

	const usados = usadosHoje(hoje, dia);
	const prontos = (numeros ?? []).filter(n => n.pronto);
	const andamento = !!atual && !FINAL.has(atual.situacao);
	const pode = !!numero && !!carteira && !andamento && usados < LIMITE_DIA && !pedindo;

	async function ligar() {
		if (!supabase || !numero || !carteira) return;
		setPedindo(true);
		const { data, error } = await supabase.rpc('pedir_teste_agora_voz', { credor: carteira, numero_teste: numero });
		setPedindo(false);
		if (error) { toast.error(friendlyError(error)); return; }
		const { data: linha } = await supabase.from('voz_testes_agora').select(COLUNAS).eq('id', Number(data)).maybeSingle();
		if (linha) { setAtual(linha as TesteAgora); setHoje(h => [linha as TesteAgora, ...h]); }
		toast.success('Teste pedido. Atenda o celular de teste.');
	}
	async function cancelar() {
		if (!supabase || !atual) return;
		const { error } = await supabase.rpc('cancelar_teste_agora_voz', { teste: atual.id });
		if (error) { toast.error(friendlyError(error)); return; }
		setAtual({ ...atual, situacao: 'cancelado', motivo: 'cancelado por quem pediu' });
	}

	return (
		<Gaveta aberta={aberta} onFechar={onFechar} titulo="Testar agora" largura={520}
			subtitulo={`Uma ligação de verdade para um número de teste · ${usados} de ${LIMITE_DIA} hoje`}
			rodape={<>
				{andamento && atual?.situacao === 'pedido' && <Botao tipo="secundario" onClick={() => void cancelar()}>Cancelar</Botao>}
				<Botao onClick={() => void ligar()} disabled={!pode}>{pedindo ? 'Pedindo…' : 'Ligar agora'}</Botao>
			</>}>
			<div className="flex flex-col gap-4">
				{erro && <Aviso tom="erro">{erro}</Aviso>}
				{numeros && prontos.length === 0 && (
					<Aviso tom="info" titulo="Nenhum número de teste pronto">
						Cadastre e confirme um celular da sua equipe em <Link to={ROTA_TELEFONIA} className="font-semibold underline">Agente Voz/CX › Telefonia</Link>. O número fica no cofre; aqui aparece só a máscara.
					</Aviso>
				)}
				<div className="grid gap-3 sm:grid-cols-2">
					<Rotulo texto="Número de teste">
						<select className={campoCls} style={campoStyle} value={numero ?? ''} disabled={andamento} onChange={e => setNumero(e.target.value ? Number(e.target.value) : null)}>
							<option value="">Escolha</option>
							{(numeros ?? []).map(n => <option key={n.id} value={n.id} disabled={!n.pronto}>{n.mascara}{n.pronto ? '' : ' · falta confirmar'}</option>)}
						</select>
					</Rotulo>
					<Rotulo texto="Carteira (o fluxo em uso dela)">
						<select className={campoCls} style={campoStyle} value={carteira ?? ''} disabled={andamento} onChange={e => setCarteira(e.target.value ? Number(e.target.value) : null)}>
							<option value="">Escolha</option>
							{carteiras.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
						</select>
					</Rotulo>
				</div>
				{usados >= LIMITE_DIA && !andamento && <Aviso tom="atencao">Limite de {LIMITE_DIA} testes hoje. Amanhã libera de novo.</Aviso>}
				{atual ? (
					<div className="rounded-2xl border p-3.5" style={{ borderColor: 'var(--base-borda)' }}>
						<div className="mb-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--base-texto-2)]">
							<Pilula tom={FINAL.has(atual.situacao) ? 'neutro' : 'info'}>{FINAL.has(atual.situacao) ? 'último teste' : 'agora'}</Pilula>
							{atual.mascara} · {new Date(atual.pedido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
						</div>
						<ResultadoTeste teste={atual} />
					</div>
				) : null}
				<ListaRegras regras={REGRAS_TESTE} />
			</div>
		</Gaveta>
	);
}
