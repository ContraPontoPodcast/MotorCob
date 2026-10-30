import { useState, type ReactNode } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { WorkspaceHeading } from '@/components/workspace/workspace-shell';

const API_URL = 'https://jxwppkrkuckfwmphqjva.supabase.co/functions/v1/api';

const ESCOPOS = [
  { id: 'cargas:enviar', nome: 'Enviar cargas', desc: 'POST /v1/cargas' },
  { id: 'cargas:status', nome: 'Acompanhar cargas', desc: 'GET /v1/cargas/{id}' },
  { id: 'lista:ler', nome: 'Ler a Lista do dia', desc: 'GET /v1/lista-do-dia' },
];

const ERROS: { code: string; desc: string }[] = [
  { code: '400', desc: 'Parâmetro inválido.' },
  { code: '401', desc: 'Token inválido, revogado ou vencido.' },
  { code: '403', desc: 'Sem escopo, credor fora do token ou módulo desligado.' },
  { code: '404', desc: 'Não encontrado.' },
  { code: '409', desc: 'Credor recebe por arquivo.' },
  { code: '413', desc: 'Acima de 20 MB.' },
  { code: '429', desc: 'Limite por minuto.' },
  { code: '500', desc: 'Tente de novo.' },
];

function CodeBlock({ code }: { code: string }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setOk(true); setTimeout(() => setOk(false), 1800); }
    catch { /* ignora */ }
  }
  return (
    <div className="relative mt-3">
      <button onClick={copy} className="absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-white/10 px-2.5 text-[12px] font-medium text-[#F5F5F7] hover:bg-white/20">
        {ok ? <Check size={13} className="text-[#34C759]" /> : <Copy size={13} />} {ok ? 'Copiado' : 'Copiar'}
      </button>
      <pre className="overflow-x-auto rounded-xl bg-[#1C1C1E] p-4 pr-20 text-[13px] leading-relaxed"><code className="font-mono text-[#F5F5F7]">{code}</code></pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-24">
      <h2 className="text-[20px] font-bold tracking-tight text-[#1D1D1F]">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-[1.6] text-[#1D1D1F]">{children}</div>
    </section>
  );
}

export function DocsApiPage() {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      <WorkspaceHeading title="API MotorCX" description="Integração e API" />

      <section className="rounded-2xl bg-white p-6 sm:p-8" style={{ boxShadow: '0 0 0 1px #E5E5EA, 0 2px 12px rgba(0,0,0,.04)' }}>
        <h1 className="text-[28px] font-bold tracking-tight text-[#1D1D1F]">Documentação da API</h1>
        <p className="mt-2 text-[15px] text-[#6E6E73]">Envie cargas e leia a Lista do dia direto do sistema da sua empresa, com um token de API.</p>

        <div className="mt-6 space-y-4">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Endereço</p>
            <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-3 py-2">
              <Link2 size={15} className="shrink-0 text-[#8E8E93]" />
              <code className="break-all font-mono text-[13px] text-[#1D1D1F]">{API_URL}</code>
            </div>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Autenticação</p>
            <p className="mt-1.5 text-[15px] text-[#1D1D1F]">Cabeçalho <code className="rounded bg-[#F5F5F7] px-1.5 py-0.5 font-mono text-[13px]">Authorization: Bearer mc_...</code>. O token é criado em <strong>Minha conta › Tokens de API</strong>.</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Limite</p>
            <p className="mt-1.5 text-[15px] text-[#1D1D1F]">60 chamadas por minuto por token.</p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">Escopos</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-2 pr-4 font-medium">Escopo</th><th className="pb-2 pr-4 font-medium">Nome</th><th className="pb-2 font-medium">Endpoint</th></tr></thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {ESCOPOS.map(e => <tr key={e.id}><td className="py-2 pr-4 font-mono text-[#6E6E73]">{e.id}</td><td className="py-2 pr-4 text-[#1D1D1F]">{e.nome}</td><td className="py-2 font-mono text-[#6E6E73]">{e.desc}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>

        <Section id="enviar-carga" title="Enviar carga">
          <p>Envia um arquivo de carga para um credor. O corpo da requisição é o próprio arquivo (CSV, TXT ou XLSX, até 20 MB).</p>
          <p className="text-[14px] text-[#6E6E73]">Tipos: <code className="font-mono">geral</code>, <code className="font-mono">incremental</code>, <code className="font-mono">retirada</code>, <code className="font-mono">acordo</code>, <code className="font-mono">baixa</code>, <code className="font-mono">ocorrencia</code>.</p>
          <p className="text-[14px] font-semibold text-[#1D1D1F]">POST /v1/cargas?credor=banco-x&amp;tipo=incremental&amp;nome=incremental.csv</p>
          <CodeBlock code={`curl -X POST "$API/v1/cargas?credor=banco-x&tipo=incremental&nome=incremental.csv" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: text/csv" \\
  --data-binary @incremental.csv`} />
          <p className="text-[14px] text-[#6E6E73]">Resposta <code className="font-mono">202</code>:</p>
          <CodeBlock code={`{
  "envio_id": 1234,
  "situacao": "pendente",
  "acompanhar": "/v1/cargas/1234"
}`} />
        </Section>

        <Section id="acompanhar" title="Acompanhar carga">
          <p>Consulta a situação de uma carga enviada e o relatório de linhas aceitas e rejeitadas.</p>
          <p className="text-[14px] font-semibold text-[#1D1D1F]">GET /v1/cargas/{'{id}'}</p>
          <p className="text-[14px] text-[#6E6E73]"><code className="font-mono">situacao</code>: <code className="font-mono">pendente</code> · <code className="font-mono">aguardando</code> · <code className="font-mono">processado</code> · <code className="font-mono">erro</code>, mais o relatório.</p>
          <CodeBlock code={`curl "$API/v1/cargas/1234" \\
  -H "Authorization: Bearer $TOKEN"`} />
        </Section>

        <Section id="lista-do-dia" title="Lista do dia">
          <p>Lê a Lista do dia de um credor e canal, no mesmo formato CSV do site.</p>
          <p className="text-[14px] font-semibold text-[#1D1D1F]">GET /v1/lista-do-dia?credor=banco-x&amp;canal=sms&amp;data=2026-10-14</p>
          <CodeBlock code={`curl "$API/v1/lista-do-dia?credor=banco-x&canal=sms&data=2026-10-14" \\
  -H "Authorization: Bearer $TOKEN" \\
  -o lista-sms.csv`} />
        </Section>

        <div className="mt-10">
          <h2 className="text-[20px] font-bold tracking-tight text-[#1D1D1F]">Erros</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead><tr className="border-b border-[#F0F0F2] text-[12px] text-[#8E8E93]"><th className="pb-2 pr-4 font-medium">Código</th><th className="pb-2 font-medium">Significado</th></tr></thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {ERROS.map(e => <tr key={e.code}><td className="py-2 pr-4 tnum font-mono text-[#1D1D1F]">{e.code}</td><td className="py-2 text-[#6E6E73]">{e.desc}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-10">
          <h2 className="text-[20px] font-bold tracking-tight text-[#1D1D1F]">Boas práticas</h2>
          <ul className="mt-3 space-y-2 text-[15px] text-[#1D1D1F]">
            <li className="flex gap-2"><span className="text-[#8E8E93]">•</span> Um token por sistema.</li>
            <li className="flex gap-2"><span className="text-[#8E8E93]">•</span> Menor escopo possível.</li>
            <li className="flex gap-2"><span className="text-[#8E8E93]">•</span> Trocar antes de vencer.</li>
            <li className="flex gap-2"><span className="text-[#8E8E93]">•</span> Nunca dado pessoal na URL.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
