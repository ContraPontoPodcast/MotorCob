// Roleplay › Cadastro para treino: equipes e quem recebe treinos. O operador não tem login no MotorCX: é uma linha de
// voz_operadores com apelido, equipe e, se quiser, o ID do discador (sem ele, "só treino": a evolução não cruza com as
// ligações reais). Grava só por salvar_equipe_treino / salvar_operador_treino (SQL 90). Filtros na URL (?eq=, ?inativos=1)
// e a gaveta aberta também (?painel=novo | editar-<id> | equipes): o ⟵ do navegador e o Esc fecham a gaveta.
// LGPD: nada de CPF, e-mail, telefone ou nome completo (a mesma regra do banco, em lib/roleplay.ts).
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { usePermissao } from '@/components/app-shell';
import { Aviso, Botao, Estado, Gaveta, Modal, Pilula, Rotulo, Tabela, campoCls, campoStyle } from '@/components/ds';
import { supabase } from '@/lib/supabase';
import { PERM_SA, dataBR } from '@/lib/speech';
import {
	estadoLink, noCadastro, rotaPessoaRP, validarApelido, validarIdDiscador, validarNomeEquipe,
	type EquipeRP, type LinkRP, type OperadorRP,
} from '@/lib/roleplay';
import { MolduraRP } from './moldura';
import { SeloLgpdTreino } from './comum';
import { lerEquipes, lerLinks, lerOperadores, salvarCadastro, salvarEquipe } from './dados';
import type { PodeRP } from './index';

/** Gaveta do cadastro na URL (entra no histórico: o ⟵ fecha). */
export function usePainelUrl() {
	const [q, setQ] = useSearchParams();
	const navegar = useNavigate();
	const loc = useLocation();
	const painel = q.get('painel');
	const abrir = (v: string) => setQ(p => { const n = new URLSearchParams(p); n.set('painel', v); return n; }, { state: { painel: true }, preventScrollReset: true });
	const fechar = () => {
		if ((loc.state as { painel?: boolean } | null)?.painel) navegar(-1);
		else setQ(p => { const n = new URLSearchParams(p); n.delete('painel'); return n; }, { replace: true, preventScrollReset: true });
	};
	return { painel, abrir, fechar };
}

export function Cadastro({ empresa, pode }: { empresa: number; pode: PodeRP }) {
	const verOperadores = usePermissao(PERM_SA.verOperadores);
	const [q, setQ] = useSearchParams();
	const { painel, abrir, fechar } = usePainelUrl();
	const [ops, setOps] = useState<OperadorRP[] | null>(null);
	const [equipes, setEquipes] = useState<EquipeRP[]>([]);
	const [links, setLinks] = useState<LinkRP[]>([]);
	const [erro, setErro] = useState('');
	const [versao, setVersao] = useState(0);
	const podeLer = pode.treinar && verOperadores;

	useEffect(() => {
		if (!supabase || !podeLer) return;
		let ativo = true;
		setErro('');
		Promise.all([lerOperadores(supabase, empresa), lerEquipes(supabase, empresa), lerLinks(supabase, empresa)])
			.then(([o, e, l]) => { if (ativo) { setOps(o); setEquipes(e); setLinks(l); } })
			.catch(e => { if (ativo) setErro(e instanceof Error ? e.message : 'Não deu para carregar.'); });
		return () => { ativo = false; };
	}, [empresa, podeLer, versao]);

	const filtroEq = q.get('eq') ?? '';
	const inativos = q.get('inativos') === '1';
	const filtro = (k: string, v: string) => setQ(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true, preventScrollReset: true });
	const editando = painel?.startsWith('editar-') ? ops?.find(o => String(o.id) === painel.slice(7)) ?? null : null;
	const candidatos = useMemo(() => (ops ?? []).filter(o => !noCadastro(o) && o.ativo && o.operador_ref), [ops]);

	async function salvar(x: DadosForm) {
		if (!supabase) return;
		await salvarCadastro(supabase, empresa, x);
		toast.success(x.operador ? 'Cadastro salvo.' : `${x.apelido.trim()} entrou no Cadastro para treino.`);
		setVersao(v => v + 1);
		fechar();
	}
	async function salvarEq(nome: string, id?: number, ativo = true) {
		if (!supabase) return;
		await salvarEquipe(supabase, empresa, nome, id ?? null, ativo);
		toast.success(id ? 'Equipe salva.' : 'Equipe criada.');
		setVersao(v => v + 1);
	}

	const acoes = <><SeloLgpdTreino />{podeLer && ops && <><Botao tipo="secundario" onClick={() => abrir('equipes')}>Equipes</Botao><Botao onClick={() => abrir('novo')}>Adicionar operador</Botao></>}</>;
	return (
		<MolduraRP titulo="Cadastro para treino" descricao="Quem recebe treinos. O operador não tem login no MotorCX." acoes={acoes}>
			{!pode.treinar
				? <Estado tipo="semPermissao" titulo="Seu perfil não cuida do cadastro para treino.">Quem tem a permissão de treinar operadores cadastra as equipes e as pessoas. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado>
				: !verOperadores
				? <Estado tipo="semPermissao" titulo="O cadastro usa a lista de operadores da empresa.">Para ver e editar o cadastro, o perfil precisa também da permissão Ver operadores. Quem libera é o Admin, em Empresa › Pessoas e perfis.</Estado>
				: erro ? <Estado tipo="erro" titulo="Não deu para carregar o cadastro agora.">{erro}</Estado>
				: !ops ? <Estado tipo="carregando" />
				: <ListaCadastro ops={ops} equipes={equipes} links={links} filtroEq={filtroEq} inativos={inativos} onFiltro={filtro}
					onEditar={o => abrir(`editar-${o.id}`)} onNovo={() => abrir('novo')} />}

			{podeLer && ops && (
				<>
					<Gaveta aberta={painel === 'novo' || !!editando} onFechar={fechar} titulo={editando ? `Editar ${editando.apelido}` : 'Adicionar operador'}
						subtitulo="Primeiro nome e inicial. Sem CPF, e-mail ou telefone.">
						<FormOperador key={editando?.id ?? 'novo'} inicial={editando} equipes={equipes} candidatos={editando ? [] : candidatos} onSalvar={salvar} onCancelar={fechar} />
					</Gaveta>
					<Gaveta aberta={painel === 'equipes'} onFechar={fechar} titulo="Equipes" subtitulo="Só o nome da equipe. Desativar tira a equipe da lista de novos cadastros.">
						<GerirEquipes equipes={equipes} ops={ops} onSalvar={salvarEq} />
					</Gaveta>
				</>
			)}
		</MolduraRP>
	);
}

export function ListaCadastro({ ops, equipes, links, filtroEq, inativos, onFiltro, onEditar, onNovo, agora }: {
	ops: OperadorRP[]; equipes: EquipeRP[]; links: LinkRP[]; filtroEq: string; inativos: boolean;
	onFiltro: (k: string, v: string) => void; onEditar: (o: OperadorRP) => void; onNovo: () => void; agora?: Date;
}) {
	const nomeEq = (id: number | null) => equipes.find(e => e.id === id)?.nome ?? 'Sem equipe';
	const doCadastro = ops.filter(noCadastro);
	const vis = doCadastro
		.filter(o => inativos || o.ativo)
		.filter(o => !filtroEq || String(o.equipe_id ?? '') === filtroEq)
		.sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR'));
	const link = (o: OperadorRP) => {
		const l = estadoLink(links, o.id, agora);
		return l.estado === 'ativo' ? <Pilula tom="ok" title={l.ate ? `Válido até ${dataBR(l.ate)}` : undefined}>Ativo</Pilula> : l.estado === 'expirado' ? <Pilula tom="atencao">Expirado</Pilula> : <Pilula>Sem link</Pilula>;
	};
	const nome = (o: OperadorRP) => <span className="inline-flex flex-wrap items-center gap-1.5"><Link to={rotaPessoaRP(o.id)} className="font-semibold hover:underline">{o.apelido}</Link>{!o.ativo && <Pilula>Desativado</Pilula>}</span>;
	const editar = (o: OperadorRP) => <Botao tipo="fantasma" pequeno onClick={() => onEditar(o)}>Editar<span className="sr-only"> {o.apelido}</span></Botao>;
	return (
		<div className="space-y-4">
			<Aviso tom="info">O operador vai treinar pelo <b>link pessoal de treino</b>, que abre só os treinos dele e mais nada. O <b>ID do discador</b> é opcional: com ele, a evolução compara o treino com as ligações reais.</Aviso>
			{doCadastro.length === 0 ? (
				<Estado tipo="vazio" titulo="Ninguém no cadastro ainda." acoes={<Botao onClick={onNovo}>Adicionar operador</Botao>}>
					Cadastre quem vai treinar: apelido, equipe e, se quiser, o ID do discador. Quem já aparece em Speech › Operadores pode ser trazido daqui.
				</Estado>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<select aria-label="Equipe" value={filtroEq} onChange={e => onFiltro('eq', e.target.value)} className={campoCls} style={campoStyle}>
							<option value="">Todas as equipes</option>
							{equipes.map(e => <option key={e.id} value={String(e.id)}>{e.nome}{e.ativo ? '' : ' (desativada)'}</option>)}
						</select>
						<label className="inline-flex items-center gap-1.5 text-[13px] text-[var(--base-texto-2)]">
							<input type="checkbox" checked={inativos} onChange={e => onFiltro('inativos', e.target.checked ? '1' : '')} /> Mostrar desativados
						</label>
						<span className="ml-auto text-[12.5px] text-[var(--base-texto-3)]" aria-live="polite">{vis.length} {vis.length === 1 ? 'pessoa' : 'pessoas'}</span>
					</div>
					<Tabela<OperadorRP> rotulo="Cadastro para treino" linhas={vis} chave={o => o.id} vazio="Ninguém nesta equipe."
						colunas={[
							{ id: 'op', titulo: 'Operador', celula: nome },
							{ id: 'eq', titulo: 'Equipe', celula: o => nomeEq(o.equipe_id) },
							{ id: 'ref', titulo: 'ID do discador', celula: o => o.operador_ref ?? <span className="text-[var(--base-texto-3)]">Só treino</span> },
							{ id: 'link', titulo: 'Link de treino', celula: link },
							{ id: 'acoes', titulo: <span className="sr-only">Ações</span>, celula: editar },
						]}
						celular={o => ({ titulo: nome(o), valor: link(o), resumo: <span className="inline-flex flex-wrap items-center gap-2">{nomeEq(o.equipe_id)} · {o.operador_ref ?? 'só treino'} {editar(o)}</span> })} />
				</>
			)}
		</div>
	);
}

export type DadosForm = { apelido: string; equipe: number | null; novaEquipe: string; operador_ref: string | null; operador: number | null; ativo: boolean };

export function FormOperador({ inicial, equipes, candidatos, onSalvar, onCancelar }: {
	inicial: OperadorRP | null; equipes: EquipeRP[]; candidatos: OperadorRP[];
	onSalvar: (x: DadosForm) => Promise<void>; onCancelar: () => void;
}) {
	const ativas = equipes.filter(e => e.ativo || e.id === inicial?.equipe_id);
	const [trazer, setTrazer] = useState('');
	const [apelido, setApelido] = useState(inicial?.apelido ?? '');
	const [equipe, setEquipe] = useState<string>(inicial?.equipe_id != null ? String(inicial.equipe_id) : ativas.length ? '' : 'nova');
	const [novaEquipe, setNovaEquipe] = useState('');
	const [ref, setRef] = useState(inicial?.operador_ref ?? '');
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [desativar, setDesativar] = useState(false);
	const refFixo = !!inicial?.operador_ref || !!trazer;

	function escolherTrazer(id: string) {
		setTrazer(id);
		const o = candidatos.find(x => String(x.id) === id);
		if (o) { setApelido(o.apelido); setRef(o.operador_ref ?? ''); } else { setRef(''); }
	}
	function validar(): string {
		return validarApelido(apelido)
			|| (equipe === '' ? 'Escolha a equipe.' : equipe === 'nova' ? validarNomeEquipe(novaEquipe) : '')
			|| validarIdDiscador(ref);
	}
	async function enviar(ativo: boolean) {
		const e = validar();
		setErro(e);
		if (e) return;
		setOcupado(true);
		try {
			await onSalvar({ apelido, equipe: equipe && equipe !== 'nova' ? Number(equipe) : null, novaEquipe: equipe === 'nova' ? novaEquipe : '', operador_ref: ref.trim() || null, operador: inicial?.id ?? null, ativo });
		} catch (x) {
			setErro(x instanceof Error ? x.message : 'Não deu para salvar.');
		} finally { setOcupado(false); setDesativar(false); }
	}

	return (
		<form className="space-y-4" onSubmit={e => { e.preventDefault(); void enviar(inicial?.ativo ?? true); }} noValidate>
			{candidatos.length > 0 && (
				<Rotulo texto="Trazer de Speech › Operadores (opcional)" dica="Quem já aparece com ID e apelido do discador. O mesmo ID vira o mesmo cadastro.">
					<select value={trazer} onChange={e => escolherTrazer(e.target.value)} className={campoCls} style={campoStyle}>
						<option value="">Cadastrar uma pessoa nova</option>
						{candidatos.map(o => <option key={o.id} value={String(o.id)}>{o.apelido} · {o.operador_ref}</option>)}
					</select>
				</Rotulo>
			)}
			<Rotulo texto="Apelido" dica="Primeiro nome e inicial, como a equipe chama a pessoa. Ex.: Nina P.">
				<input value={apelido} onChange={e => setApelido(e.target.value)} maxLength={30} autoComplete="off" className={campoCls} style={campoStyle} />
			</Rotulo>
			<Rotulo texto="Equipe">
				<select value={equipe} onChange={e => setEquipe(e.target.value)} className={campoCls} style={campoStyle}>
					{ativas.length > 0 && <option value="" disabled>Escolha a equipe</option>}
					{ativas.map(e => <option key={e.id} value={String(e.id)}>{e.nome}{e.ativo ? '' : ' (desativada)'}</option>)}
					<option value="nova">+ Nova equipe…</option>
				</select>
			</Rotulo>
			{equipe === 'nova' && (
				<Rotulo texto="Nome da nova equipe" dica="Ex.: Equipe Manhã, Acordos.">
					<input value={novaEquipe} onChange={e => setNovaEquipe(e.target.value)} maxLength={40} autoComplete="off" className={campoCls} style={campoStyle} />
				</Rotulo>
			)}
			<Rotulo texto="ID do discador (opcional)" dica={inicial?.operador_ref ? 'O ID do discador não muda por aqui: é ele que liga o treino às ligações reais.' : 'O mesmo de Speech › Operadores. Sem ele, a pessoa fica só no treino.'}>
				<input value={ref} onChange={e => setRef(e.target.value)} readOnly={refFixo} maxLength={40} autoComplete="off" placeholder="Ex.: OP-130" className={campoCls} style={campoStyle} />
			</Rotulo>
			{erro && <p role="alert" className="text-[13px] font-medium text-[var(--estado-erro-texto)]">{erro}</p>}
			<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--base-borda)' }}>
				<span>
					{inicial && (inicial.ativo
						? <Botao tipo="perigo" pequeno onClick={() => setDesativar(true)} disabled={ocupado}>Desativar</Botao>
						: <Botao tipo="secundario" pequeno onClick={() => void enviar(true)} disabled={ocupado}>Reativar</Botao>)}
				</span>
				<span className="flex gap-2">
					<Botao tipo="secundario" onClick={onCancelar} disabled={ocupado}>Cancelar</Botao>
					<Botao type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : inicial ? 'Salvar' : 'Adicionar'}</Botao>
				</span>
			</div>
			{desativar && inicial && (
				<Modal titulo={`Desativar ${inicial.apelido}?`} texto="A pessoa sai das listas de treino e o link de treino dela para de abrir. Os treinos e as sessões que já fez continuam guardados."
					confirmar="Desativar" perigo ocupado={ocupado} onConfirmar={() => void enviar(false)} onFechar={() => setDesativar(false)} />
			)}
		</form>
	);
}

export function GerirEquipes({ equipes, ops, onSalvar }: { equipes: EquipeRP[]; ops: OperadorRP[]; onSalvar: (nome: string, id?: number, ativo?: boolean) => Promise<void> }) {
	const [nova, setNova] = useState('');
	const [erro, setErro] = useState('');
	const [ocupado, setOcupado] = useState(false);
	const [nomes, setNomes] = useState<Record<number, string>>({});
	async function rodar(f: () => Promise<void>) {
		setOcupado(true); setErro('');
		try { await f(); } catch (x) { setErro(x instanceof Error ? x.message : 'Não deu para salvar.'); } finally { setOcupado(false); }
	}
	const criar = () => { const e = validarNomeEquipe(nova); if (e) { setErro(e); return; } void rodar(async () => { await onSalvar(nova); setNova(''); }); };
	return (
		<div className="space-y-4">
			<form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); criar(); }} noValidate>
				<Rotulo texto="Nova equipe" className="min-w-[200px] flex-1"><input value={nova} onChange={e => setNova(e.target.value)} maxLength={40} autoComplete="off" className={campoCls} style={campoStyle} /></Rotulo>
				<Botao type="submit" disabled={ocupado}>Criar</Botao>
			</form>
			{erro && <p role="alert" className="text-[13px] font-medium text-[var(--estado-erro-texto)]">{erro}</p>}
			{equipes.length === 0 ? <p className="text-[13px] text-[var(--base-texto-2)]">Nenhuma equipe ainda.</p> : (
				<ul className="space-y-2">
					{equipes.map(e => {
						const n = ops.filter(o => o.equipe_id === e.id && o.ativo).length;
						const v = nomes[e.id] ?? e.nome;
						return (
							<li key={e.id} className="rounded-xl bg-[var(--base-fill)] px-3 py-2.5">
								<div className="flex flex-wrap items-center gap-2">
									<input aria-label={`Nome da equipe ${e.nome}`} value={v} onChange={x => setNomes(m => ({ ...m, [e.id]: x.target.value }))} maxLength={40} className={`${campoCls} min-w-[160px] flex-1`} style={campoStyle} />
									{v.trim() !== e.nome && <Botao pequeno disabled={ocupado} onClick={() => { const er = validarNomeEquipe(v); if (er) { setErro(er); return; } void rodar(() => onSalvar(v, e.id, e.ativo)); }}>Salvar</Botao>}
									<Botao tipo="fantasma" pequeno disabled={ocupado} onClick={() => void rodar(() => onSalvar(e.nome, e.id, !e.ativo))}>{e.ativo ? 'Desativar' : 'Reativar'}</Botao>
								</div>
								<p className="mt-1 text-[12px] text-[var(--base-texto-3)]">{n} {n === 1 ? 'pessoa ativa' : 'pessoas ativas'}{e.ativo ? '' : ' · desativada'}</p>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
