import { redirect } from 'react-router';
// /solucoes não tem página própria: as soluções estão na home, em "Seis funcionalidades. Uma IA."
export function clientLoader() { return redirect('/#funcionalidades'); }
export default function Solucoes() { return null; }
