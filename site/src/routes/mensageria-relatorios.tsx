import { redirect } from 'react-router';
export function clientLoader({ params }: { params: { canal: string } }) {
  return redirect(`/relatorios?canal=${params.canal}`);
}
export default function MensageriaRelatoriosRedirect() { return null; }
