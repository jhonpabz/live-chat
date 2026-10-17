import type { VisitorStatus } from '@/features/inbox/useVisitorPresence';

const labels: Record<VisitorStatus, string> = { online: 'Online', offline: 'Offline', checking: 'Checking…', unknown: 'Unknown' };

export function VisitorPresenceIndicator({ status }: { status: VisitorStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-label={`Visitor ${labels[status].toLowerCase()}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${status === 'online' ? 'bg-green-500' : status === 'offline' ? 'bg-slate-400' : 'bg-amber-400'}`} />
      {labels[status]}
    </span>
  );
}
