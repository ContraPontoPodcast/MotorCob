// Agente Voz/CX › Telefonia, só leitura nesta etapa (SPEC Canais §3.4). A tela editável (troncos, senha no cofre, rotas,
// transferência, números de teste e teste da rota) vem no PR T5, depois do cofre, do firewall e da permissão
// configurar_telefonia. Aqui: quem configura hoje, os dados que a operadora pede e o caminho para pedir mudança.
import { PageHeading } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, BotaoLink, Cartao, ListaValores } from '@/components/ds';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { IPS_SAIDA_MOTORCX } from '@/lib/voz';

export function TelefoniaLeitura() {
	const { perfil } = useMotorAuth();
	const { agenteVoz } = useAreasLiberadas();
	const equipe = !!perfil?.equipe;
	return (
		<>
			<PageHeading title="Telefonia" description="Por onde o MotorCX liga: a rota da operadora (tronco SIP), a bina e a transferência para os seus operadores." semControles
				actions={equipe ? <BotaoLink to="/console/fornecedores?aba=voz">Abrir no Console</BotaoLink> : undefined} />
			{!agenteVoz ? (
				<Aviso tom="info" titulo="O agente de voz MotorCX não está contratado.">O discador e o AGV da sua empresa usam a telefonia de vocês, fora do MotorCX.</Aviso>
			) : (
				<div className="space-y-4">
					<Aviso tom="info" titulo="Só leitura por enquanto.">
						Hoje quem cadastra troncos, rotas e a transferência é a equipe MotorCX. Em breve o Admin da sua empresa vai configurar a rota direta aqui, com verificação em duas etapas.
					</Aviso>
					<div className="grid gap-3 lg:grid-cols-2">
						<Cartao titulo="Ficha técnica para a operadora" linha="O que a operadora costuma pedir para liberar o MotorCX no tronco.">
							<ListaValores itens={[
								['IPs de saída do MotorCX', IPS_SAIDA_MOTORCX.join(' · ')],
								['Autenticação', 'por IP (recomendado) ou senha em cada ligação'],
								['Ligações de entrada', 'o MotorCX não recebe ligações pelo tronco'],
							]} />
						</Cartao>
						<Cartao titulo="Mudar a telefonia" linha="Tronco novo, troca de bina, rota por tipo de número ou a fila do discador que recebe a transferência.">
							<BotaoLink pequeno to="/suporte/novo?assunto=Telefonia%20do%20agente%20de%20voz">Pedir à equipe MotorCX</BotaoLink>
						</Cartao>
					</div>
				</div>
			)}
		</>
	);
}
