import type { CSSProperties } from 'react';

/** O atraso da revelação (--i) do protótipo: style={i(2)}. */
export const i = (n: number) => ({ '--i': n }) as CSSProperties;
