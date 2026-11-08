// Cobrança › Estratégia › Frases (/canais?secao=frases): as frases e os modelos de mensagem de cada canal.
// Antes era a tela antiga de Canais (6 cartões com todos os campos) com a aba Modelos aberta; a configuração de cada
// canal agora fica na tela do canal (/canais/:canal), e esta página mostra só os textos. `?canal=` escolhe o canal
// (a seção Mensagens de cada canal leva para cá). O Importar playbook fica só no topo da visão geral de Canais.
import { useSearchParams } from 'react-router';
import { PageHeading } from '@/components/app-shell';
import { Aviso, LinkTexto, Segmentos } from '@/components/ds';
import { FrasesTab } from '@/components/canais/frases';
import { CANAIS_COM_MENSAGEM } from '@/lib/frases';
import { identidade } from '@/lib/estado-canais';

type CanalFrase = (typeof CANAIS_COM_MENSAGEM)[number];
const ehCanalFrase = (c: string | null): c is CanalFrase => !!c && (CANAIS_COM_MENSAGEM as readonly string[]).includes(c);

export function FrasesPagina() {
	const [params, setParams] = useSearchParams();
	const pedido = params.get('canal');
	const canal: CanalFrase = ehCanalFrase(pedido) ? pedido : 'whatsapp';
	function trocar(c: CanalFrase) {
		const p = new URLSearchParams(params);
		p.set('secao', 'frases');
		p.set('canal', c);
		setParams(p, { replace: true });
	}
	return (
		<>
			<PageHeading title="Frases" description="Os textos e modelos que cada canal usa. Horário, limites, custo e quem envia ficam na tela de cada canal." />
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<Segmentos rotulo="Canal" valor={canal} onTrocar={trocar}
					itens={CANAIS_COM_MENSAGEM.map(c => ({ v: c, n: identidade(c).nome }))} />
				<span className="flex flex-wrap gap-3">
					<LinkTexto to={`/canais/${canal}`}>Configurar o {identidade(canal).nome}</LinkTexto>
					<LinkTexto to="/canais">Importar playbook (em Canais)</LinkTexto>
				</span>
			</div>
			{canal === 'agente_voz' && <div className="mb-4"><Aviso tom="info">A conversa do agente de voz vem do fluxo de cada carteira: <LinkTexto to="/voz/agente">Agente Voz/CX › Agente de voz</LinkTexto>.</Aviso></div>}
			<section className="min-w-0 rounded-2xl bg-[var(--base-cartao)] p-4 sm:p-5" style={{ boxShadow: '0 0 0 1px var(--base-borda), 0 2px 12px rgba(0,0,0,.04)' }}>
				<FrasesTab key={canal} canal={canal} />
			</section>
			<p className="mt-4 text-[12.5px] text-[var(--base-texto-3)]">E-mail e discador não usam frase aqui: o texto do e-mail é o modelo da Mensageria, e o discador não manda mensagem.</p>
		</>
	);
}
