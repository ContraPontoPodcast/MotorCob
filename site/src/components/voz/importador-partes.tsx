// Partes da tela Gravações do discador (SQL 64): formulário da fonte e envio pelo site.
// A fonte é gravada por salvar_fonte_gravacoes (Admin com importar_gravacoes ou a equipe com gerenciar_troncos_voz).
// Credencial NUNCA é digitada aqui: a equipe gera a referência (trocar_credencial_fonte_gravacoes) e grava o valor
// direto no Secret Manager. No envio, o nome original dos arquivos não sai do navegador: o caminho no bucket é
// <slug>/<lote>/<n>.<ext> e vai só o sha-256 do nome, que casa com a coluna arquivo do manifesto.
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Download, FileAudio, FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { ADAPTADORES, baixarTexto } from '@/lib/voz';
import {
	BUCKET_ENVIO, FONTE_PADRAO, FORMAS, MODELO_MANIFESTO, TIPO_CONTEUDO, caminhoEnvio, conferirEnvio, dadosDaFonte, extensao,
	hashNome, validarFonte, type FonteDraft,
} from '@/lib/importador';
import { Aviso, Botao, Cartao, campoCls, campoStyle } from './ui';

export type Fonte = {
	id: number; nome: string; adaptador: string; forma: string; segredo_ref: string | null; host: string | null; porta: number;
	usuario: string | null; chave_host: string | null; pasta: string | null; url_lista: string | null; dominios_url: string[];
	leitura_automatica: boolean; intervalo_horas: number; so_transferencias: boolean; janela_par_s: number; dias_busca: number;
	transcrever: boolean; ativo: boolean; pedido_em: string | null; ultima_leitura_em: string | null;
};

export function erroRpc(e: unknown, padrao: string): string {
	const x = e as { code?: string; message?: string } | null;
	if (x?.code === 'P0001' && x.message) return x.message.charAt(0).toUpperCase() + x.message.slice(1) + '.';
	return padrao;
}

function draftDe(f: Fonte | null): FonteDraft {
	if (!f) return { ...FONTE_PADRAO };
	return {
		nome: f.nome, adaptador: f.adaptador, forma: (f.forma === 'api' ? 'url' : f.forma) as FonteDraft['forma'], host: f.host ?? '',
		porta: f.porta ?? 22, usuario: f.usuario ?? '', chave_host: f.chave_host ?? '', pasta: f.pasta ?? '/', url_lista: f.url_lista ?? '',
		dominios: (f.dominios_url ?? []).join(', '), leitura_automatica: f.leitura_automatica, intervalo_horas: f.intervalo_horas,
		so_transferencias: f.so_transferencias, janela_par_s: f.janela_par_s, dias_busca: f.dias_busca, ativo: f.ativo,
	};
}

function Campo({ rotulo, ajuda, children, largo }: { rotulo: string; ajuda?: string; children: ReactNode; largo?: boolean }) {
	return (
		<label className={`flex min-w-0 flex-col gap-1 text-[12.5px] ${largo ? 'sm:col-span-2' : ''}`}>
			<span className="font-semibold text-[var(--base-texto)]">{rotulo}</span>
			{children}
			{ajuda && <span className="text-[11.5px] text-[var(--base-texto-3)]">{ajuda}</span>}
		</label>
	);
}

function Marca({ marcado, onChange, children, disabled }: { marcado: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
	return (
		<label className="flex items-start gap-2 text-[13px] text-[var(--base-texto)]">
			<input type="checkbox" checked={marcado} disabled={disabled} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-[var(--destaque)]" />
			<span className="min-w-0">{children}</span>
		</label>
	);
}

/** Cadastro e edição de uma fonte (forma não muda depois de criada). */
export function FonteForm({ empresaId, fonte, onFechar, onSalvo }: { empresaId: string; fonte: Fonte | null; onFechar: () => void; onSalvo: () => void }) {
	const [d, setD] = useState<FonteDraft>(() => draftDe(fonte));
	const [salvando, setSalvando] = useState(false);
	const nova = !fonte;
	const erros = validarFonte(d);
	const set = (p: Partial<FonteDraft>) => setD(x => ({ ...x, ...p }));

	async function salvar() {
		if (!supabase || erros.length) return;
		setSalvando(true);
		const { error } = await supabase.rpc('salvar_fonte_gravacoes', { empresa: Number(empresaId), fonte: fonte?.id ?? null, dados: dadosDaFonte(d, nova) });
		setSalvando(false);
		if (error) { toast.error(erroRpc(error, 'Não foi possível salvar a fonte.')); return; }
		toast.success(nova && d.forma === 'sftp' ? 'Fonte salva. Ela fica pausada até a equipe MotorCX gravar a credencial no cofre.' : 'Fonte salva.');
		onSalvo();
	}

	return (
		<Cartao titulo={nova ? 'Nova fonte de gravações' : `Editar ${fonte?.nome}`} linha="Vale para esta empresa. A credencial nunca é digitada aqui: peça à equipe MotorCX pelo Suporte."
			direita={<button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg p-1.5 text-[var(--base-texto-3)] hover:bg-[var(--base-fill)]"><X size={16} /></button>}>
			{nova && (
				<div className="mb-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Forma">
					{FORMAS.map(f => (
						<button key={f.id} type="button" role="radio" aria-checked={d.forma === f.id} onClick={() => set({ forma: f.id })}
							className="flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left"
							style={{ borderColor: d.forma === f.id ? 'var(--destaque)' : 'var(--base-borda)', boxShadow: d.forma === f.id ? '0 0 0 1px var(--destaque)' : undefined, backgroundColor: 'var(--base-cartao)' }}>
							<b className="text-[13px] font-semibold text-[var(--base-texto)]">{f.nome}</b>
							<span className="text-[11.5px] leading-snug text-[var(--base-texto-2)]">{f.desc}</span>
						</button>
					))}
				</div>
			)}
			<div className="grid gap-3 sm:grid-cols-2">
				<Campo rotulo="Nome da fonte"><input className={campoCls} style={campoStyle} value={d.nome} maxLength={60} onChange={e => set({ nome: e.target.value })} placeholder="Ex.: Discador da carteira cartão" /></Campo>
				<Campo rotulo="Discador">
					<select className={campoCls} style={campoStyle} value={d.adaptador} onChange={e => set({ adaptador: e.target.value })}>
						{ADAPTADORES.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
					</select>
				</Campo>
				{d.forma === 'sftp' && <>
					<Campo rotulo="Servidor SFTP"><input className={campoCls} style={campoStyle} value={d.host} onChange={e => set({ host: e.target.value })} placeholder="sftp.discador.com.br" autoComplete="off" /></Campo>
					<Campo rotulo="Porta"><input className={campoCls} style={campoStyle} inputMode="numeric" value={d.porta} onChange={e => set({ porta: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Campo>
					<Campo rotulo="Usuário" ajuda="A senha ou a chave privada vai para o cofre pela equipe MotorCX."><input className={campoCls} style={campoStyle} value={d.usuario} onChange={e => set({ usuario: e.target.value })} autoComplete="off" /></Campo>
					<Campo rotulo="Pasta" ajuda="O MotorCX lê esta pasta e as subpastas de 1 nível."><input className={campoCls} style={campoStyle} value={d.pasta} onChange={e => set({ pasta: e.target.value })} placeholder="/gravacoes" /></Campo>
					<Campo rotulo="Chave pública do servidor" ajuda="A linha que o ssh-keyscan devolve (ex.: ssh-ed25519 AAAA…). Servidor com outra chave é recusado." largo>
						<textarea className={`${campoCls} h-16 py-2 font-mono text-[12px]`} style={campoStyle} value={d.chave_host} onChange={e => set({ chave_host: e.target.value })} spellCheck={false} />
					</Campo>
				</>}
				{d.forma === 'url' && <>
					<Campo rotulo="URL da lista de gravações" ajuda="Devolve o manifesto em JSON ou CSV, com a URL de cada áudio. Só HTTPS." largo><input className={campoCls} style={campoStyle} value={d.url_lista} onChange={e => set({ url_lista: e.target.value })} placeholder="https://api.discador.com.br/gravacoes" /></Campo>
					<Campo rotulo="Domínios autorizados para os áudios" ajuda="Separados por vírgula. O domínio da URL da lista entra sozinho." largo><input className={campoCls} style={campoStyle} value={d.dominios} onChange={e => set({ dominios: e.target.value })} placeholder="gravacoes.discador.com.br" /></Campo>
				</>}
			</div>
			<div className="mt-4 grid gap-3 sm:grid-cols-2">
				{d.forma !== 'arquivo' && (
					<div className="space-y-2">
						<Marca marcado={d.leitura_automatica} onChange={v => set({ leitura_automatica: v })}>Leitura automática <small className="block text-[11.5px] text-[var(--base-texto-2)]">Desligada, só lê quando vocês pedem "Ler agora".</small></Marca>
						{d.leitura_automatica && <Campo rotulo="A cada (horas)"><input className={campoCls} style={campoStyle} inputMode="numeric" value={d.intervalo_horas} onChange={e => set({ intervalo_horas: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Campo>}
						{d.forma === 'sftp' && <Campo rotulo="Manifestos dos últimos (dias)"><input className={campoCls} style={campoStyle} inputMode="numeric" value={d.dias_busca} onChange={e => set({ dias_busca: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Campo>}
					</div>
				)}
				<div className="space-y-2">
					<Marca marcado={d.so_transferencias} onChange={v => set({ so_transferencias: v })}>Só ligações transferidas pelo agente de IA <small className="block text-[11.5px] text-[var(--base-texto-2)]">Desmarcado, a gravação sem transferência entra avulsa (precisa do id_cliente) e não vai para a análise.</small></Marca>
					<Campo rotulo="Janela para casar com a transferência (segundos)" ajuda="Usada quando o discador não devolve o X-MotorCX-Id-Chamada."><input className={campoCls} style={campoStyle} inputMode="numeric" value={d.janela_par_s} onChange={e => set({ janela_par_s: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Campo>
					{!nova && <Marca marcado={d.ativo} onChange={v => set({ ativo: v })}>Fonte ativa</Marca>}
				</div>
			</div>
			{erros.length > 0 && <div className="mt-3"><Aviso tom="atencao">{erros.join(' ')}</Aviso></div>}
			<div className="mt-4 flex flex-wrap gap-2">
				<Botao onClick={() => void salvar()} disabled={salvando || erros.length > 0}>{salvando ? 'Salvando…' : 'Salvar fonte'}</Botao>
				<Botao secundario onClick={onFechar}>Cancelar</Botao>
			</div>
		</Cartao>
	);
}

/** Envio pelo site: manifesto + áudios, ou um zip com tudo. */
export function EnvioGravacoes({ empresaId, slug, onEnviado }: { empresaId: string; slug: string; onEnviado: () => void }) {
	const [arquivos, setArquivos] = useState<File[]>([]);
	const [enviando, setEnviando] = useState<{ feitos: number; total: number } | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const { itens, erros } = conferirEnvio(arquivos.map(a => ({ name: a.name, size: a.size })));

	function escolher(e: ChangeEvent<HTMLInputElement>) {
		const novos = Array.from(e.target.files ?? []);
		setArquivos(a => [...a, ...novos]);
		e.target.value = '';
	}

	async function enviar() {
		if (!supabase || erros.length || !arquivos.length) return;
		const sb = supabase;
		const lote = crypto.randomUUID();
		setEnviando({ feitos: 0, total: arquivos.length });
		const registro: { caminho: string; nome_hash: string; tamanho: number }[] = [];
		try {
			for (let i = 0; i < arquivos.length; i++) {
				const f = arquivos[i];
				const caminho = caminhoEnvio(slug, lote, i + 1, f.name);
				const { error } = await sb.storage.from(BUCKET_ENVIO).upload(caminho, f, { contentType: TIPO_CONTEUDO[extensao(f.name)] ?? 'application/octet-stream', upsert: false });
				if (error) throw error;
				registro.push({ caminho, nome_hash: await hashNome(f.name), tamanho: f.size });
				setEnviando({ feitos: i + 1, total: arquivos.length });
			}
			const { error } = await sb.rpc('registrar_envio_gravacoes', { empresa: Number(empresaId), arquivos: registro });
			if (error) throw error;
			toast.success('Gravações enviadas. O MotorCX lê em até 15 minutos; o resultado aparece no registro abaixo.');
			setArquivos([]);
			onEnviado();
		} catch (e) {
			toast.error(erroRpc(e, 'Não foi possível enviar. Confira os arquivos e tente de novo.'));
		} finally {
			setEnviando(null);
		}
	}

	return (
		<Cartao titulo="Enviar gravações" linha="O manifesto (CSV ou JSON) e os áudios, ou um zip com tudo. Até 200 MB por arquivo. O nome dos arquivos não sai do seu navegador."
			direita={<Botao secundario onClick={() => baixarTexto('modelo-manifesto-gravacoes.csv', MODELO_MANIFESTO)}><Download size={14} /> Modelo do manifesto</Botao>}>
			<input ref={input} type="file" multiple accept=".csv,.json,.zip,.wav,.mp3,.ogg,.opus,.flac,.m4a" className="sr-only" onChange={escolher} aria-label="Escolher arquivos" />
			<button type="button" onClick={() => input.current?.click()} disabled={!!enviando}
				className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-[var(--base-texto-2)] hover:bg-[var(--base-fill)]"
				style={{ borderColor: 'var(--base-borda)' }}>
				<UploadCloud size={22} aria-hidden />
				<b className="font-semibold text-[var(--base-texto)]">Escolher arquivos</b>
				<span>Colunas: id_chamada, inicio, duracao_s, arquivo, operador_ref, id_cliente, id_acao, carteira, id_chamada_motorcx</span>
			</button>
			{itens.length > 0 && (
				<ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
					{itens.map((it, i) => (
						<li key={`${it.nome}-${i}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-[var(--base-fill)] px-2.5 py-1.5 text-[12.5px]">
							{it.tipo === 'audio' ? <FileAudio size={14} className="shrink-0 text-[var(--base-texto-3)]" /> : <FileSpreadsheet size={14} className="shrink-0 text-[var(--base-texto-3)]" />}
							<span className="min-w-0 flex-1 truncate text-[var(--base-texto)]" title={it.nome}>{it.nome}</span>
							{it.erro ? <span className="shrink-0 text-[11.5px] text-[var(--estado-erro-texto)]">{it.erro}</span> : <span className="shrink-0 tnum text-[11.5px] text-[var(--base-texto-3)]">{(it.tamanho / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>}
							<button type="button" disabled={!!enviando} onClick={() => setArquivos(a => a.filter((_, j) => j !== i))} aria-label={`Tirar ${it.nome}`} className="shrink-0 rounded p-0.5 text-[var(--base-texto-3)] hover:text-[var(--base-texto)]"><X size={13} /></button>
						</li>
					))}
				</ul>
			)}
			{arquivos.length > 0 && erros.length > 0 && <div className="mt-3"><Aviso tom="atencao">{erros.join(' ')}</Aviso></div>}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Botao onClick={() => void enviar()} disabled={!!enviando || !arquivos.length || erros.length > 0}>{enviando ? `Enviando ${enviando.feitos} de ${enviando.total}…` : 'Enviar'}</Botao>
				<span className="text-[12px] text-[var(--base-texto-3)]">CPF, nome, telefone ou e-mail no manifesto: a linha (ou a coluna inteira) é recusada.</span>
			</div>
		</Cartao>
	);
}
