import { WidgetChat } from './widget-chat';

/**
 * Not a Server Component beyond this shell: a widget visitor is anonymous, so
 * there is nothing to fetch with a session — the client mints its own via
 * /api/widget/session on mount. Passing `agentId` down is the only server work.
 */
export default async function WidgetPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <WidgetChat agentId={agentId} />;
}
