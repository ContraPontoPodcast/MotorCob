/* Como decide (/como-decide). Portada do protótipo aprovado; o texto é o aprovado, não reescreva. */
import type { CSSProperties } from 'react';
import { i } from '../estilo';

export function PaginaComoDecide() {
	return (
		<>
			<section className="cena preto escuro abre" aria-labelledby="h1">
				<div className="texto centro">
					<p className="olho rv">Como decide</p>
					<h1 className="display rv" style={i(1)} id="h1">Quem atende. Quem paga.</h1>
					<p className="lead rv" style={i(2)}>A MotorCX Intelligence aprende o contato de cada cliente e o canal de cada perfil, e calcula a chance de pagar. <b>A Matriz cruza os dois.</b></p>
				</div>
			</section>
			<section className="cena branco" aria-labelledby="h-perg">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-perg">Cinco perguntas. Para cada cliente.</h2>
					<p className="lead rv" style={i(1)}>Algumas a IA aprende. <b>Outras são suas.</b></p>
				</div>
				<ol className="linhas">
					<li className="rv"><b>Contato</b><span>Qual número ou e-mail é dele, e responde?</span><em className="motor">A IA aprende</em></li>
					<li className="rv"><b>Canal</b><span>Onde clientes como ele respondem mais, por real gasto?</span><em className="motor">A IA aprende, por perfil</em></li>
					<li className="rv"><b>Chance de pagar</b><span>Qual a chance de pagar em 30 dias, de A a E?</span><em className="motor">A IA calcula</em></li>
					<li className="rv"><b>Momento</b><span>Em que estágio ele está e qual o passo de hoje?</span><em>Você configura</em></li>
					<li className="rv"><b>Mensagem</b><span>O que dizer em cada passo?</span><em>Você escolhe. A IA mede</em></li>
				</ol>
			</section>
			<section className="cena preto escuro" id="matriz" aria-labelledby="h-mtz">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-mtz">A Matriz.</h2>
					<p className="lead rv" style={i(1)}>Chance de pagar × abordagem do perfil. <b>Cada caixa é uma sugestão. Quem decide o que ela faz é a sua operação.</b></p>
				</div>
				<div className="mtz rv" style={i(2)} role="group" aria-label="Matriz chance de pagar por abordagem">
					<span className="ex ey">alta chance</span>
					<div className="q"><b>Descobrir rápido</b><span>Alta chance de pagar. O canal do perfil ainda está sendo aprendido.</span></div>
					<div className="q ac"><b>Acelerar</b><span>Alta chance de pagar. O canal do perfil já está definido.</span></div>
					<span className="ex ey">baixa chance</span>
					<div className="q"><b>Economizar</b><span>Baixa chance de pagar. O canal ainda está sendo aprendido.</span></div>
					<div className="q"><b>Manter barato</b><span>Baixa chance de pagar. O canal já está definido.</span></div>
					<span></span><span className="ex">aprendendo</span><span className="ex">definida</span>
				</div>
				<p className="nota centro rv">Alta = faixas A a C. Baixa = D e E. Hoje a abordagem mede o canal: Coletando e Prévia contam como aprendendo.</p>
			</section>
			<section className="cena branco" id="perfis" aria-labelledby="h-perfis">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-perfis">Dois tipos de perfil.</h2>
					<p className="lead rv" style={i(1)}>Um o motor descobre. O outro você define. <b>Os dois convivem.</b></p>
				</div>
				<div className="duas">
					<div className="rv"><h3>Aprendido pelo motor</h3><p>A cada rotina, o motor testa as características da carga, como faixa de saldo, atraso e se o cliente tem WhatsApp. Fica com as que mais mudam o contato com a pessoa certa e ordena os canais por real gasto. Com pouco volume, segue a média da carteira.</p></div>
					<div className="rv" style={i(1)}><h3>Definido por você</h3><p>Grupos que você monta por condições, ou copia de um dos 9 modelos do MotorCX, como “prefere digital” e “prefere analógico”. São eles que viram raias na régua, com canais e mensagem próprios.</p></div>
				</div>
			</section>
			<section className="cena nevoa" id="regua" aria-labelledby="h-raia">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-raia">A régua continua sua.</h2>
					<p className="lead rv" style={i(1)}>Segmentos, estágios e uma raia por perfil. A chance de pagar entra como condição de estágio. <b>Nada vem imposto.</b></p>
				</div>
		<div className="regua rv" style={i(2)} role="group" aria-label="Ilustração de uma régua com duas raias. Estágio com condição de chance de pagar A a C. Público geral: D+1 SMS com lembrete; D+3 WhatsApp, senão SMS; D+5 agente de voz com o Discador de reserva; D+8 e-mail. Perfil prefere digital: D+1 o melhor canal do perfil; D+3 RCS, senão SMS; D+5 segue o público geral; D+8 e-mail.">
					<span></span><span className="dia">D+1</span><span className="dia">D+3</span><span className="dia">D+5</span><span className="dia">D+8</span>
					<span className="raia">Público geral<small>todos do estágio</small></span>
					<span className="passo">SMS<small>lembrete</small></span><span className="passo">WhatsApp<small>senão SMS</small></span><span className="passo">Agente de voz<small>Discador de reserva</small></span><span className="passo">E-mail<small>proposta</small></span>
					<span className="raia">Prefere digital<small>perfil da carteira</small></span>
					<span className="passo perfil">★ Melhor canal<small>do perfil</small></span><span className="passo perfil">RCS<small>senão SMS</small></span><span className="passo vazio">—<small>segue o público geral</small></span><span className="passo perfil">E-mail<small>proposta</small></span>
				</div>
				<p className="ilus-nota">Ilustração · estágio com condição “chance de pagar A a C” · dados fictícios</p>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Comece como quiser</b><span>Do zero, copiando outra carteira ou de um modelo.</span></li>
					<li className="rv" style={i(1)}><b>Use o melhor canal</b><span>Um passo pode usar “★ melhor canal do perfil” no lugar de um canal fixo.</span></li>
					<li className="rv" style={i(2)}><b>Trave o que importa</b><span>Opt-out, Não Perturbe, horário e recência nenhuma régua desliga.</span></li>
				</ol>
			</section>
			<section className="cena branco" aria-labelledby="h-nada">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-nada">Evidência antes de mudança.</h2>
					<p className="lead rv" style={i(1)}>Cada perfil passa por três estados. <b>Mudar a régua é sempre um rascunho para você aprovar.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Coletando</b><span>Ainda sem volume. Segue a média da carteira.</span></li>
					<li className="rv" style={i(1)}><b>Prévia</b><span>Já ordena os canais, sem pedir mudança.</span></li>
					<li className="rv ouro" style={i(2)}><b>Definida</b><span>Com 200 tentativas e ganho claro, sugere trocar o 1º canal.</span></li>
				</ol>
				<div className="rec rv" data-rec>
					<span className="tag">Sugestão · perfil Saldo alto, atraso longo · dados fictícios</span>
					<h4>Trocar o WhatsApp do D+3 pelo agente de voz.</h4>
					<p className="ev">1.240 tentativas · mais contato com a pessoa certa por real gasto</p>
					<div className="rec-pe">
						<span className="estado"><span className="antes">Estratégia em uso: sem mudança</span><span className="depois">Rascunho criado. Aguarda a sua aprovação.</span></span>
						<button className="btn" type="button">Aplicar</button>
					</div>
				</div>
			</section>
			<section className="preto escuro fim" aria-labelledby="h-fim">
				<h2 className="display rv" id="h-fim">A IA sugere. Você decide.</h2>
				<div className="acoes rv" style={i(1)}><a className="btn" href="/demonstracao?de=como-decide">Agendar demonstração</a><a className="link" href="/solucoes/cobranca">Ver a Lista do dia</a></div>
			</section>
		</>
	);
}
