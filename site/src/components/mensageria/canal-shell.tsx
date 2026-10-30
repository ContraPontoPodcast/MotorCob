import { useEffect, useState } from 'react';
import { Outlet, useParams, Navigate, useLocation, Link } from 'react-router';
import { supabase, type Row } from '@/lib/supabase';
import { useMotorAuth } from '@/components/auth-provider';
import { PRODUTO_MAP, isCanalValido, CANAL_STORAGE_KEY, PRODUTOS } from '@/lib/mensageria-produtos';
import { useAreasLiberadas } from '@/hooks/use-areas-liberadas';
import { FaixaEnvioReal } from '@/components/mensageria/faixa-envio-real';
import { Info } from '@/components/glossario/info';

function dateExtensa() {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  } catch { return ''; }
}

/** Deriva o título da tela a partir da rota (sem pílula nem abas — viraram menu). */
function tituloDaRota(pathname: string, canal: string): { titulo: string | null } {
  const rest = pathname.replace(/^\/mensageria\/[^/]+\/?/, '').split('/').filter(Boolean);
  if (rest.length === 0) return { titulo: 'Painel' };
  const seg = rest[0];
  if (rest.length === 1) {
    if (seg === 'campanhas') return { titulo: 'Campanhas' };
    if (seg === 'lotes') return { titulo: 'Lotes do dia' };
    if (seg === 'templates') return { titulo: canal === 'email' ? 'Modelo de e-mail' : 'Templates' };
    if (seg === 'listas') return { titulo: 'Listas' };
    if (seg === 'respostas') return { titulo: 'Respostas' };
    if (seg === 'config') return { titulo: 'Configurações' };
    if (seg === 'relatorios') return { titulo: 'Relatórios' };
    return { titulo: null };
  }
  if (rest.length === 2 && seg === 'campanhas' && rest[1] === 'nova') return { titulo: 'Nova campanha' };
  // Detalhe (campanhas/:id, lotes/:id) — a tela mostra o próprio nome.
  return { titulo: null };
}

export function CanalShell() {
  const { canal } = useParams();
  const { empresa } = useMotorAuth();
  const loc = useLocation();
  const [modo, setModo] = useState<'simulado' | 'real' | null>(null);
  const areasLib = useAreasLiberadas();

  useEffect(() => {
    if (isCanalValido(canal)) {
      try { localStorage.setItem(CANAL_STORAGE_KEY, canal); } catch { /* ignore */ }
    }
  }, [canal]);

  useEffect(() => {
    if (!supabase || !empresa) { setModo(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase.from('mensageria_config').select('modo').eq('empresa_id', empresa.id).maybeSingle();
      if (!active) return;
      setModo((data as Row | null)?.modo === 'real' ? 'real' : 'simulado');
    })();
    return () => { active = false; };
  }, [empresa?.id]);

  if (!isCanalValido(canal)) return <Navigate to="/mensageria" replace />;
  const prod = PRODUTO_MAP[canal];
  // Canal válido mas fora dos contratados (cliente ou equipe com pílula).
  const canalContratado = areasLib.semEmpresa || areasLib.canais.includes(canal);
  if (!canalContratado) {
    const primeiro = areasLib.canais[0] ?? areasLib.canalPadrao;
    const nomePrimeiro = PRODUTOS.find(p => p.id === primeiro)?.nome ?? primeiro;
    return (
      <div className="mx-auto max-w-[560px] px-4 py-16 text-center">
        <h1 className="text-[22px] font-semibold text-[#1D1D1F]">O canal {prod.nome} não está contratado.</h1>
        <p className="mt-2 text-[14px] text-[#6E6E73]">Fale com o time comercial para conhecer e contratar.</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to={`/mensageria/${primeiro}`} className="inline-flex h-10 items-center rounded-lg bg-[#1D1D1F] px-6 text-[14px] font-semibold text-white hover:opacity-85">Ir para {nomePrimeiro}</Link>
          <Link to="/mensageria" className="inline-flex h-10 items-center rounded-lg border border-[#D2D2D7] px-6 text-[14px] font-medium text-[#1D1D1F] hover:bg-[#F5F5F7]">Trocar de canal</Link>
        </div>
      </div>
    );
  }
  const { titulo } = tituloDaRota(loc.pathname, canal);
  const contexto = [empresa?.nome, 'Mensageria', prod.nome, dateExtensa()].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-[clamp(16px,3vw,40px)]">
      {titulo ? (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[#1D1D1F]">{titulo}</h1>
              {modo && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold" style={modo === 'real' ? { color: '#248A3D', backgroundColor: '#E8F8EC' } : { color: '#9a631b', backgroundColor: '#FFF3E8' }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: modo === 'real' ? '#34C759' : '#FF9500' }} />
                  {modo === 'real' ? 'Envio real' : 'Simulação'}<Info slug="simulacao-e-envio-real" />
                </span>
              )}
            </div>
            <p className="mt-1 text-[14px] text-[#6E6E73]">{contexto}</p>
          </div>
        </div>
      ) : (
        // Detalhe: só a linha de contexto; a tela traz o próprio título e o voltar.
        <div className="mb-4 text-[14px] text-[#6E6E73]">{contexto}</div>
      )}

      <FaixaEnvioReal />

      <Outlet />

      {/* Rodapé de contexto do canal */}
      <div className="mt-8 border-t border-[#E5E5EA] pt-4 text-[12px] text-[#8E8E93]">
        <span>{prod.nome} · {empresa?.nome ?? '—'}</span>
      </div>
    </div>
  );
}
