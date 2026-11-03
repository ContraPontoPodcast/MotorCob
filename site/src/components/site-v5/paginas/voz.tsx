/* Voz (/solucoes/voz). Portada do protótipo aprovado; o texto é o aprovado, não reescreva. */
import type { CSSProperties } from 'react';
import { i } from '../estilo';

export function PaginaVoz() {
	return (
		<>
			<section className="cena preto escuro abre" aria-labelledby="h1">
				<div className="texto centro">
					<p className="olho rv">Voz</p>
					<h1 className="display rv" style={i(1)} id="h1">Uma IA que liga. E só fala o que foi aprovado.</h1>
					<p className="lead rv" style={i(2)}>O agente de voz liga pela sua telefonia, confirma a identidade e negocia dentro da sua alçada. <b>Quando precisa, passa para uma pessoa.</b></p>
					<div className="acoes rv" style={i(3)}><a className="btn" href="/demonstracao?de=voz">Agendar demonstração</a></div>
				</div>
			</section>
			<section className="cena branco" id="fluxo" aria-labelledby="h-fluxo">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-fluxo">Um fluxo, não um improviso.</h2>
					<p className="lead rv" style={i(1)}>Etapas, ramos e ofertas dentro da alçada, com versões. <b>Enquanto houver pendência, o envio para aprovação fica travado.</b></p>
				</div>
				<ol className="trilha rv" style={{ '--i': 2, '--n': 5 } as CSSProperties} aria-label="Ilustração do caminho principal do fluxo">
					<li><b>Abre</b>Apresenta-se e diz por que liga.</li>
					<li><b>Confirma</b>A identidade, antes de qualquer valor.</li>
					<li><b>Entende</b>A intenção de quem atendeu.</li>
					<li><b>Negocia</b>Só as ofertas da sua alçada.</li>
					<li className="ouro"><b>Registra</b>Promessa, retorno ou recusa.</li>
				</ol>
				<p className="ramal rv" style={i(3)}>E os ramos para o que sai do roteiro: <b>“Já paguei.”</b> <b>“Agora não dá.”</b> <b>“Quero falar com uma pessoa.”</b></p>
				<p className="ilus-nota">Ilustração. O fluxo é o que a sua empresa aprova.</p>
			</section>
			<section className="cena nevoa" id="roleplay" aria-labelledby="h-role">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-role">Testado antes do primeiro cliente.</h2>
					<p className="lead rv" style={i(1)}>No roleplay, uma IA faz o papel do devedor difícil: diz que já pagou, cita o Procon, não entende. <b>Sem nenhum dado real.</b></p>
				</div>
				<ul className="falas" aria-label="Ilustração: falas de personas simuladas no roleplay">
					<li className="rv"><q>Eu já paguei.</q><span>Persona simulada</span></li>
					<li className="rv" style={i(1)}><q>Vou reclamar no Procon.</q><span>Persona simulada</span></li>
					<li className="rv" style={i(2)}><q>Não entendi nada.</q><span>Persona simulada</span></li>
				</ul>
				<p className="ilus-nota">A conversa que reprova vira caso de teste. A simulação compara versões, não promete resultado.</p>
			</section>
			<section className="cena preto escuro" aria-labelledby="h-modos">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-modos">Três passos até o real.</h2>
					<p className="lead rv" style={i(1)}>Ninguém liga para cliente por engano. <b>Quem libera o modo real é a equipe do MotorCX.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Simulado</b><span>O fluxo roda sem ligar para ninguém.</span></li>
					<li className="rv" style={i(1)}><b>Só números de teste</b><span>Liga apenas para os números que você cadastrou.</span></li>
					<li className="rv ouro" style={i(2)}><b>Real</b><span>Liga para a Lista do dia, pela sua telefonia.</span></li>
				</ol>
			</section>
			<section className="cena branco" id="discagem" aria-labelledby="h-disc">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-disc">O Discador continua.</h2>
					<p className="lead rv" style={i(1)}>Tentativas, intervalos e renitência por sinalização valem para qualquer discador. <b>A transferência para uma pessoa vai por SIP ao Discador.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Tentativas</b><span>Por número e por cliente, com intervalo entre elas.</span></li>
					<li className="rv" style={i(1)}><b>Renitência</b><span>O que fazer em cada sinalização: ocupado, caixa postal, não atende.</span></li>
					<li className="rv ouro" style={i(2)}><b>Pausa da rota</b><span>Sem crédito ou com bloqueio, a rota pausa sem penalizar o número.</span></li>
				</ol>
				<p className="nota centro">A telefonia é sua e é paga à operadora. O minuto do agente vem na fatura do MotorCX.</p>
			</section>
			<section className="preto escuro fim" aria-labelledby="h-fim">
				<h2 className="display rv" id="h-fim">Ouça o que ela diria.</h2>
				<p className="lead rv" style={i(1)}>Na demonstração, com o seu cenário e dados fictícios.</p>
				<div className="acoes rv" style={i(2)}><a className="btn" href="/demonstracao?de=voz">Agendar demonstração</a><a className="link" href="/solucoes/speech-analytics">Conhecer o Speech Analytics</a></div>
			</section>
		</>
	);
}
