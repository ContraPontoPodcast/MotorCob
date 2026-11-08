// Faixa das 7 travas no topo do editor (revisão X2): sempre à vista, com cadeado, recolhível e nunca removível. Logo
// abaixo, "Em qualquer momento da ligação": o que o executor faz antes de qualquer etapa. Os textos vêm da lista única
// de @/lib/fluxo (TRAVAS, SEMPRE), a mesma da gaveta e do "Descrever". Só apresentação; testado em
// site/src/components/fluxo/componentes.test.tsx.
import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { SEMPRE, SEMPRE_AINDA_NAO, TRAVAS } from '@/lib/fluxo';

const CHAVE = 'motorcx.fluxo.travas-recolhidas';
const ler = () => { try { return globalThis.localStorage?.getItem(CHAVE) === '1'; } catch { return false; } };
const gravar = (v: boolean) => { try { globalThis.localStorage?.setItem(CHAVE, v ? '1' : '0'); } catch { /* sem armazenamento: só não lembra */ } };

export function FaixaTravas({ recolhidaInicial }: { recolhidaInicial?: boolean }) {
	const [recolhida, setRecolhida] = useState<boolean>(recolhidaInicial ?? false);
	useEffect(() => { if (recolhidaInicial == null && ler()) setRecolhida(true); }, [recolhidaInicial]);   // lembra por navegador
	const trocar = () => setRecolhida(v => { gravar(!v); return !v; });
	return (
		<section aria-label="Travas fixas" className="rounded-2xl px-4 py-3" style={{ backgroundColor: 'color-mix(in srgb, var(--area-voz) 10%, var(--base-cartao))', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--area-voz) 22%, transparent)' }}>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--area-voz)]"><Lock size={15} className="shrink-0" aria-hidden /> {TRAVAS.length} travas fixas · valem em toda a ligação</h2>
					<p className="mt-0.5 text-[12.5px] text-[var(--base-texto-2)]">Ficam no código do MotorCX: nenhum fluxo remove.</p>
				</div>
				<button type="button" onClick={trocar} aria-expanded={!recolhida} aria-controls="lista-travas" className="shrink-0 text-[12.5px] font-semibold text-[var(--area-voz)] underline-offset-2 hover:underline">{recolhida ? 'Mostrar' : 'Recolher'}</button>
			</header>
			<ol id="lista-travas" hidden={recolhida} className="mt-2.5 grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(250px, 100%), 1fr))' }}>
				{TRAVAS.map(([t, s], i) => (
					<li key={t} className="flex min-w-0 items-start gap-2 text-[13px] text-[var(--base-texto)]">
						<Lock size={13} className="mt-[3px] shrink-0 text-[var(--area-voz)]" aria-hidden />
						<span className="min-w-0"><b className="font-semibold">{i + 1}. {t}</b><small className="mt-0.5 block text-[12px] text-[var(--base-texto-2)]">{s}</small></span>
					</li>
				))}
			</ol>
		</section>
	);
}

/** "Em qualquer momento da ligação": respostas fixas do agente, antes de qualquer etapa (e o que ainda não existe). */
export function EmQualquerMomento() {
	return (
		<section aria-labelledby="titulo-sempre">
			<div className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5">
				<h2 id="titulo-sempre" className="text-[14.5px] font-semibold text-[var(--base-texto)]">Em qualquer momento da ligação</h2>
				<span className="text-[12.5px] text-[var(--base-texto-3)]">Respostas fixas do agente, antes de qualquer etapa</span>
			</div>
			<div className="rounded-2xl bg-[var(--base-cartao)] px-4 py-3" style={{ boxShadow: '0 0 0 1px var(--base-borda)' }}>
				<ul className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(230px, 100%), 1fr))' }}>
					{SEMPRE.map(([q, r]) => (
						<li key={q} className="min-w-0 text-[13px]">
							<b className="flex items-start gap-1.5 font-semibold text-[var(--base-texto)]"><Lock size={12} className="mt-[3px] shrink-0 text-[var(--area-voz)]" aria-hidden />{q}</b>
							<span className="block text-[12.5px] text-[var(--base-texto-2)]">{r}</span>
						</li>
					))}
				</ul>
				<p className="mt-2.5 border-t pt-2 text-[12px] text-[var(--base-texto-3)]" style={{ borderColor: 'var(--base-separator, var(--base-borda))' }}>{SEMPRE_AINDA_NAO}</p>
			</div>
		</section>
	);
}
