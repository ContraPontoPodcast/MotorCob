/* Home (/). Portada do protótipo aprovado; o texto é o aprovado, não reescreva. */
import { useEffect, useRef, type CSSProperties } from 'react';
import { i } from '../estilo';
import { iniciarCiclo } from '../efeitos/ciclo';
import { iniciarEngrenagens } from '../efeitos/engrenagens';
import { iniciarFicha } from '../efeitos/ficha';
import { iniciarFios } from '../efeitos/fios';
import { iniciarMatriz } from '../efeitos/matriz';
import { iniciarFrasesDor } from '../efeitos/revelar';

export function PaginaHome() {
	const ficha = useRef<HTMLElement>(null), dor = useRef<HTMLElement>(null), matriz = useRef<HTMLElement>(null);
	const ciclo = useRef<HTMLElement>(null), motor = useRef<HTMLElement>(null), func = useRef<HTMLElement>(null);
	/* As animações da home (ficha, frases, Matriz, ciclo da IA, engrenagens e fios), cada uma com a sua limpeza. */
	useEffect(() => {
		const pares: [HTMLElement | null, (el: HTMLElement) => () => void][] = [
			[ficha.current, iniciarFicha], [dor.current, iniciarFrasesDor], [ciclo.current, iniciarCiclo],
			[func.current, iniciarFios], [matriz.current, iniciarMatriz], [motor.current, iniciarEngrenagens],
		];
		const limpa = pares.map(([el, iniciar]) => (el ? iniciar(el) : () => {}));
		return () => limpa.forEach(f => f());
	}, []);
	return (
		<>
			{/* 1 · Hero: a IA decidindo, cliente a cliente */}
			<section className="preto escuro" aria-labelledby="h-hero">
				<div className="hero">
					<div>
						<p className="olho">Para assessorias e credores</p>
						<h1 className="display" id="h-hero"><span>Contato certo.</span><span>Canal certo.</span><span>Mensagem certa.</span></h1>
						<p className="lead">Para cada cliente da carteira, a MotorCX Intelligence decide se aciona, em qual contato e por qual canal. <b>E mostra o motivo.</b></p>
						<div className="acoes">
							<a className="btn" href="/demonstracao?de=home">Agendar demonstração</a>
							<a className="link" href="#ia">Conhecer a MotorCX Intelligence</a>
						</div>
					</div>
					<figure ref={ficha} className="ficha" data-ficha aria-label="Exemplos de decisão, um cliente fictício por vez. A ficha troca sozinha a cada poucos segundos.">
						<div className="ficha-cab"><span data-f="id">CLIENTE 100004817</span><span className="ficha-ia"><i></i>IA · <span data-f="estado">decidido</span></span></div>
						<ol>
							<li className="on"><span>Perfil</span><b data-f="perfil">Atraso curto, com WhatsApp</b></li>
							<li className="on"><span>Chance de pagar</span><b data-f="faixa">Faixa A <small>muito alta</small></b></li>
							<li className="on"><span>Contato</span><b className="mono" data-f="contato">(11) 9••••-••17 · principal</b></li>
							<li className="on"><span>Canal</span><b data-f="canal">WhatsApp</b></li>
							<li className="on"><span>Mensagem</span><b data-f="msg">Lembrete · template da sua régua</b></li>
							<li className="on fim"><span>Decisão</span><b data-f="decisao">Na Lista do dia<small>Matriz: Acelerar</small></b></li>
						</ol>
						<div className="ficha-pe"><figcaption>Ilustração. Dados fictícios.</figcaption><span className="ficha-pos" aria-hidden="true"></span><button className="pausa" type="button"></button></div>
					</figure>
				</div>
			</section>
			{/* 2 · A dor */}
			<section ref={dor} className="cena nevoa dor" aria-label="O problema">
				<p className="frase">Disparar não é comunicar.</p>
				<p className="frase">Sua operação ainda começa com PROCV.</p>
				<p className="frase">O telefone certo existe. Você só não sabe qual é.</p>
			</section>
			{/* 3 · A carteira se organiza sozinha (a Matriz) */}
			<section ref={matriz} className="mz" id="matriz" data-matriz aria-labelledby="h-mz">
				<h2 className="vh" id="h-mz">O cruzamento: quem é, quem paga e por onde responde, na Matriz.</h2>
				<p className="vh">Ilustração com uma carteira fictícia. Cada ponto é um cliente. A IA agrupa os clientes em quatro perfis, mostra a chance de pagar de cada um em faixas de A a E, aprende o canal de cada perfil e coloca cada perfil numa das quatro caixas da Matriz: Acelerar (alta chance e abordagem definida), Descobrir rápido (alta chance, ainda aprendendo), Manter barato (baixa chance e abordagem definida) e Economizar (baixa chance, ainda aprendendo). As caixas são sugestão; a operação decide o que cada uma faz.</p>
				<div className="mz-trilho">
					<div className="mz-fixo">
						<canvas className="mz-cv" aria-hidden="true"></canvas>
						<div className="mz-txt escuro">
							<div className="mz-beats">
								<div className="mz-beat on"><p className="t">Sua carteira.</p><p className="lead">Cada ponto é um cliente.</p></div>
								<div className="mz-beat"><p className="t">Quem é.</p><p className="lead">Clientes parecidos viram perfis, a partir das colunas da sua carga.</p></div>
								<div className="mz-beat"><p className="t">Quem paga.</p><p className="lead">A chance de cada cliente pagar em 30 dias, de A a E. <b>Alta para cima, baixa para baixo.</b></p></div>
								<div className="mz-beat"><p className="t">Por onde responde.</p><p className="lead">O canal que dá mais contato com a pessoa certa, por real gasto. <b>Com volume, ele fica definido.</b></p></div>
								<div className="mz-beat"><p className="t">A Matriz.</p><p className="lead">Chance de pagar × abordagem. Cada caixa traz uma sugestão. <b>Quem decide é você.</b></p></div>
							</div>
							<ol className="mz-prog" aria-hidden="true"><li className="on"></li><li></li><li></li><li></li><li></li></ol>
						</div>
						<p className="mz-nota">Ilustração. Dados fictícios.</p>
						<button className="pausa" type="button"></button>
					</div>
				</div>
			</section>
			<div className="mz-depois">
				<p className="rv">Contato e canal, a IA aprende por perfil. A chance de pagar, ela calcula. <b>A mensagem é sua: ela registra qual foi e mede.</b></p>
				<div className="acoes escuro rv" style={{ '--i': 1, justifyContent: 'center' } as CSSProperties}><a className="link" href="/como-decide">Ver como a IA decide</a></div>
			</div>
			{/* 4 · A IA: Entende · Decide · Age · Aprende, em ciclo */}
			<section ref={ciclo} className="ia escuro" id="ia" data-ciclo aria-labelledby="h-ia">
				<div className="ia-grade">
					<div>
						<p className="olho rv">A IA do MotorCX</p>
						<h2 className="ia-nome rv" style={i(1)} id="h-ia">MotorCX<br />Intelligence</h2>
						<p className="lead rv" style={i(2)}>A inteligência que faz o motor girar, cliente a cliente. <b>E o que ela aprende volta para o começo.</b></p>
					</div>
					<div className="ciclo rv" style={i(2)}>
						<svg className="ciclo-svg" viewBox="0 0 600 600" aria-hidden="true">
							<defs>
								<filter id="ia-brilho" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
								<path id="arco-volta" d="M 46 300 A 254 254 0 0 1 300 46" />
							</defs>
							<text className="volta" dy="-4"><textPath href="#arco-volta" startOffset="50%" textAnchor="middle">o que aprende volta ↻</textPath></text>
						</svg>
						<button type="button" className="v v1" data-d="Lê a carga, entende a situação de cada cliente e agrupa os parecidos em perfis."><b>Entende</b></button>
						<button type="button" className="v v2" data-d="Cliente a cliente: o contato, o canal e a chance de pagar."><b>Decide</b></button>
						<button type="button" className="v v3" data-d="Monta a Lista do dia e leva cada cliente ao canal: Mensageria, Agente de voz ou o mailing do Discador."><b>Age</b></button>
						<button type="button" className="v v4" data-d="Mede cada resposta, ajusta o que aprendeu e sugere mudanças como rascunho, para você aprovar."><b>Aprende</b></button>
						<div className="ciclo-centro entra" aria-live="off">
							<p className="cc-n">01 / 04</p>
							<p className="cc-v">Entende</p>
							<p className="cc-d">Lê a carga, entende a situação de cada cliente e agrupa os parecidos em perfis.</p>
						</div>
						<button className="pausa" type="button"></button>
					</div>
				</div>
				<p className="cc-d cc-d2" aria-hidden="true">Lê a carga, entende a situação de cada cliente e agrupa os parecidos em perfis.</p>
				<div className="vh">
					<p>O ciclo da IA, em laço:</p>
					<ol><li>Entende: lê a carga, entende a situação de cada cliente e agrupa os parecidos em perfis.</li><li>Decide: cliente a cliente, o contato, o canal e a chance de pagar.</li><li>Age: monta a Lista do dia e leva cada cliente ao canal: Mensageria, Agente de voz ou o mailing do Discador.</li><li>Aprende: mede cada resposta, ajusta o que aprendeu e sugere mudanças como rascunho, para você aprovar. E volta para Entende.</li></ol>
				</div>
				<div className="ia-aprova">
					<h3 className="h3 rv">A IA sugere. Você aprova.</h3>
					<p className="rv" style={i(1)}>A rotina do dia ela decide. A estratégia, não: toda mudança de régua, frase ou horário chega como rascunho. <b style={{ color: '#F5F5F7', fontWeight: '600' } as CSSProperties}>Nada muda sozinho.</b></p>
					<ol className="aprova">
						<li className="rv" style={i(1)}><b>Sugere</b>Só com evidência suficiente.</li>
						<li className="rv" style={i(2)}><b>Vira rascunho</b>A estratégia em uso não muda.</li>
						<li className="rv ouro" style={i(3)}><b>Você aprova</b>Ou descarta. A decisão é sua.</li>
					</ol>
				</div>
			</section>
			{/* 5 · Engrenagens de luz: a IA faz o motor girar */}
			<section ref={motor} className="ou-sec" id="engrenagens" data-motor="luz" aria-labelledby="h-eng">
				<div className="ou-fixo">
					<canvas className="ou-luz-cv" role="img" aria-label="As 14 engrenagens do MotorCX desenhadas por pontos de luz. Elas acendem sozinhas, uma a uma, na ordem do fluxo, com pulsos dourados passando de uma para a outra; Personas e propensão e Orquestração ficam no centro. Os nomes e links estão na lista abaixo."></canvas>
					<div className="ou-luz-txt">
						<h2 className="ou-h2" id="h-eng">Um motor. Muitas engrenagens.</h2>
						<p className="ou-sub">A MotorCX Intelligence faz o motor girar: cada engrenagem entrega a entrada da próxima. <strong>Nenhuma gira sozinha.</strong></p>
						<div className="ou-luz-atual" aria-hidden="true">
							<p className="ou-cont"><b>01</b><span>/14</span></p>
							<p className="ou-luz-nome"></p>
							<p className="ou-luz-desc"></p>
						</div>
						<p className="ou-luz-flx" aria-hidden="true"></p>
					</div>
					<button className="ou-pausa" type="button"></button>
				</div>
				<nav className="ou-leg" aria-label="As 14 engrenagens do MotorCX"></nav>
			</section>
			{/* 6 · As seis funcionalidades, ligadas à IA */}
			<section ref={func} className="cena branco func" id="funcionalidades" data-func aria-labelledby="h-func">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-func">Seis funcionalidades. Uma IA.</h2>
					<p className="lead rv" style={i(1)}>Todas ligadas à MotorCX Intelligence. <b>O que uma aprende, as outras usam.</b></p>
				</div>
				<div className="func-palco">
					<svg className="func-fios" aria-hidden="true"></svg>
					<ul className="func-lista">
						<li className="fn rv">
							<span className="fn-ico" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 7h22M3 14h22M3 21h22" strokeOpacity=".35" /><circle cx="7" cy="7" r="2.2" fill="currentColor" /><circle cx="15" cy="7" r="2.2" /><circle cx="11" cy="14" r="2.2" fill="currentColor" /><circle cx="21" cy="14" r="2.2" /><circle cx="17" cy="21" r="2.2" fill="currentColor" /></svg></span>
							<h3>Orquestração</h3>
							<p>Segmentos, estágios e a régua de cada carteira, com uma raia por perfil.</p>
							<a className="link" href="/como-decide#regua">Ver a régua</a>
						</li>
						<li className="fn rv" style={i(1)}>
							<span className="fn-ico" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 12v4M8 9v10M12 5v18M16 8v12M20 11v6M24 13v2" /></svg></span>
							<h3>Agente de Voz</h3>
							<p>Liga pela sua telefonia e só fala o que está no fluxo aprovado.</p>
							<a className="link" href="/solucoes/voz">Conhecer o agente</a>
						</li>
						<li className="fn rv" style={i(2)}>
							<span className="fn-ico" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"><path d="M5 6.5h18a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H12l-5 4v-4H5A1.5 1.5 0 0 1 3.5 18V8A1.5 1.5 0 0 1 5 6.5z" /><path d="M9 11.5h10M9 15h6" strokeOpacity=".45" /></svg></span>
							<h3>Mensageria</h3>
							<p>SMS, RCS e e-mail, com o Radar lendo as respostas. WhatsApp <span className="breve">em breve</span></p>
							<a className="link" href="/solucoes/cobranca#canais">Ver os canais</a>
						</li>
						<li className="fn rv" style={i(1)}>
							<span className="fn-ico" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="10" r="5.5" strokeOpacity=".4" /><circle cx="19" cy="10" r="5.5" strokeOpacity=".4" /><circle cx="14" cy="19" r="5.5" /><circle cx="14" cy="19" r="1.6" fill="currentColor" /></svg></span>
							<h3>Persona</h3>
							<p>Descobre, perfil a perfil, o canal que dá mais contato por real gasto.</p>
							<a className="link" href="/como-decide#perfis">Ver os perfis</a>
						</li>
						<li className="fn rv" style={i(2)}>
							<span className="fn-ico" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4.5 20a9.5 9.5 0 0 1 19 0" strokeOpacity=".4" /><path d="M14 20l5.5-6.5" /><circle cx="14" cy="20" r="1.8" fill="currentColor" /><path d="M4 24h20" strokeOpacity=".4" /></svg></span>
							<h3>Propensão a Pagamento</h3>
							<p>A chance de pagar em 30 dias, de A a E, usada como condição de etapa.</p>
							<a className="link" href="/como-decide#matriz">Ver a Matriz</a>
						</li>
						<li className="fn rv" style={i(3)}>
							<span className="fn-ico" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14h2.5l2-5 3 10 3-12 3 9 2-4H20" strokeOpacity=".45" /><path d="M19.5 15.5l2.5 2.5 4.5-5.5" /></svg></span>
							<h3>Speech Analytics</h3>
							<p>Nota, motivo e recomendação nas ligações analisadas.</p>
							<a className="link" href="/solucoes/speech-analytics">Conhecer o Speech Analytics</a>
						</li>
					</ul>
					<div className="func-nucleo" aria-hidden="true"><span className="nucleo-pt"><span className="nucleo-txt"><b>MotorCX</b><small>Intelligence</small></span></span></div>
					<button className="pausa" type="button"></button>
				</div>
			</section>
			{/* 7 · Fechamento */}
			<section className="preto escuro fim" aria-labelledby="h-fim">
				<h2 className="display rv" id="h-fim">Mostre a sua carteira.</h2>
				<p className="lead rv" style={i(1)}>Conte como ela é, numa conversa. A gente mostra as decisões que ela esconde.</p>
				<div className="acoes rv" style={i(2)}><a className="btn" href="/demonstracao?de=home">Agendar demonstração</a></div>
				<p className="seg rv" style={i(3)}>As conversas chegam à IA sem CPF, telefone nem e-mail. Cada empresa só vê a própria base. <a className="link" href="/seguranca">Ver segurança</a></p>
			</section>
		</>
	);
}
