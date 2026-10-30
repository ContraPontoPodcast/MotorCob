import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, Check, FileText, MessageCircle, FileUp, Pause, KeyRound, ClipboardList, AlertTriangle } from 'lucide-react';
import { useMotorAuth } from '@/components/auth-provider';
import { useFrente } from '@/components/frente-provider';
import { supabase, type Row } from '@/lib/supabase';
import { CommandPalette } from '@/components/workspace/workspace-command-palette';
import { PrimeirosPassos } from '@/components/home/primeiros-passos';
import { MensageriaModal } from '@/components/workspace/mensageria-modal';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { AREA_ICON } from '@/lib/area-icones';
import type { AreaRota } from '@/lib/area-rota';
import type { CanalId } from '@/lib/mensageria-produtos';

type ParaHojeItem = { tipo: string; urgencia: number; titulo: string; detalhe: string | null; acao: string; link: string };
type AreaInfo = { area: string; contratada: boolean; numero: string | null; detalhe: string; link: string };

const TIPO_ICON: Record<string, typeof FileText> = {
	fatura: FileText, chamado: MessageCircle, carga: FileUp, pausa: Pause,
	respostas: MessageCircle, token: KeyRound, lista: ClipboardList, sem_estagio: AlertTriangle,
};

/** Ordem fixa dos canais por extenso: SMS · RCS · WhatsApp · E-mail. */
const ORDEM_CANAIS: CanalId[] = ['sms', 'rcs', 'whatsapp', 'email'];
const CANAL_NOME: Record<CanalId, string> = { sms: 'SMS', rcs: 'RCS', whatsapp: 'WhatsApp', email: 'E-mail' };

function canaisPorExtenso(canais: CanalId[]): string {
	const ordenados = ORDEM_CANAIS.filter(c => canais.includes(c));
	const nomes = ordenados.map(c => CANAL_NOME[c]);
	if (nomes.length === 0) return '';
	if (nomes.length === 1) return nomes[0];
	return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}

type Atalho = { area: AreaRota; nome: string; desc: string; to: string; contratada: boolean; equipe?: boolean };

/** Grade de atalhos no Início (um bloco só, ícones do mapa único). */
function AtalhosInicio({ areas }: { areas: AreaInfo[] | null }) {
	const { perfil } = useMotorAuth();
	const { aplicarFrente } = useFrente();
	const navigate = useNavigate();
	const areasLib = useAreasLiberadas();
	const [interesse, setInteresse] = useState(false);
	const isEquipe = !!perfil?.equipe;

	const atalhos: Atalho[] = [
		{ area: 'cobranca', nome: 'Cobrança', desc: 'Lista do dia, réguas e carteiras', to: '/fila', contratada: areasLib.cobranca },
		{ area: 'jornada', nome: 'Jornada do Cliente', desc: 'Boas-vindas, ativação e retenção', to: '/jornada', contratada: areasLib.jornada },
		{ area: 'mensageria', nome: 'Mensageria', desc: 'Campanhas, lotes e respostas', to: `/mensageria/${areasLib.canalPadrao}`, contratada: areasLib.mensageria },
		{ area: 'relatorios', nome: 'Relatórios', desc: 'Os números de todas as áreas', to: '/relatorios', contratada: true },
		{ area: 'empresa', nome: 'Empresa', desc: 'Pessoas, faturas e integrações', to: '/empresa', contratada: true },
		{ area: 'suporte', nome: 'Suporte', desc: 'Seus chamados', to: '/suporte', contratada: true },
	];
	if (isEquipe) atalhos.push({ area: 'console', nome: 'Console MotorCX', desc: 'Clientes, financeiro e equipe', to: '/console', contratada: true, equipe: true });

	function areaInfo(a: Atalho): AreaInfo | undefined {
		return (areas ?? []).find(x => x.area === a.area);
	}

	/** Texto de número/detalhe para o cartão da área (Cobrança, Jornada, Mensageria). */
	function numeroDetalhe(a: Atalho): string | null {
		if (a.area === 'mensageria') {
			const info = areaInfo(a);
			const canaisTxt = canaisPorExtenso(areasLib.canais);
			const temCanaisNoDetalhe = info?.detalhe && /SMS|RCS|WhatsApp|E-mail/i.test(info.detalhe);
			const base = info?.numero ? `${info.numero} ${info.detalhe}` : (info?.detalhe || a.desc);
			if (canaisTxt && !temCanaisNoDetalhe) return `${base} · ${canaisTxt}`;
			return base;
		}
		const info = areaInfo(a);
		if (info?.numero) return `${info.numero} ${info.detalhe}`;
		return info?.detalhe || a.desc;
	}

	function ir(a: Atalho) {
		if (!a.contratada) { setInteresse(true); return; }
		if (a.area === 'cobranca') aplicarFrente('motorcob');
		if (a.area === 'jornada') aplicarFrente('motorcli');
		navigate(a.to);
	}

	return (
		<div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{atalhos.map(a => {
					const Icon = AREA_ICON[a.area];
					const numero = a.contratada ? numeroDetalhe(a) : null;
					return (
						<button
							key={a.area}
							onClick={() => ir(a)}
							className={`flex min-h-[110px] flex-col items-start gap-2 rounded-[14px] border border-[#E5E5EA] bg-white p-4 text-left transition hover:bg-[#F5F5F7] ${!a.contratada ? 'opacity-50' : ''}`}
						>
							<Icon size={22} strokeWidth={1.8} className="text-[#6E6E73]" />
							<div className="min-w-0">
								<p className="text-[14px] font-bold text-[#1D1D1F]">{a.nome}</p>
								<p className="mt-0.5 text-[12px] text-[#8E8E93]">{a.contratada ? (numero ?? a.desc) : 'Não contratada · Quero conhecer'}</p>
							</div>
						</button>
					);
				})}
			</div>
			{interesse && <MensageriaModal open={interesse} onClose={() => setInteresse(false)} />}
		</div>
	);
}

function saudacao(): string {
	const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()));
	return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export function InicioHome() {
	const { perfil, empresa } = useMotorAuth();
	const { info: frenteInfo } = useFrente();
	const navigate = useNavigate();
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [paraHoje, setParaHoje] = useState<ParaHojeItem[] | null>(null);
	const [areas, setAreas] = useState<AreaInfo[] | null>(null);

	// ⌘K e focus-busca abrem a palette.
	useEffect(() => {
		function onFocus() { setPaletteOpen(true); }
		window.addEventListener('motorcob:focus-busca', onFocus);
		return () => window.removeEventListener('motorcob:focus-busca', onFocus);
	}, []);

	// Para hoje (rpc para_hoje).
	useEffect(() => {
		if (!supabase) return;
		let active = true;
		(async () => {
			try {
				const { data, error } = await supabase.rpc('para_hoje', { empresa: empresa?.id ?? null, limite: 5 });
				if (!active || error) { if (active) setParaHoje([]); return; }
				setParaHoje((data ?? []) as ParaHojeItem[]);
			} catch { if (active) setParaHoje([]); }
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	// Áreas (rpc numeros_areas) — números que entram nos cartões de atalho.
	useEffect(() => {
		if (!supabase) return;
		let active = true;
		(async () => {
			try {
				const { data, error } = await supabase.rpc('numeros_areas', { empresa: empresa?.id ?? null });
				if (!active || error) throw new Error('rpc');
				setAreas((data ?? []) as AreaInfo[]);
			} catch {
				if (!active) return;
				// Fallback: sem rpc, os cartões usam só a descrição curta.
				setAreas([]);
			}
		})();
		return () => { active = false; };
	}, [empresa?.id]);

	const primeiroNome = perfil?.nome?.split(' ')[0] ?? '';

	return (
		<div className="mx-auto max-w-[1200px] px-4 py-8 sm:py-10">
			{/* Saudação + busca */}
			<div className="text-center">
				<h1 className="text-[32px] font-bold tracking-tight text-[#1D1D1F] sm:text-[34px]">{saudacao()}, {primeiroNome}.</h1>
				<div className="mt-2 flex justify-center">
					<span className="inline-flex items-center gap-1.5 rounded-full bg-[#F5F5F7] px-3 py-1 text-[13px] font-medium text-[#1D1D1F]">
						<span className="h-2 w-2 rounded-full" style={{ backgroundColor: frenteInfo.cor }} />
						{frenteInfo.nome}
					</span>
				</div>
				<button
					onClick={() => setPaletteOpen(true)}
					className="mx-auto mt-6 flex h-14 w-full max-w-[560px] items-center gap-3 rounded-2xl border border-[#E5E5EA] bg-white px-5 text-left transition hover:bg-[#F5F5F7]"
					style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}
				>
					<Search size={20} className="shrink-0 text-[#8E8E93]" />
					<span className="flex-1 text-[16px] text-[#8E8E93]">O que você quer fazer?</span>
					<kbd className="hidden rounded bg-[#F5F5F7] px-1.5 py-0.5 text-[11px] font-medium text-[#8E8E93] sm:block">⌘K</kbd>
				</button>
			</div>

			{/* Primeiros passos */}
			<div className="mt-8">
				<PrimeirosPassos />
			</div>

			{/* Para hoje — largura total */}
			<div className="mt-8">
				<h2 className="mb-3 text-[17px] font-semibold text-[#1D1D1F]">Para hoje</h2>
				{paraHoje === null ? (
					<p className="py-2 text-center text-[14px] text-[#8E8E93]">Carregando...</p>
				) : paraHoje.length === 0 ? (
					<div className="flex items-center gap-3 py-1">
						<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#E8F8EC]"><Check size={16} className="text-[#34C759]" /></span>
						<span className="text-[15px] text-[#1D1D1F]">Tudo em dia por aqui.</span>
					</div>
				) : (
					<div className="space-y-2">
						{paraHoje.map((item, i) => {
							const Icon = TIPO_ICON[item.tipo] ?? ClipboardList;
							const isSemEstagio = item.tipo === 'sem_estagio';
							const borda = item.urgencia < 20 ? '#FF3B30' : item.urgencia < 40 ? '#FF9500' : 'transparent';
							return (
								<div key={i} className="flex items-center gap-3 rounded-lg bg-white py-2 pl-3 pr-2" style={{ borderLeft: `3px solid ${borda}`, boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
									<span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isSemEstagio ? 'bg-[#FFF7E8]' : 'bg-[#F5F5F7]'}`}><Icon size={16} className={isSemEstagio ? 'text-[#FF9500]' : 'text-[#6E6E73]'} /></span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[14px] font-medium text-[#1D1D1F]">{item.titulo}</p>
										{item.detalhe && <p className="truncate text-[13px] text-[#8E8E93]">{item.detalhe}</p>}
									</div>
									{item.acao && item.link && (
										<button onClick={() => navigate(item.link)} className="shrink-0 rounded-lg border border-[#D2D2D7] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">{item.acao}</button>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Atalhos */}
			<div className="mt-8">
				<h2 className="mb-3 text-[17px] font-semibold text-[#1D1D1F]">Atalhos</h2>
				<AtalhosInicio areas={areas} />
			</div>

			<CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
		</div>
	);
}
