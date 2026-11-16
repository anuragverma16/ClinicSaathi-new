import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { PageHeader } from '../../components/ui/Page.jsx';

export default function AdminAuditLog() {
  const logs = useQuery({
    queryKey: ['platform', 'audit-logs'],
    queryFn: () => api.get('/platform/audit-logs', { params: { limit: 50 } }).then((r) => r.data.data),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Audit logs" description="The last 50 recorded actions across every clinic and the platform itself." />

      <DataTable
        loading={logs.isLoading}
        error={logs.error}
        onRetry={logs.refetch}
        rows={logs.data}
        columns={[
          { key: 'createdAt', header: 'When', render: (r) => dateTime(r.createdAt) },
          {
            key: 'action', header: 'Action',
            render: (r) => <span className="font-mono text-xs">{r.action}</span>,
          },
          {
            key: 'actor', header: 'Actor', hideOnMobile: true,
            render: (r) => r.actorUserId ? `${r.actorUserId.name} (${r.actorUserId.role?.replace('_', ' ')})` : '—',
          },
          { key: 'clinic', header: 'Clinic', hideOnMobile: true, render: (r) => r.clinicId?.name || '—' },
          { key: 'entityType', header: 'Entity', hideOnMobile: true, render: (r) => r.entityType || '—' },
        ]}
      />
    </div>
  );
}
