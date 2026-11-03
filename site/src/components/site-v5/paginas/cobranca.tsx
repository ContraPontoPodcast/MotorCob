/* Cobrança · MotorCob (/solucoes/cobranca). Portada do protótipo aprovado; o texto é o aprovado, não reescreva. */
import type { CSSProperties } from 'react';
import { i } from '../estilo';

export function PaginaCobranca() {
	return (
		<>
			<section className="cena preto escuro abre" aria-labelledby="h1">
				<div className="texto centro">
					<p className="olho rv">Cobrança · MotorCob</p>
					<h1 className="display rv" style={i(1)} id="h1">A Lista do dia.</h1>
					<p className="lead rv" style={i(2)}>Quem acionar hoje, em qual contato e por qual canal, decidido pela MotorCX Intelligence. <b>Pronta para a ferramenta que você já usa.</b></p>
					<div className="acoes rv" style={i(3)}><a className="btn" href="/demonstracao?de=cobranca">Agendar demonstração</a></div>
				</div>
			</section>
			<section className="cena branco" id="lista-do-dia" aria-labelledby="h-motivo">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-motivo">Cada decisão tem um motivo.</h2>
					<p className="lead rv" style={i(1)}>Quem entra, entra com o contato certo. <b>Quem fica de fora, fica com o motivo.</b></p>
				</div>
				<ul className="ramos rv" style={i(2)} aria-label="Ilustração: quem entra na Lista do dia e por que os outros ficam de fora">
					<li className="dentro">Na Lista do dia<small>Um contato por cliente, por canal. O contato principal primeiro.</small></li>
					<li className="rotulo">Fica de fora hoje, com o motivo</li>
					<li>Sem passo hoje na régua</li>
					<li>Sem contato válido</li>
					<li>Sem estágio</li>
					<li>Outra carteira acionou há menos de 48&nbsp;h</li>
					<li>Fora do orçamento do canal</li>
				</ul>
				<p className="ilus-nota">Ilustração. Os motivos são os do produto; a carteira é sua.</p>
			</section>
			<section className="cena nevoa" id="contato" aria-labelledby="h-fone">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-fone">O telefone certo primeiro.</h2>
					<p className="lead rv" style={i(1)}>O número que deu contato com a pessoa certa vira o contato principal, em todos os canais. <b>O que falha sai da fila.</b></p>
				</div>
				<ul className="fones rv" style={i(2)} aria-label="Exemplo com dados fictícios">
					<li className="hot">(11) 9••••-••17<small>Contato principal</small></li>
					<li>(11) 9••••-••42<small>Ainda não tentado · rodízio</small></li>
					<li className="off">(11) 3•••-••08<small>Não é a pessoa · nunca recebe</small></li>
					<li className="off">(21) 9••••-••90<small>Não entregue · suspenso por 7 dias</small></li>
				</ul>
				<p className="nota centro">Dados fictícios. Número que falha é suspenso em escada: 7, 15, 30, 90 e 120 dias.</p>
			</section>
			<section className="cena preto escuro" id="discador" aria-labelledby="h-disc">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-disc">O Discador continua.</h2>
					<p className="lead rv" style={i(1)}>O MotorCX diz quem, qual número, quantas vezes e em que janela. <b>Quem disca é o Discador.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Entra</b><span>A carga, por arquivo ou API. O layout é lido sozinho e você confere.</span></li>
					<li className="rv" style={i(1)}><b>Sai</b><span>Um arquivo por canal, o mailing do Discador e a lista do bureau.</span></li>
					<li className="rv ouro" style={i(2)}><b>Volta</b><span>A ocorrência e o retorno dos fornecedores. A próxima lista já sai diferente.</span></li>
				</ol>
			</section>
			<section className="cena branco" id="canais" aria-labelledby="h-canais">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-canais">Do envio à resposta.</h2>
					<p className="lead rv" style={i(1)}>Use os seus fornecedores ou a Mensageria do MotorCX. <b>O motor recebe o retorno de todos.</b></p>
				</div>
				<ol className="linhas">
					<li className="rv"><b>WhatsApp</b><span>Sai na Lista do dia, só para contato certificado ou um número por cliente com WhatsApp válido. Quem envia é o seu provedor, com template aprovado.</span><em>Pela sua ferramenta</em></li>
					<li className="rv"><b>SMS, RCS e e-mail</b><span>Pelo seu fornecedor ou pela Mensageria, que nasce em simulação. O Radar classifica as respostas.</span><em className="motor">Sua ferramenta ou MotorCX</em></li>
					<li className="rv"><b>Voz</b><span>Pelo Discador, ou pelo agente de voz do MotorCX na sua telefonia.</span><em className="motor">Sua ferramenta ou MotorCX</em></li>
				</ol>
				<p className="nota centro">WhatsApp pela Mensageria do MotorCX: em breve.</p>
			</section>
			<section className="cena nevoa" id="comite" aria-labelledby="h-comite">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-comite">O comitê sai pronto.</h2>
					<p className="lead rv" style={i(1)}>Todo mês, o realizado contra o previsto por canal, régua e segmento. <b>Cada acordo atribuído ao canal que o originou.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Real × Previsto</b><span>Por régua, canal e safra, com as premissas do credor.</span></li>
					<li className="rv" style={i(1)}><b>Custo por canal</b><span>Só o custo variável das tentativas, sem mistura.</span></li>
					<li className="rv" style={i(2)}><b>Acordo é promessa</b><span>Pagamento é quitação ou 1ª parcela paga. O relatório separa os dois.</span></li>
				</ol>
			</section>
			<section className="preto escuro fim" aria-labelledby="h-fim">
				<h2 className="display rv" id="h-fim">A manhã de volta.</h2>
				<p className="lead rv" style={i(1)}>Sem PROCV. Sem mailing montado à mão.</p>
				<div className="acoes rv" style={i(2)}><a className="btn" href="/demonstracao?de=cobranca">Agendar demonstração</a><a className="link" href="/como-decide">Ver como o motor decide</a></div>
			</section>
		</>
	);
}
