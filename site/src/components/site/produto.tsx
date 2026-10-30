import { RotorMark } from './logo';
import { Carrossel } from './carrossel';

export function Produto() {
	return (
		<section id="produto" className="scroll-mt-[92px] bg-white px-5 py-20 md:scroll-mt-[64px] md:py-28">
			<div className="mx-auto max-w-[980px] text-center">
				<p className="text-[15px] font-semibold text-[#6E6E73]">Apresentamos</p>
				<div className="mt-4 flex items-center justify-center gap-3">
					<RotorMark tone="onLight" className="h-12 w-12" />
					<span className="ls-tight font-bold text-[#1D1D1F]" style={{ fontSize: 'clamp(40px, 7vw, 72px)' }}>MotorCX</span>
				</div>
				<p className="ls-tight mt-5 text-[21px] font-semibold text-[#1D1D1F]">Da carga à ação, com inteligência. Uma plataforma, cada função no seu lugar.</p>
			</div>

			<div className="mt-14">
				<Carrossel />
			</div>
		</section>
	);
}
