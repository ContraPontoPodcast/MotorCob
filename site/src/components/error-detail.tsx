import { useState } from 'react';
import { toast } from 'sonner';
import { captureError, friendlyError, getErrorDetail, type ErrorDetail } from '@/lib/supabase';

/** Texto exibido no bloco: código, consulta, mensagem, detalhes e dica (sanitizados). */
function displayText(d: ErrorDetail): string {
  const parts: string[] = [];
  if (d.code) parts.push(`código: ${d.code}`);
  if (d.table) parts.push(`consulta: ${d.table}`);
  if (d.message) parts.push(d.message);
  if (d.details) parts.push(`detalhes: ${d.details}`);
  if (d.hint) parts.push(`dica: ${d.hint}`);
  return parts.join(' · ');
}

/** Texto copiado: inclui ainda a página e a data/hora. */
function copyText(d: ErrorDetail): string {
  const base = displayText(d);
  const meta = [`página: ${d.page}`, `data/hora: ${d.timestamp}`].join(' · ');
  return base ? `${base} · ${meta}` : meta;
}

/**
 * "Detalhe técnico" — link pequeno (text-xs text-slate-400) que abre um bloco
 * recolhível em fonte mono com o erro original sanitizado e um botão "Copiar detalhe".
 * Lê o erro guardado pelo client Supabase wrapper / friendlyError(err).
 */
export function ErrorDetail() {
  const [open, setOpen] = useState(false);
  const detail = getErrorDetail();
  if (!detail) return null;
  const shown = displayText(detail);
  if (!shown) return null;

  const copy = async () => {
    const text = copyText(detail);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Detalhe técnico copiado');
    } catch {
      toast.error('Não foi possível copiar o detalhe');
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-500"
      >
        Detalhe técnico
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 p-2">
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-slate-500">{shown}</pre>
          <button
            type="button"
            onClick={copy}
            className="mt-1.5 text-[11px] text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            Copiar detalhe
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Toast de erro com Detalhe técnico. Substitui `toast.error(friendlyError())`:
 * guarda o erro original (quando passado) e mostra o link recolhível na descrição.
 */
export function toastError(err?: unknown) {
  if (err != null) captureError(err);
  toast.error(friendlyError(), { description: <ErrorDetail /> });
}
