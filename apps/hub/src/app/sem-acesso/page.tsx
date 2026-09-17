import Link from "next/link";

export default function SemAcesso() {
  return (
    <div className="grid min-h-screen w-full place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="mb-2 text-xl font-black">Sem acesso ao Geri Hub</div>
        <p className="text-[14px] text-ink-2">Você entrou, mas este e-mail ainda não está cadastrado pela gestão. Peça ao Rafael ou ao Daniel para liberar o seu acesso.</p>
        <Link href="/login" className="btn btn-ghost mt-6">Entrar com outro e-mail</Link>
      </div>
    </div>
  );
}
