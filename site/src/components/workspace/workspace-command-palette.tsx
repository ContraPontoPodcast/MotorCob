import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, CornerDownLeft } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { PERM } from '@/lib/permissoes';
import { ROTA_AGENTE, ROTA_DISCAGEM, ROTA_ENTRADA_GRAVACOES, ROTA_GRAVACOES, ROTA_LIGACOES, ROTA_SPEECH, ROTA_TELEFONIA, ROTA_VOZ } from '@/lib/rotas-voz';
import { useAreasLiberadas, type AreasLiberadas } from '@/hooks/use-areas-liberadas';

/** area: a tela é de uma área; sem a área contratada o atalho não aparece. */
export type Atalho = { id: string; label: string; to: string; perm?: string; keywords: string; area?: 'cobranca' | 'jornada' | 'mensageria' };

/** Lista fixa de atalhos do Workspace, usada pela busca da página inicial e pelo ⌘K. */
export const ATALHOS: Atalho[] = [
	{ id: 'lista', label: 'Abrir a Lista do dia', to: '/fila', keywords: 'lista dia fila clientes ação hoje', area: 'cobranca' },
	{ id: 'jornada-lista', label: 'Abrir a Lista do dia da Jornada', to: '/jornada/lista', keywords: 'lista dia jornada clientes hoje', area: 'jornada' },
	{ id: 'respostas', label: 'Respostas dos clientes', to: '/mensageria/atendimento', keywords: 'respostas atendimento caixa mensageria conversas', area: 'mensageria' },
	{ id: 'chamado-novo', label: 'Abrir chamado', to: '/suporte/novo', keywords: 'chamado suporte novo ticket abrir' },
	{ id: 'chamados', label: 'Meus chamados', to: '/suporte', keywords: 'chamados suporte tickets meus' },
	{ id: 'convidar', label: 'Convidar membro', to: '/empresa/pessoas?aba=pessoas', keywords: 'convidar membro usuário equipe' },
	{ id: 'contatos', label: 'Contatos da empresa', to: '/empresa/contatos', keywords: 'contatos empresa' },
	{ id: 'uso-ia', label: 'Uso de IA', to: '/empresa/uso-ia', keywords: 'uso de ia créditos de ia crédito franquia excedente especialista descrever inteligência artificial consumo' },
	{ id: 'faturas', label: 'Faturas', to: '/empresa/faturamento', perm: PERM.verFaturamento, keywords: 'faturas faturamento boleto nota' },
	{ id: 'conta', label: 'Minha conta', to: '/conta', keywords: 'conta perfil minha' },
	{ id: '2fa', label: 'Verificação em duas etapas', to: '/conta?aba=seguranca', keywords: 'verificação duas etapas segurança mfa autenticador' },
	{ id: 'docs', label: 'Documentação', to: '/docs', keywords: 'documentação docs ajuda manual' },
	// Cobrança (ganhos rápidos da implantação): as telas que mais se procuram, com sinônimos
	{ id: 'implantacao', label: 'Assistente de implantação', to: '/implantacao', keywords: 'implantação implantar onboarding começar primeiros passos nova empresa configurar cliente novo colunas mapeamento', area: 'cobranca' },
	{ id: 'carteiras', label: 'Carteiras', to: '/credores', keywords: 'carteira carteiras credor credores nova carteira configurações da carteira colunas ocorrências', area: 'cobranca' },
	{ id: 'cargas', label: 'Cargas', to: '/envios', perm: PERM.enviarArquivos, keywords: 'carga cargas enviar arquivo upload base mailing planilha csv xlsx ocorrência acordo baixa pagamento', area: 'cobranca' },
	{ id: 'orquestracao', label: 'Orquestração', to: '/orquestracao', keywords: 'orquestração régua réguas esteira estratégia segmentos estágios playbook reenquadrar', area: 'cobranca' },
	// Agente Voz/CX e Speech Analytics (áreas próprias; vêm com a Cobrança).
	{ id: 'discagem', label: 'Regras de discagem', to: ROTA_DISCAGEM, keywords: 'discagem discador regras de discagem renitência rediscagem rediscar tentativas spins horário de ligar resubmit reciclagem chamadas curtas ligação voz', area: 'cobranca' },
	{ id: 'agente-voz-cx', label: 'Agente Voz/CX', to: ROTA_VOZ, keywords: 'agente voz cx voz ligações ligar discador robô área', area: 'cobranca' },
	{ id: 'agente-virtual', label: 'Agente de voz', to: ROTA_AGENTE, keywords: 'agente virtual agente de voz voz ia robô ligação fluxo fluxos editor pedido em texto testar conversa personas roteiro', area: 'cobranca' },
	{ id: 'ligacoes-voz', label: 'Ligações do agente', to: ROTA_LIGACOES, keywords: 'ligações lotes do agente lote de voz reenviar reciclar mailing pausar em curso ao vivo', area: 'cobranca' },
	{ id: 'telefonia', label: 'Telefonia', to: ROTA_TELEFONIA, keywords: 'telefonia tronco sip operadora rota bina transferência conexão ip', area: 'cobranca' },
	{ id: 'speech', label: 'Speech Analytics', to: ROTA_SPEECH, keywords: 'speech analytics insights de voz qualidade operadores alertas recomendações curadoria transcrição', area: 'cobranca' },
	{ id: 'gravacoes', label: 'Gravações', to: ROTA_GRAVACOES, perm: 'ouvir_gravacoes', keywords: 'gravações gravação ouvir áudio ligação', area: 'cobranca' },
	{ id: 'entrada-gravacoes', label: 'Entrada de gravações', to: ROTA_ENTRADA_GRAVACOES, keywords: 'entrada de gravações gravações do discador enviar gravações importar sftp quarentena', area: 'cobranca' },
	{ id: 'canais', label: 'Canais', to: '/canais', perm: PERM.editarCanais, keywords: 'canais canal janela horário custo capacidade sábado quem envia lista para baixar fornecedor', area: 'cobranca' },
	{ id: 'frases', label: 'Frases', to: '/canais?secao=frases', perm: PERM.editarCanais, keywords: 'frases frase mensagem mensagens texto sms playbook de frases modelo', area: 'cobranca' },
];

/** Sem acento e em minúsculas (quem digita "renitencia" acha "renitência"). */
function semAcento(t: string): string {
	return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Filtra os atalhos pela permissão do usuário, pelas áreas contratadas e pelo texto digitado. */
export function filtrarAtalhos(atalhos: Atalho[], q: string, permissoes: string[], areas?: Pick<AreasLiberadas, 'cobranca' | 'jornada' | 'mensageria'>): Atalho[] {
	const query = semAcento(q.trim());
	return atalhos.filter(a => {
		if (a.perm && !permissoes.includes(a.perm)) return false;
		if (a.area && areas && !areas[a.area]) return false;
		if (!query) return true;
		return semAcento(a.label + ' ' + a.keywords).includes(query);
	});
}

/** Palette de comandos aberta por ⌘K / Ctrl+K em qualquer tela do Workspace. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
	const navigate = useNavigate();
	const { permissoes } = useMotorAuth();
	const areasLib = useAreasLiberadas();
	const [q, setQ] = useState('');
	const [sel, setSel] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const lista = useMemo(() => filtrarAtalhos(ATALHOS, q, permissoes, areasLib), [q, permissoes, areasLib.cobranca, areasLib.jornada, areasLib.mensageria]);

	useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
	useEffect(() => { setSel(0); }, [q]);

	if (!open) return null;

	function go(a: Atalho) { onClose(); navigate(a.to); }
	function onKey(e: React.KeyboardEvent) {
		if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, lista.length - 1)); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
		else if (e.key === 'Enter') { e.preventDefault(); if (lista[sel]) go(lista[sel]); }
		else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
	}

	return (
		<div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={onClose}>
			<div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 0 0 1px var(--base-separator), 0 24px 60px -20px rgba(0,0,0,.4)' }}>
				<div className="flex items-center gap-3 border-b border-[#E5E5EA] px-4">
					<Search size={18} className="text-[#8E8E93]" />
					<input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="O que você quer fazer?" className="h-12 flex-1 bg-transparent text-[15px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93]" />
					<kbd className="rounded bg-[#F2F2F7] px-1.5 py-0.5 text-[11px] text-[#8E8E93]">ESC</kbd>
				</div>
				<div className="max-h-[320px] overflow-y-auto p-2">
					{lista.length === 0 ? (
						<p className="px-3 py-6 text-center text-[14px] text-[#8E8E93]">Tente “chamado”, “faturas” ou “membros”.</p>
					) : lista.map((a, i) => (
						<button key={a.id} onMouseEnter={() => setSel(i)} onClick={() => go(a)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] ${i === sel ? 'bg-[#F5F5F7] text-[#1D1D1F]' : 'text-[#1D1D1F]'}`}>
							<span>{a.label}</span>
							{i === sel && <CornerDownLeft size={14} className="text-[#8E8E93]" />}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
