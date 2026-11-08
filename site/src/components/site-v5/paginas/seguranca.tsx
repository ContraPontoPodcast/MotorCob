/* Segurança (/seguranca). Portada do protótipo aprovado; o texto é o aprovado, não reescreva. */
import type { CSSProperties } from 'react';
import { i } from '../estilo';

export function PaginaSeguranca() {
	return (
		<>
			<section className="cena preto escuro abre" aria-labelledby="h1">
				<div className="texto centro">
					<p className="olho rv">Segurança</p>
					<h1 className="display rv" style={i(1)} id="h1">Cada empresa só vê a própria base.</h1>
					<p className="lead rv" style={i(2)}>O motor trabalha pelo ID do cliente. <b>A IA que lê as conversas não recebe CPF, telefone, e-mail nem nome.</b></p>
				</div>
			</section>
			<section className="cena branco" aria-labelledby="h-ia">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-ia">O que a IA vê. E o que não vê.</h2>
				</div>
				<div className="duas">
					<div className="rv"><h3>Vê</h3><p>A conversa transcrita e as respostas dos canais, já mascaradas. O suficiente para dar nota, entender o motivo e sugerir.</p></div>
					<div className="rv" style={i(1)}><h3>Não vê</h3><p>CPF, cartão, telefone, e-mail e nomes. Eles saem da transcrição antes de a IA receber o texto.</p></div>
				</div>
			</section>
			<section className="cena nevoa" aria-labelledby="h-banco">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-banco">O que fica guardado.</h2>
					<p className="lead rv" style={i(1)}>As tabelas do motor não guardam contato nem CPF de devedor. As telas mostram só o ID. <b>As listas por canal têm o contato, porque a sua ferramenta precisa dele. Quem baixou cada uma fica registrado.</b></p>
				</div>
				<ol className="passos" style={{ '--n': 3 } as CSSProperties}>
					<li className="rv"><b>Isolamento</b><span>Cada empresa separada no banco.</span></li>
					<li className="rv" style={i(1)}><b>Auditoria</b><span>Quem mudou o quê, e quando.</span></li>
					<li className="rv" style={i(2)}><b>Acesso</b><span>Perfis por pessoa, duas etapas e tokens de API com escopo.</span></li>
				</ol>
			</section>
			<section className="cena preto escuro" aria-labelledby="h-prop">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-prop">Chance de pagar, sem viés de quem é.</h2>
					<p className="lead rv" style={i(1)}>A propensão usa só situação, atraso e saldo. <b>Nunca idade, sexo, DDD, UF ou perfil.</b></p>
				</div>
			</section>
			<section className="cena branco" aria-labelledby="h-limites">
				<div className="texto centro">
					<h2 className="h2 rv" id="h-limites">O que é seu continua seu.</h2>
					<p className="lead rv" style={i(1)}>O horário por UF vem ligado com uma tabela de referência (confirme com o seu jurídico). Chamadas curtas: o MotorCX monitora, alerta e corta a voz em 80% por padrão (regra da Anatel em vigor a partir de 12/11/2026). <b>Cumprir a regra continua sendo da sua operação.</b></p>
				</div>
			</section>
			<section className="preto escuro fim" aria-labelledby="h-fim">
				<h2 className="display rv" id="h-fim">Pergunte o que quiser.</h2>
				<p className="lead rv" style={i(1)}>TI e compliance são bem-vindos na demonstração.</p>
				<div className="acoes rv" style={i(2)}><a className="btn" href="/demonstracao?de=seguranca">Agendar demonstração</a></div>
			</section>
		</>
	);
}
