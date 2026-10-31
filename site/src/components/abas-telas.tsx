import { Link, useLocation } from 'react-router';
import { ABAS, abaAtiva, rotaCanal, type Aba, type GrupoAbas } from '@/lib/abas';
import { useMotorAuth } from '@/components/auth-provider';
import { useConsolePerms } from '@/components/workspace/console/console-perms';
import type { AreaRota } from '@/lib/area-rota';
import { useAreasLiberadas, type AreasLiberadas } from '@/hooks/use-areas-liberadas';

type Props = {
	area: AreaRota;
	canal?: string;
	/** Contadores dinâmicos do Console. */
	badges?: { atendimento?: number; implantacao?: number };
};

type Item =
	| { kind: 'aba'; aba: Aba }
	| { kind: 'grupo'; rotulo: string; abas: Aba[] };

function visibleAbas(g: GrupoAbas, area: AreaRota, canal: string, permissoes: string[], can: (c: string) => boolean, areas: AreasLiberadas, ehEquipe: boolean): Aba[] {
	return g.abas.filter(a => {
		if (a.excetoCanal && canal && a.excetoCanal.includes(canal)) return false;
		if (a.requerArea && !areas[a.requerArea]) return false;
		if (a.permConsole && (!ehEquipe || !a.permConsole.some(c => can(c)))) return false;
		if (a.perm) {
			if (area === 'console') { if (!can(a.perm)) return false; }
			else { if (!permissoes.includes(a.perm)) return false; }
		}
		return true;
	});
}

function TabItem({ aba, ativo, canal, badges }: { aba: Aba; ativo: boolean; canal: string; badges?: { atendimento?: number; implantacao?: number } }) {
	const Icon = aba.icon;
	const to = rotaCanal(aba.to, canal);
	let badgeN: number | undefined;
	if (aba.badge === 'atendimento') badgeN = badges?.atendimento;
	if (aba.badge === 'implantacao') badgeN = badges?.implantacao;

	return (
		<Link
			to={to}
			className={`relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors ${ativo ? 'text-[var(--base-texto)]' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}
		>
			<Icon size={16} strokeWidth={1.8} className="shrink-0" />
			<span className="whitespace-nowrap">{aba.nome}</span>
			{aba.externo && <span className="text-[10px]">↗</span>}
			{badgeN != null && badgeN > 0 && (
				<span className={`grid h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px] font-bold text-white tnum ${aba.badgeTone === 'red' ? 'bg-[#FF3B30]' : 'bg-[#0A60D0]'}`}>{badgeN > 99 ? '99+' : badgeN}</span>
			)}
			{ativo && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full" style={{ backgroundColor: 'var(--destaque)' }} />}
		</Link>
	);
}

/** Barra de abas de uma área. Grupos com rótulo viram uma aba; ao ativar, mostra subabas em pílula. */
export function AbasTelas({ area, canal = '', badges }: Props) {
	const areaAbas = ABAS[area];
	const { permissoes, perfil } = useMotorAuth();
	const { can } = useConsolePerms();
	const areasLib = useAreasLiberadas();
	const loc = useLocation();

	if (!areaAbas) return null;

	const items: Item[] = [];
	for (const g of areaAbas.grupos) {
		const vis = visibleAbas(g, area, canal, permissoes, can, areasLib, !!perfil?.equipe);
		if (vis.length === 0) continue;
		// Grupo com rótulo e 2+ abas visíveis → uma aba de grupo.
		// Grupo sem rótulo, ou com uma só aba visível → mostra a(s) aba(s) direto.
		if (g.rotulo && vis.length >= 2) {
			items.push({ kind: 'grupo', rotulo: g.rotulo, abas: vis });
		} else {
			for (const a of vis) items.push({ kind: 'aba', aba: a });
		}
	}

	if (items.length === 0) return null;

	let activeGrupo: { rotulo: string; abas: Aba[] } | null = null;
	for (const it of items) {
		if (it.kind === 'grupo' && it.abas.some(a => abaAtiva(a, loc.pathname, canal, loc.search))) {
			activeGrupo = it;
			break;
		}
	}

	return (
		<div className="border-b border-[var(--base-borda)]">
			<div className="no-scrollbar flex items-center gap-0 overflow-x-auto">
				{items.map((it, i) => {
					if (it.kind === 'aba') {
						return <TabItem key={it.aba.to} aba={it.aba} ativo={abaAtiva(it.aba, loc.pathname, canal, loc.search)} canal={canal} badges={badges} />;
					}
					const ativo = it.abas.some(a => abaAtiva(a, loc.pathname, canal, loc.search));
					const Icon = it.abas[0].icon;
					return (
						<Link
							key={`g${i}`}
							to={rotaCanal(it.abas[0].to, canal)}
							className={`relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors ${ativo ? 'text-[var(--base-texto)]' : 'text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}
						>
							<Icon size={16} strokeWidth={1.8} className="shrink-0" />
							<span className="whitespace-nowrap">{it.rotulo}</span>
							{ativo && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full" style={{ backgroundColor: 'var(--destaque)' }} />}
						</Link>
					);
				})}
			</div>
			{activeGrupo && (
				<div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-3 py-1.5">
					{activeGrupo.abas.map(a => {
						const ativo = abaAtiva(a, loc.pathname, canal, loc.search);
						const Icon = a.icon;
						return (
							<Link
								key={a.to}
								to={rotaCanal(a.to, canal)}
								className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${ativo ? '' : 'border-[var(--base-borda)] text-[var(--base-texto-2)] hover:text-[var(--base-texto)]'}`}
								style={ativo ? { backgroundColor: 'var(--destaque-suave)', borderColor: 'var(--destaque)', color: 'var(--base-texto)' } : undefined}
							>
								<Icon size={13} strokeWidth={1.8} className="shrink-0" />
								<span className="whitespace-nowrap">{a.nome}</span>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
