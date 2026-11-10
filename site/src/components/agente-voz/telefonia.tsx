// Agente Voz/CX › Telefonia (SPEC Canais §3.4). PR T3: o cliente já LÊ a telefonia da empresa (voz_troncos_empresa, sem
// a referência do segredo: só "senha guardada sim/não", os IPs e o que falta a equipe liberar no firewall) e a permissão
// configurar_telefonia existe (padrão só Admin, com a verificação em duas etapas). A tela editável (assistente do tronco,
// senha no cofre, rotas, transferência, números de teste e teste da rota) vem no PR T5.
import { useEffect, useState } from 'react';
import { PageHeading, usePermissao } from '@/components/app-shell';
import { useMotorAuth } from '@/components/auth-provider';
import { Aviso, BotaoLink, Cartao, ListaValores, Pilula } from '@/components/ds';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { IPS_SAIDA_MOTORCX, PERM_VOZ, binaMascara } from '@/lib/voz';
import { supabase, dateTimeBR, type Row } from '@/lib/supabase';

/** Situação de um tronco para quem não é da equipe (sem segredo, sem detalhe técnico do cofre). */
export function situacaoTroncoCliente(t: Row): { tom: 'ok' | 'erro' | 'neutro' | 'atencao'; txt: string } {
	if (t.ativo === false) return { tom: 'neutro', txt: 'Inativo · a equipe MotorCX ativa depois do teste' };
	if (t.autenticacao === 'senha' && !t.segredo_no_cofre) return { tom: 'atencao', txt: 'Falta guardar a senha' };
	if (Array.isArray(t.ips_pendentes) && t.ips_pendentes.length > 0) return { tom: 'atencao', txt: 'IPs esperando a equipe MotorCX' };
	if (t.teste_ok === true) return { tom: 'ok', txt: 'Testado' };
	if (t.teste_ok === false) return { tom: 'erro', txt: 'O teste falhou' };
	return { tom: 'atencao', txt: 'Esperando o teste' };
}

export function TelefoniaLeitura() {
	const { perfil, empresa } = useMotorAuth();
	const { agenteVoz } = useAreasLiberadas();
	const podeConfigurar = usePermissao(PERM_VOZ.configurarTelefonia);
	const equipe = !!perfil?.equipe;
	const [troncos, setTroncos] = useState<Row[] | null>(null);

	useEffect(() => {
		if (!supabase || !empresa || !agenteVoz) return;
		let vivo = true;
		void supabase.from('voz_troncos_empresa')
			.select('id,referencia,operadora,autenticacao,bina,canais,ativo,teste_ok,testado_em,segredo_no_cofre,segredo_guardado_em,ips_operadora,ips_pendentes')
			.eq('empresa_id', empresa.id).order('referencia')
			.then(({ data }) => { if (vivo) setTroncos((data ?? []) as Row[]); });
		return () => { vivo = false; };
	}, [empresa, agenteVoz]);

	return (
		<>
			<PageHeading title="Telefonia" description="Por onde o MotorCX liga: a rota da operadora (tronco SIP), a bina e a transferência para os seus operadores." semControles
				actions={equipe ? <BotaoLink to="/console/fornecedores?aba=voz">Configurar no Console (equipe MotorCX)</BotaoLink> : undefined} />
			{!agenteVoz ? (
				<Aviso tom="info" titulo="O agente de voz MotorCX não está contratado.">O discador e o AGV da sua empresa usam a telefonia de vocês, fora do MotorCX.</Aviso>
			) : (
				<div className="space-y-4">
					<Aviso tom="info" titulo="A tela para configurar vem em breve.">
						{podeConfigurar
							? 'Você tem a permissão "Configurar a telefonia". Ela pede a verificação em duas etapas (Conta › Segurança). Enquanto a tela não chega, peça a mudança à equipe MotorCX.'
							: 'Quem configura a operadora da empresa é o Admin, com a verificação em duas etapas. Enquanto a tela não chega, a equipe MotorCX cadastra para vocês.'}
					</Aviso>
					<Cartao titulo="Troncos da empresa" linha="A senha vai direto para o cofre de segredos e não volta a aparecer. Só o servidor de voz do MotorCX lê a senha, na hora de ligar.">
						{troncos === null ? <p className="text-[13px] text-[var(--base-texto-3)]">Carregando...</p>
							: troncos.length === 0 ? <p className="text-[13px] text-[var(--base-texto-3)]">Nenhum tronco cadastrado ainda.</p>
								: <ul className="divide-y divide-[var(--base-borda)]">
									{troncos.map(t => {
										const s = situacaoTroncoCliente(t);
										const ips = Array.isArray(t.ips_operadora) ? (t.ips_operadora as string[]) : [];
										const pend = Array.isArray(t.ips_pendentes) ? (t.ips_pendentes as string[]) : [];
										return (
											<li key={String(t.id)} className="py-3">
												<div className="flex flex-wrap items-center justify-between gap-2">
													<span className="font-mono text-[13px]">{String(t.referencia)} · {String(t.operadora)}</span>
													<Pilula tom={s.tom}>{s.txt}</Pilula>
												</div>
												<ListaValores itens={[
													['Como a operadora reconhece o MotorCX', t.autenticacao === 'senha'
														? (t.segredo_no_cofre ? `Usuário e senha · senha guardada em ${dateTimeBR(String(t.segredo_guardado_em))}` : 'Usuário e senha · senha ainda não guardada')
														: 'Por IP'],
													['Bina', <span key="b" className="tnum">{binaMascara(t.bina)}</span>],
													['IPs da operadora', ips.length === 0 ? 'Nenhum informado' : `${ips.join(' · ')}${pend.length ? ` (esperando a liberação: ${pend.join(', ')})` : ''}`],
													['Último teste', t.testado_em ? `${dateTimeBR(String(t.testado_em))} · ${t.teste_ok ? 'passou' : 'não passou'}` : 'Ainda não testado'],
												]} />
											</li>
										);
									})}
								</ul>}
					</Cartao>
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
