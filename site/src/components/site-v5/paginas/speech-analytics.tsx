/* Speech Analytics (/solucoes/speech-analytics). Portada do protótipo aprovado; o texto é o aprovado, não reescreva. */
import type { CSSProperties } from 'react';
import { i } from '../estilo';
import { ONDA_SVG } from './onda';

export function PaginaSpeech() {
	return (
		<>
			<section className="cena preto escuro abre" aria-labelledby="h1">
				<div className="texto centro">
					<p className="olho rv">Speech Analytics</p>
					<h1 className="display rv" style={i(1)} id="h1">O que a ligação ensina.</h1>
					<p className="lead rv" style={i(2)}>As ligações analisadas viram nota, motivo e recomendação. <b>A recomendação vira rascunho. Você aprova.</b></p>
					<div className="acoes rv" style={i(3)}><a className="btn" href="/demonstracao?de=speech">Agendar demonstração</a></div>
				</div>
				<svg className="onda rv" style={i(4)} viewBox="0 -6 1100 246" role="img" aria-label="Ilustração: uma ligação desenhada como uma onda de pontos, com três trechos destacados em ouro: motivo, objeção e intenção." dangerouslySetInnerHTML={{ __html: ONDA_SVG }} />
				<p className="ilus-nota">Ilustração</p>
			</section>
			<section className="cena branco" id="entrada" aria-labelledby="h-entra">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-entra">Você liga. Você escolhe o que entra.</h2>
					<p className="lead rv" style={i(1)}>Vem desligado e é ligado por empresa. <b>As ligações do agente de voz entram direto. As do seu time, quando você importa as gravações do Discador.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Importa</b><span>Pelo site, SFTP ou HTTPS, do Discador que você já usa.</span></li>
					<li className="rv" style={i(1)}><b>Mascara</b><span>CPF, cartão, telefone, e-mail e nomes saem antes da IA.</span></li>
					<li className="rv" style={i(2)}><b>Analisa</b><span>A partir de 5 segundos de ligação. O corte é editável.</span></li>
				</ol>
			</section>
			<section className="cena nevoa" id="qualidade" aria-labelledby="h-nota">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-nota">A nota é pelo seu checklist.</h2>
					<p className="lead rv" style={i(1)}>Item a item, na versão do dia. <b>A IA e o seu time, lado a lado.</b></p>
				</div>
				<ul className="checklist rv" style={i(2)} aria-label="Ilustração de um checklist de qualidade, item a item">
					<li><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 9.5l3.5 3.5 7.5-8" /></svg><span>Confirmou a identidade antes de falar de valores</span></li>
					<li><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 9.5l3.5 3.5 7.5-8" /></svg><span>Ofereceu só o que está na alçada</span></li>
					<li><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 9.5l3.5 3.5 7.5-8" /></svg><span>Informou o valor e o vencimento corretos</span></li>
					<li className="nao"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M5 5l8 8M13 5l-8 8" /></svg><span>Respeitou o pedido para não ligar de novo</span><small>Item de gravidade alta no seu checklist</small></li>
				</ul>
				<p className="ilus-nota">Ilustração. Os itens são os do seu checklist.</p>
				<p className="nota centro">Nota por operador só com o ID do operador vindo do Discador e 30 ou mais ligações avaliadas.</p>
			</section>
			<section className="cena preto escuro" id="motivos" aria-labelledby="h-mot">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-mot">Por que não pagou.</h2>
					<p className="lead rv" style={i(1)}>Motivo, objeção e intenção em cada ligação analisada. Temas novos agrupados toda semana. <b>Sinal de vulnerabilidade vai para uma pessoa.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Motivos</b><span>Desemprego, já paguei, parcela alta, não reconheço.</span></li>
					<li className="rv" style={i(1)}><b>Alertas</b><span>Risco e vulnerabilidade sinalizados para revisão humana.</span></li>
					<li className="rv" style={i(2)}><b>Curadoria</b><span>Uma pessoa confirma, corrige e dá nome aos temas novos.</span></li>
				</ol>
			</section>
			<section className="cena branco" id="recomendacoes" aria-labelledby="h-rec">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-rec">Recomendação com evidência.</h2>
					<p className="lead rv" style={i(1)}>Horário, renitência, frases e ofertas. Só com 200 casos por grupo e 5 p.p. de diferença. <b>Aplicar cria um rascunho.</b></p>
				</div>
				<div className="rec rv" style={i(2)} data-rec>
					<span className="tag">Recomendação · dados fictícios</span>
					<h4>Depois de “ocupado”, rediscar em 40 minutos, não em 10.</h4>
					<p className="ev">2.310 ligações por grupo · +5,4 p.p. de contato com a pessoa certa</p>
					<div className="rec-pe">
						<span className="estado"><span className="antes">Estratégia em uso: sem mudança</span><span className="depois">Rascunho criado. Aguarda a sua aprovação.</span></span>
						<button className="btn" type="button">Aplicar</button>
					</div>
				</div>
				<p className="nota centro">Depois de 28 dias em uso, o MotorCX compara o antes e o depois. E avisa que isso não é teste A/B.</p>
			</section>
			<section className="cena nevoa" id="credor" aria-labelledby="h-cred">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-cred">Para o credor, só agregados.</h2>
					<p className="lead rv" style={i(1)}>Todo mês, um relatório com grupos de 30 ou mais ligações. <b>Sem nenhum dado pessoal.</b></p>
				</div>
			</section>
			<section className="preto escuro fim" aria-labelledby="h-fim">
				<h2 className="display rv" id="h-fim">Ouça a sua operação.</h2>
				<div className="acoes rv" style={i(1)}><a className="btn" href="/demonstracao?de=speech">Agendar demonstração</a><a className="link" href="/solucoes/voz">Conhecer o agente de voz</a></div>
			</section>
		</>
	);
}
