/* A ficha do topo da home: clientes fictícios que se decidem linha a linha, em ordem aleatória, em laço.
   Coerente com a Matriz: alta chance (A–C) com canal definido = Acelerar; alta, ainda aprendendo = Descobrir
   rápido; baixa (D–E) com canal definido = Manter barato (régua leve, canal barato); baixa e aprendendo =
   Economizar. Quem fica de fora tem o motivo. A mensagem é a da régua do cliente; discador e e-mail não levam
   mensagem na lista. Tudo fictício. A primeira ficha é sempre o cliente 100004817 (Acelerar). */
import { botaoPausa, movimentoReduzido, visivel, type Limpeza, type Pausa } from './comum';

const FAIXA: Record<string, string> = { A: 'muito alta', B: 'alta', C: 'média', D: 'baixa', E: 'muito baixa' };
type Ficha = { id: string; perfil: string; faixa: string; contato: string; canal: string; msg: string; dec: string; sub: string; fora?: boolean };
export const FICHAS: Ficha[] = [
	{ id: '100004817', perfil: 'Atraso curto, com WhatsApp', faixa: 'A', contato: '(11) 9••••-••17 · principal', canal: 'WhatsApp', msg: 'Lembrete · template da sua régua', dec: 'Na Lista do dia', sub: 'Matriz: Acelerar' },
	{ id: '100021356', perfil: 'Saldo alto, atraso curto', faixa: 'B', contato: '(21) 9••••-••64 · rodízio', canal: 'Agente de voz', msg: 'Proposta · fluxo que você aprovou', dec: 'Na Lista do dia', sub: 'Matriz: Descobrir rápido' },
	{ id: '100038902', perfil: 'Saldo baixo, atraso longo', faixa: 'D', contato: '(31) 9••••-••08 · principal', canal: 'SMS', msg: 'Parcelas · frase da sua régua', dec: 'Régua leve, canal barato', sub: 'Matriz: Manter barato' },
	{ id: '100047120', perfil: 'Atraso longo, sem WhatsApp', faixa: 'E', contato: 'Nenhum contato válido', canal: '—', msg: '—', dec: 'Fica de fora hoje', sub: 'Motivo: sem contato válido. Vai ao bureau.', fora: true },
	{ id: '100052277', perfil: 'Atraso curto, só e-mail', faixa: 'C', contato: 'm•••••@•••••.com.br · principal', canal: 'E-mail', msg: 'O template fica no seu fornecedor', dec: 'Na Lista do dia', sub: 'Matriz: Acelerar' },
	{ id: '100060431', perfil: 'Saldo médio, com RCS', faixa: 'B', contato: '(41) 9••••-••53 · principal', canal: 'RCS', msg: 'Proposta · template da sua régua', dec: 'Na Lista do dia', sub: 'Matriz: Acelerar' },
	{ id: '100071985', perfil: 'Saldo alto, atraso longo', faixa: 'C', contato: '(51) 3•••-••21 · ainda não tentado', canal: 'Discador', msg: 'O operador conduz a conversa', dec: 'No mailing do Discador', sub: 'Matriz: Descobrir rápido' },
	{ id: '100083546', perfil: 'Atraso curto, com WhatsApp', faixa: 'D', contato: '(19) 9••••-••30 · principal', canal: '—', msg: '—', dec: 'Fica de fora hoje', sub: 'Motivo: outra carteira acionou há menos de 48 h.', fora: true },
	{ id: '100094410', perfil: 'Saldo baixo, atraso curto', faixa: 'E', contato: '(85) 9••••-••72 · principal', canal: 'SMS', msg: 'Lembrete · frase da sua régua', dec: 'Régua leve, canal barato', sub: 'Matriz: Economizar' },
];

export function iniciarFicha(el: HTMLElement): Limpeza {
	const RM = movimentoReduzido();
	const lis = Array.from(el.querySelectorAll<HTMLElement>('ol li'));
	const campo = (n: string) => el.querySelector<HTMLElement>(`[data-f="${n}"]`)!;
	const idEl = campo('id'), estEl = campo('estado'), posEl = el.querySelector<HTMLElement>('.ficha-pos');
	const btn = el.querySelector<HTMLButtonElement>('.pausa')!;
	const PASSO = 420, SEGURA = 3600, APAGA = 520;
	let fila: number[] = [], atual = -1, tmr = 0, etapa = 0, vis = true;
	let ctl: Pausa | null = null;
	function sorteia(): number {
		if (atual === -1) return 0;   /* a primeira ficha é sempre um caso positivo (Acelerar) */
		if (!fila.length) {
			fila = FICHAS.map((_, i) => i);
			for (let i = fila.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = fila[i]; fila[i] = fila[j]; fila[j] = t; }
			if (fila[0] === atual) fila.push(fila.shift()!);
		}
		return fila.shift()!;
	}
	function preenche(i: number) {
		const f = FICHAS[i]; atual = i;
		el.setAttribute('data-cliente', f.id);
		idEl.textContent = 'CLIENTE ' + f.id;
		campo('perfil').textContent = f.perfil;
		campo('faixa').innerHTML = 'Faixa ' + f.faixa + ' <small>' + FAIXA[f.faixa] + '</small>';
		campo('contato').textContent = f.contato;
		campo('canal').textContent = f.canal;
		campo('msg').textContent = f.msg;
		campo('decisao').innerHTML = f.dec + '<small>' + f.sub + '</small>';
		el.classList.toggle('fora', !!f.fora);
		if (posEl) posEl.innerHTML = FICHAS.map((_, j) => '<i' + (j === i ? ' class="on"' : '') + '></i>').join('');
	}
	function passo() {
		tmr = 0;
		if (!vis || (ctl && ctl.pausado())) return;
		if (etapa < lis.length) {
			if (etapa === 0) { el.classList.add('decidindo'); estEl.textContent = 'decidindo'; }
			lis[etapa].classList.add('on'); etapa++;
			tmr = window.setTimeout(passo, etapa === lis.length ? SEGURA : PASSO);
			if (etapa === lis.length) { el.classList.remove('decidindo'); estEl.textContent = 'decidido'; }
		} else if (etapa === lis.length) {
			lis.forEach(li => li.classList.remove('on')); etapa++;
			tmr = window.setTimeout(passo, APAGA);
		} else { preenche(sorteia()); etapa = 0; tmr = window.setTimeout(passo, 160); }
	}
	const anda = () => { if (!tmr) tmr = window.setTimeout(passo, 200); };
	const para = () => { if (tmr) clearTimeout(tmr); tmr = 0; };
	if (RM) {
		preenche(0); lis.forEach(li => li.classList.add('on')); estEl.textContent = 'decidido'; btn.hidden = true;
		return () => {};
	}
	ctl = botaoPausa(btn, 'a troca de clientes', RM, p => {
		if (p) { para(); lis.forEach(li => li.classList.add('on')); etapa = lis.length; el.classList.remove('decidindo'); estEl.textContent = 'decidido'; }
		else anda();
	});
	lis.forEach(li => li.classList.remove('on'));
	preenche(sorteia());
	const desliga = visivel(el, v => { vis = v; if (v) anda(); else para(); });
	return () => { para(); desliga(); ctl?.limpa(); };
}
