// Um único mapa de ícones por área, usado em toda a plataforma:
// lateral, atalhos do Início, cartões de área, gaveta do celular,
// abas de Relatórios e páginas "não faz parte do plano".
import {
	House, CircleDollarSign, Route, MessagesSquare, FileChartColumn,
	Building, Headset, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import type { AreaRota } from './area-rota';

export const AREA_ICON: Record<AreaRota, LucideIcon> = {
	cobranca: CircleDollarSign,
	jornada: Route,
	mensageria: MessagesSquare,
	relatorios: FileChartColumn,
	empresa: Building,
	suporte: Headset,
	console: ShieldCheck,
	inicio: House,
	workspace: House,
	nenhuma: House,
};
