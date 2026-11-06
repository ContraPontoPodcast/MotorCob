/* Agendar demonstração (/demonstracao). Portada do protótipo aprovado; o texto é o aprovado, não reescreva.
   O formulário grava no mesmo lugar do antigo "Fale com a gente" da home: public.contatos_site (SQL 29 + SQL 52),
   só com a chave anon. O visitante só insere; o Console › Contatos do site lê.
   A tabela tem nome, empresa, email, telefone, mensagem, consentimento e origem. Os campos da carteira (interesse,
   tipo de credor, tamanho, discador e canais) vão juntos no texto de "mensagem", uma linha cada; a origem é o ?de=
   do link (home, cobranca, voz, speech, rodape...). */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';

const INTERESSES: [string, string][] = [['cobranca', 'Cobrança'], ['voz', 'Voz'], ['speech', 'Speech Analytics'], ['nao-sei', 'Ainda não sei']];
const CREDORES = ['Banco ou financeira', 'Varejo', 'Telecom', 'Utilities', 'Outro'];
const TAMANHOS = ['Até 50 mil clientes', '50 a 500 mil', 'Mais de 500 mil'];
const CANAIS: [string, string][] = [['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['rcs', 'RCS'], ['email', 'E-mail'], ['discador', 'Discador']];
/* O mesmo formato de e-mail que o banco exige (contatos_site_email_formato, SQL 52). */
const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i;

/** O ?de= do link, limpo como no protótipo (só letras minúsculas e hífen, até 30). */
export function origemDe(de: string | null): string {
	return (de || 'direto').replace(/[^a-z-]/g, '').slice(0, 30) || 'direto';
}

type Carteira = { interesse: string; credor: string; tamanho: string; discador: string; canais: string[] };

/** As respostas que a tabela não tem coluna própria, uma por linha, para o campo "mensagem". */
export function mensagemDaCarteira(c: Carteira): string {
	const linhas: string[] = ['Pedido de demonstração pelo site.'];
	const interesse = INTERESSES.find(([v]) => v === c.interesse)?.[1];
	if (interesse) linhas.push(`O que interessa: ${interesse}`);
	if (c.credor) linhas.push(`Tipo de credor: ${c.credor}`);
	if (c.tamanho) linhas.push(`Tamanho: ${c.tamanho}`);
	if (c.discador.trim()) linhas.push(`Discador atual: ${c.discador.trim()}`);
	const canais = CANAIS.filter(([v]) => c.canais.includes(v)).map(([, n]) => n);
	if (canais.length) linhas.push(`Canais que usa hoje: ${canais.join(', ')}`);
	return linhas.join('\n');
}

export function PaginaDemonstracao() {
	const [params] = useSearchParams();
	const de = origemDe(params.get('de'));
	const inicial = ['cobranca', 'voz', 'speech'].includes(de) ? de : '';
	const [nome, setNome] = useState('');
	const [empresa, setEmpresa] = useState('');
	const [email, setEmail] = useState('');
	const [telefone, setTelefone] = useState('');
	const [interesse, setInteresse] = useState(inicial);
	const [credor, setCredor] = useState('');
	const [tamanho, setTamanho] = useState('');
	const [discador, setDiscador] = useState('');
	const [canais, setCanais] = useState<string[]>([]);
	const [consent, setConsent] = useState(false);
	const [armadilha, setArmadilha] = useState('');
	const [erro, setErro] = useState('');
	const [enviando, setEnviando] = useState(false);
	const [enviado, setEnviado] = useState(false);
	const rNome = useRef<HTMLInputElement>(null), rEmail = useRef<HTMLInputElement>(null), rConsent = useRef<HTMLInputElement>(null);
	const obrigado = useRef<HTMLDivElement>(null);

	useEffect(() => { setInteresse(inicial); }, [inicial]);
	useEffect(() => { if (enviado) obrigado.current?.focus(); }, [enviado]);

	function limpar() {
		setNome(''); setEmpresa(''); setEmail(''); setTelefone(''); setInteresse(''); setCredor(''); setTamanho('');
		setDiscador(''); setCanais([]); setConsent(false);
	}

	async function enviar(e: FormEvent) {
		e.preventDefault();
		if (enviando) return;
		if (!nome.trim()) { setErro('Preencha o nome.'); rNome.current?.focus(); return; }
		if (!EMAIL.test(email.trim())) { setErro('Confira o e-mail.'); rEmail.current?.focus(); return; }
		if (!consent) { setErro('Marque a caixa de consentimento para enviar.'); rConsent.current?.focus(); return; }
		setErro('');
		if (armadilha) { setEnviado(true); limpar(); return; }   // robô preencheu o campo escondido: não grava
		setEnviando(true);
		try {
			if (!supabase) throw new Error('Supabase não configurado');
			// Só insere (sem .select()): o visitante não tem leitura na tabela (RLS, SQL 52).
			const { error, status } = await supabase.from('contatos_site').insert({
				nome: nome.trim(),
				empresa: empresa.trim() || null,
				email: email.trim(),
				telefone: telefone.trim() || null,
				mensagem: mensagemDaCarteira({ interesse, credor, tamanho, discador, canais }),
				consentimento: true,
				origem: de,
			});
			if (error) {
				const limite = /muitas mensagens/i.test(error.message ?? '');
				setErro(limite || status === 429 ? 'Muitas mensagens em pouco tempo. Tente mais tarde.' : 'Não conseguimos enviar agora. Tente de novo.');
				return;
			}
			setEnviado(true);
			limpar();
		} catch {
			setErro('Não conseguimos enviar agora. Tente de novo.');
		} finally {
			setEnviando(false);
		}
	}

	const marcaCanal = (v: string, on: boolean) => setCanais(cs => (on ? [...cs.filter(c => c !== v), v] : cs.filter(c => c !== v)));
	const mexeu = () => { if (erro) setErro(''); };

	return (
		<section className="cena preto escuro abre" aria-labelledby="h1">
			<div className="demo">
				<div>
					<p className="olho">Demonstração</p>
					<h1 className="display" id="h1">Mostre a sua carteira.</h1>
					<p className="lead">Conte como ela é. <b>A demonstração roda numa empresa fictícia, no formato da sua operação.</b></p>
					<ol className="depois" aria-label="O que acontece depois">
						<li>Entramos em contato para combinar o melhor horário.</li>
						<li>Uma conversa sobre a sua operação.</li>
						<li>A demonstração com volume parecido com o seu, e dados fictícios.</li>
					</ol>
					<div className="contrata">
						<h2>Como contratamos</h2>
						<p><b>Você liga só o que usa.</b> Orquestração, Mensageria, agente de voz e Speech Analytics são módulos separados.</p>
						<p><b>Inteligência por CPF ou mensalidade. Canais e IA pelo consumo.</b></p>
						<p><b>Fatura por item, na plataforma.</b> Pré ou pós-pago.</p>
					</div>
				</div>

				<div className={enviado ? 'caixa enviado' : 'caixa'} aria-live="polite">
					<form noValidate onSubmit={enviar} onInput={mexeu} aria-busy={enviando}>
						<input type="hidden" name="origem" value={de} />
						<div className="campos">
							<label>Nome *<input ref={rNome} type="text" name="nome" required autoComplete="name" maxLength={200} value={nome} onChange={e => setNome(e.target.value)} /></label>
							<label>Empresa<input type="text" name="empresa" autoComplete="organization" maxLength={200} value={empresa} onChange={e => setEmpresa(e.target.value)} /></label>
							<label>E-mail *<input ref={rEmail} type="email" name="email" required autoComplete="email" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} /></label>
							<label>Telefone <small>opcional</small><input type="tel" name="telefone" autoComplete="tel" maxLength={40} value={telefone} onChange={e => setTelefone(e.target.value)} /></label>
							<label className="todo">O que interessa<select name="interesse" value={interesse} onChange={e => setInteresse(e.target.value)}><option value="">Escolha</option>{INTERESSES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
						</div>
						<fieldset className="grupo-carteira">
							<legend>Sua carteira <small>tudo opcional, em faixas</small></legend>
							<div className="campos" style={{ marginTop: '14px' }}>
								<label>Tipo de credor<select name="credor" value={credor} onChange={e => setCredor(e.target.value)}><option value="">Escolha</option>{CREDORES.map(c => <option key={c}>{c}</option>)}</select></label>
								<label>Tamanho<select name="tamanho" value={tamanho} onChange={e => setTamanho(e.target.value)}><option value="">Escolha</option>{TAMANHOS.map(t => <option key={t}>{t}</option>)}</select></label>
								<label className="todo">Discador atual<input type="text" name="discador" placeholder="Nome da ferramenta" maxLength={120} value={discador} onChange={e => setDiscador(e.target.value)} /></label>
							</div>
							<p style={{ margin: '18px 0 0', fontSize: '13px', fontWeight: 600 }}>Canais que usa hoje</p>
							<div className="chips">
								{CANAIS.map(([v, n]) => <label key={v}><input type="checkbox" name="canais" value={v} checked={canais.includes(v)} onChange={e => marcaCanal(v, e.target.checked)} />{n}</label>)}
							</div>
						</fieldset>
						<p className="aviso-arq">Não envie arquivos nem dados de clientes. A conversa basta.</p>
						{/* Campo-armadilha para robôs: escondido de quem vê e de leitores de tela. */}
						<input className="vh" type="text" name="site" tabIndex={-1} autoComplete="off" aria-hidden="true" value={armadilha} onChange={e => setArmadilha(e.target.value)} />
						<label className="consent"><input ref={rConsent} type="checkbox" name="consentimento" required checked={consent} onChange={e => setConsent(e.target.checked)} /> Concordo que o MotorCX use estes dados para retornar o meu contato.</label>
						<p className="erro" role="alert">{erro}</p>
						<button className="btn" type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</button>
					</form>
					<div className="obrigado" tabIndex={-1} ref={obrigado}>
						<span className="ok"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg></span>
						<h2>Recebemos.</h2>
						<p>Entramos em contato para combinar a demonstração.</p>
					</div>
				</div>
			</div>
		</section>
	);
}
