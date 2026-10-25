import Link from 'next/link';
import { Logo } from '@queuesprout/ui';
import { site } from '@/lib/site';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" aria-label="QueueSprout home">
        <Logo />
      </Link>
      <article className="mt-8 flex flex-col gap-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-md [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
        <p className="text-sm text-muted">Last updated {site.legalUpdated}.</p>
      </article>
    </div>
  );
}
