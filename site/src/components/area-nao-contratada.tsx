import { Link } from 'react-router';
import type { AreaRota } from '@/lib/area-rota';
import { AREA_DESTINO } from '@/lib/area-rota';
import { AREA_ICON } from '@/lib/area-icones';

const AREA_NOME: Record<AreaRota, string> = {
	cobranca: 'Cobrança',
	jornada: 'Jornada do Cliente',
	mensageria: 'Mensageria',
	relatorios: 'Relatórios',
	console: 'Console',
	empresa: 'Empresa',
	suporte: 'Suporte',
	inicio: 'Início',
	workspace: 'MotorCX',
	nenhuma: 'MotorCX',
};

/**
 * Página "área não contratada" — dentro da moldura, sem menu lateral.
 * Cliente ou equipe COM empresa na pílula chegam aqui quando acessam uma área
 * fora do plano da empresa. Equipe sem pílula nunca vê esta página.
 */
export function AreaNaoContratada({ area, empresaNome, equipeComPill }: { area: AreaRota; empresaNome?: string; equipeComPill?: boolean }) {
	const nome = AREA_NOME[area] ?? area;
	const destino = AREA_DESTINO[area];
	const Icon = AREA_ICON[area] ?? AREA_ICON.nenhuma;
	return (
		<div className="mx-auto max-w-[560px] px-4 py-16 text-center">
			<div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-[#F5F5F7]">
			<Icon size={26} className="text-[#8E8E93]" />
			</div>
			<h1 className="text-[22px] font-semibold text-[#1D1D1F]">{nome} não faz parte do plano{empresaNome ? ` da ${empresaNome}` : ' da sua empresa'}.</h1>
			<p className="mt-2 text-[14px] text-[#6E6E73]">Fale com o time comercial para conhecer e contratar.</p>
			<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
				<Link to={`/suporte/novo?assunto=Quero conhecer ${encodeURIComponent(nome)}`} className="inline-flex h-10 items-center rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Quero conhecer</Link>
				{equipeComPill ? (
					<Link to={destino} className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Abrir mesmo assim (equipe)</Link>
				) : (
					<Link to="/inicio" className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Ir para o Início</Link>
				)}
			</div>
		</div>
	);
}
