import { Link } from 'react-router';
import type { AreaRota } from '@/lib/area-rota';
import { AREA_DESTINO } from '@/lib/area-rota';
import { AREA_ICON } from '@/lib/area-icones';
import { useMotorAuth } from '@/components/auth-provider';
import { BlocoPedido, BotaoPedido, usePedidoAdmin } from '@/components/comuns/pedido-admin';

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
 * Quem não é Admin tem "Avisar o Admin" como botão principal (é o Admin quem contrata; Onda 3, SQL 55);
 * "Quero conhecer" continua como segundo botão. Para o Admin e para a equipe, nada muda.
 */
export function AreaNaoContratada({ area, empresaNome, equipeComPill }: { area: AreaRota; empresaNome?: string; equipeComPill?: boolean }) {
	const { perfil } = useMotorAuth();
	const nome = AREA_NOME[area] ?? area;
	const destino = AREA_DESTINO[area];
	const Icon = AREA_ICON[area] ?? AREA_ICON.nenhuma;
	const alvo = area === 'cobranca' || area === 'jornada' || area === 'mensageria' ? area : undefined;
	const podeAvisar = !!perfil && !perfil.equipe && perfil.papel !== 'admin' && !!alvo;
	const pedido = usePedidoAdmin('area', podeAvisar ? alvo : undefined);
	const avisar = podeAvisar && pedido.disponivel;
	const conhecer = <Link to={`/suporte/novo?assunto=Quero conhecer ${encodeURIComponent(nome)}`} className={avisar ? 'inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]' : 'inline-flex h-10 items-center rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85'}>Quero conhecer</Link>;
	return (
		<div className="mx-auto max-w-[580px] px-2 py-16 text-center sm:px-4">
			<div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-[#F5F5F7]">
			<Icon size={26} className="text-[#8E8E93]" />
			</div>
			<h1 className="text-[22px] font-semibold text-[#1D1D1F]">{nome} não faz parte do plano{empresaNome ? ` da ${empresaNome}` : ' da sua empresa'}.</h1>
			<p className="mt-2 text-[14px] text-[#6E6E73]">{podeAvisar && pedido.estado !== 'indisponivel'
				? 'Quem decide contratar é o Admin da sua empresa. Avise o Admin que você tem interesse, ou converse com o nosso time comercial para conhecer.'
				: 'Fale com o time comercial para conhecer e contratar.'}</p>
			<div className="mt-6 flex flex-wrap items-center justify-center gap-3">
				{avisar ? <><BotaoPedido p={pedido} rotulo="Avisar o Admin" />{conhecer}</> : conhecer}
				{!avisar && (equipeComPill ? (
					<Link to={destino} className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Abrir mesmo assim (equipe)</Link>
				) : (
					<Link to="/inicio" className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Ir para o Início</Link>
				))}
			</div>
			{avisar && <BlocoPedido p={pedido} oque={`a área que você quer (${nome})`} />}
		</div>
	);
}
