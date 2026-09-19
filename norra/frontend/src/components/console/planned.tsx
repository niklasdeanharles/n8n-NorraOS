import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NorraMark } from '@/components/norra-logo';
import { PageHeader } from './page-header';

/**
 * Ein Screen, den es noch nicht gibt.
 *
 * Er steht im Menue, weil der Umfang sichtbar sein soll, und er sagt hier
 * ausdruecklich, was fehlt und was stattdessen schon geht. Die Alternative
 * waere ein Menuepunkt, der auf eine 404 fuehrt -- und der kostet mehr
 * Vertrauen, als ein ehrlicher Platzhalter je koennte.
 */
export function Planned({
  title,
  description,
  scope,
  insteadHref,
  insteadLabel,
}: {
  title: string;
  description: string;
  /** Was dieser Screen koennen wird, in Stichpunkten. */
  scope: readonly string[];
  insteadHref?: string;
  insteadLabel?: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-8 p-8 md:flex-row md:items-start">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-brand-subtle">
            <NorraMark className="size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">Noch nicht gebaut</h2>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted">
              Dieser Bereich ist geplant und steht deshalb schon im Menü. Was hier entstehen soll:
            </p>
            <ul className="mt-4 space-y-2">
              {scope.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[14px] text-muted">
                  <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {insteadHref && insteadLabel ? (
              <Button asChild variant="secondary" size="sm" className="mt-6">
                <Link href={insteadHref}>
                  {insteadLabel}
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </>
  );
}
