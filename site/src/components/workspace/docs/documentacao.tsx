import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router';
import { useMotorAuth } from '@/components/auth-provider';
import { PERM } from '@/lib/permissoes';

const API_URL = 'https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api';

const INDICE = [
	{ id: 'visao-geral', label: 'Visão geral' },
	{ id: 'autenticacao', label: 'Autenticação' },
	{ id: 'escopos', label: 'Escopos' },
	{ id: 'enviar-carga', label: 'Enviar carga' },
	{ id: 'acompanhar', label: 'Acompanhar' },
	{ id: 'lista-do-dia', label: 'Lista do dia' },
	{ id: 'erros', label: 'Erros' },
	{ id: 'boas-praticas', label: 'Boas práticas' },
];

const ESCOPOS = [
	{ id: 'cargas:enviar', endpoint: 'POST /v1/cargas' },
	{ id: 'cargas:status', endpoint: 'GET /v1/cargas/{id}' },
	{ id: 'lista:ler', endpoint: 'GET /v1/lista-do-dia' },
];

const ERROS = [
	{ code: '400', desc: 'Parâmetro faltando ou inválido.' },
	{ code: '401', desc: 'Sem token, token inválido, revogado ou vencido.' },
	{ code: '403', desc: 'Sem o escopo, credor fora do token, acesso à API não liberado ou empresa suspensa.' },
	{ code: '404', desc: 'Rota, credor, envio ou lista não encontrados.' },
	{ code: '409', desc: 'Credor configurado para carga por arquivo.' },
	{ code: '413', desc: 'Arquivo acima de 20 MB.' },
	{ code: '429', desc: 'Mais de 60 chamadas no minuto.' },
	{ code: '500', desc: 'Falha nossa, tente de novo.' },
];

function CodeBlock({ code }: { code: string }) {
	const [ok, setOk] = useState(false);
	async function copy() {
		try { await navigator.clipboard.writeText(code); setOk(true); setTimeout(() => setOk(false), 1800); }
		catch { /* ignora */ }
	}
	return (
		<div className="relative mt-3">
			<button onClick={copy} className="absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-2.5 text-[12px] font-medium text-[#1D1D1F] hover:bg-[#EEEEF0]" style={{ boxShadow: '0 0 0 1px #E5E5EA' }}>
				{ok ? <Check size={13} className="text-[#248A3D]" /> : <Copy size={13} />} {ok ? 'Copiado' : 'Copiar'}
			</button>
			<pre className="overflow-x-auto rounded-xl bg-[#F5F5F7] p-4 pr-20 text-[13px] leading-relaxed"><code className="font-mono text-[#1D1D1F]">{code}</code></pre>
		</div>
	);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<section id={id} className="mt-10 scroll-mt-20">
			<h2 className="text-[22px] font-semibold tracking-tight text-[#1D1D1F]">{title}</h2>
			<div className="mt-3 space-y-3 text-[17px] leading-[1.6] text-[#1D1D1F]">{children}</div>
		</section>
	);
}

function InlineCode({ children }: { children: ReactNode }) {
	return <code className="rounded bg-[#F5F5F7] px-1.5 py-0.5 font-mono text-[13px] text-[#1D1D1F]">{children}</code>;
}

export function DocumentacaoPage() {
	const { permissoes } = useMotorAuth();
	const podeGerenciarApi = permissoes.includes(PERM.gerenciarApi);

	return (
		<div className="mx-auto max-w-[1280px] px-4 py-8 sm:py-10">
			<h1 className="text-[34px] font-semibold tracking-tight text-[#1D1D1F]">Documentação</h1>
			<p className="mt-2 text-[17px] text-[#6E6E73]">Integre o seu sistema pela API do MotorCX.</p>

			<div className="mt-8 flex flex-col gap-8 min-[1440px]:flex-row">
				{/* Índice */}
				<nav className="min-[1440px]:sticky min-[1440px]:top-20 min-[1440px]:self-start min-[1440px]:w-[200px]">
					<ul className="flex flex-wrap gap-1 min-[1440px]:flex-col">
						{INDICE.map(item => (
							<li key={item.id}>
								<a href={`#${item.id}`} className="inline-block rounded-lg px-3 py-1.5 text-[14px] text-[#6E6E73] hover:bg-[#F5F5F7] hover:text-[#1D1D1F]">{item.label}</a>
							</li>
						))}
					</ul>
				</nav>

				{/* Conteúdo */}
				<div className="min-w-0 flex-1 max-w-[820px]">
					<Section id="visao-geral" title="Visão geral">
						<p>API das cargas (v1). O seu sistema envia a carteira ao MotorCX e lê a Lista do dia, sem passar pelo site.</p>
						<div>
							<p className="text-[14px] font-semibold text-[#6E6E73]">Endereço</p>
							<CodeBlock code={API_URL} />
						</div>
						<p className="text-[15px] text-[#6E6E73]">O acesso à API é liberado pela equipe MotorCX para a sua empresa.</p>
					</Section>

					<Section id="autenticacao" title="Autenticação">
						<p>Toda requisição leva o cabeçalho <InlineCode>Authorization: Bearer mc_...</InlineCode> com um token criado em {podeGerenciarApi ? <Link to="/empresa/integracoes" className="font-medium text-[#0A60D0] hover:underline">Empresa › Integrações</Link> : <span className="text-[#1D1D1F]">Empresa › Integrações</span>}.</p>
						<CodeBlock code={`Authorization: Bearer mc_...`} />
						<p className="text-[15px] text-[#6E6E73]">O token aparece uma vez só. Guarde num cofre de segredos, nunca no código.</p>
						<p>Limite: 60 chamadas por minuto por token (acima: <InlineCode>429</InlineCode> com <InlineCode>Retry-After: 60</InlineCode>).</p>
						<p>O credor é sempre o código que aparece em Credores (ex.: <InlineCode>banco-x</InlineCode>) e precisa estar com “Como a carga chega” = API.</p>
					</Section>

					<Section id="escopos" title="Escopos">
						<div className="overflow-x-auto">
							<table className="w-full min-w-[420px] text-left text-[14px]">
								<thead>
									<tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
										<th className="pb-2 pr-4 font-medium">Escopo</th>
										<th className="pb-2 font-medium">Endpoint</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[#F0F0F2]">
									{ESCOPOS.map(e => (
										<tr key={e.id}>
											<td className="py-2.5 pr-4 font-mono text-[13px] text-[#6E6E73]">{e.id}</td>
											<td className="py-2.5 font-mono text-[13px] text-[#1D1D1F]">{e.endpoint}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<p className="text-[15px] text-[#6E6E73]">O token pode ser limitado a alguns credores e vence em até 365 dias.</p>
					</Section>

					<Section id="enviar-carga" title="Enviar carga">
						<p className="font-mono text-[15px] text-[#1D1D1F]">POST /v1/cargas</p>
						<p>Parâmetros na URL: <InlineCode>credor</InlineCode>, <InlineCode>tipo</InlineCode> (geral, incremental, retirada, acordo, baixa ou ocorrencia) e <InlineCode>nome</InlineCode> (.csv, .txt ou .xlsx). O corpo é o arquivo, no mesmo layout já mapeado no site. Até 20 MB.</p>
						<CodeBlock code={`curl -X POST "$API/v1/cargas?credor=banco-x&tipo=incremental&nome=incremental.csv" \\
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/csv" --data-binary @incremental.csv`} />
						<p className="text-[15px] text-[#6E6E73]">Resposta <InlineCode>202</InlineCode>:</p>
						<CodeBlock code={`{
  "envio_id": 1234,
  "situacao": "pendente",
  "acompanhar": "/v1/cargas/1234"
}`} />
					</Section>

					<Section id="acompanhar" title="Acompanhar">
						<p className="font-mono text-[15px] text-[#1D1D1F]">GET /v1/cargas/{'{id}'}</p>
						<p>Resposta:</p>
						<CodeBlock code={`{
  "id": 1234,
  "tipo": "incremental",
  "situacao": "processado",
  "relatorio": { "linhas": 5000, "aceitas": 4987, "rejeitadas": 13 }
}`} />
						<p className="text-[15px] text-[#6E6E73]"><InlineCode>situacao</InlineCode>: pendente (na fila) · aguardando (layout novo, aguardando mapeamento no site) · processado · erro (motivo em <InlineCode>relatorio.erro</InlineCode>). Costuma processar em até 1 minuto.</p>
					</Section>

					<Section id="lista-do-dia" title="Lista do dia">
						<p className="font-mono text-[15px] text-[#1D1D1F]">GET /v1/lista-do-dia</p>
						<p>Parâmetros: <InlineCode>credor</InlineCode>, <InlineCode>canal</InlineCode> (whatsapp, rcs, sms, email, agente_voz, discador) e <InlineCode>data</InlineCode> (AAAA-MM-DD; padrão: hoje em São Paulo). Devolve o mesmo CSV que o site baixa. <InlineCode>404</InlineCode> se a lista ainda não foi gerada.</p>
						<CodeBlock code={`curl "$API/v1/lista-do-dia?credor=banco-x&canal=sms" -H "Authorization: Bearer $TOKEN" -o sms.csv`} />
						<p className="text-[15px] text-[#6E6E73]">Cada download fica registrado em Acessos, com o prefixo do token.</p>
					</Section>

					<Section id="erros" title="Erros">
						<p>Sempre JSON <InlineCode>{'{ "erro": "texto em português" }'}</InlineCode>.</p>
						<div className="overflow-x-auto">
							<table className="w-full min-w-[420px] text-left text-[14px]">
								<thead>
									<tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]">
										<th className="pb-2 pr-4 font-medium">Código</th>
										<th className="pb-2 font-medium">Significado</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[#F0F0F2]">
									{ERROS.map(e => (
										<tr key={e.code}>
											<td className="py-2.5 pr-4 tnum font-mono text-[13px] text-[#1D1D1F]">{e.code}</td>
											<td className="py-2.5 text-[14px] text-[#6E6E73]">{e.desc}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Section>

					<Section id="boas-praticas" title="Boas práticas">
						<ul className="space-y-2.5">
							<li className="flex gap-2.5"><span className="text-[#8E8E93]">•</span><span>Um token por sistema (ERP, BI…), com o menor escopo possível; revogue o que não usa.</span></li>
							<li className="flex gap-2.5"><span className="text-[#8E8E93]">•</span><span>Troque o token antes de vencer (crie o novo, troque no sistema, revogue o antigo).</span></li>
							<li className="flex gap-2.5"><span className="text-[#8E8E93]">•</span><span>Nunca mande CPF, nome ou telefone na URL: os dados vão só no arquivo.</span></li>
						</ul>
					</Section>
				</div>
			</div>
		</div>
	);
}
