import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, UserPlus } from 'lucide-react';
import { api, unwrapPage } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { DataTable } from '../../components/ui/DataTable.jsx';
import { EmptyState } from '../../components/ui/States.jsx';
import { PageHeader, Pagination } from '../../components/ui/Page.jsx';
import { PatientRecord } from './PatientRecord.jsx';
import { relative, age, titleCase } from '../../lib/format.js';

export default function Patients({ title = 'Patients', description, registerPath }) {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('created');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['patients', q, type, sort, page],
    queryFn: () => api.get('/patients', { params: { q: q || undefined, type: type || undefined, sort, page, limit: 25 } }).then(unwrapPage),
  });

  return (
    <div>
      <PageHeader title={title}
        description={description || (user?.role === 'DOCTOR' ? 'Patients you have treated or are booked to see.' : 'Search the clinic\'s patient records. Click a row for the full history your role can see.')}
        actions={registerPath && <Link to={registerPath} className="btn-primary"><UserPlus className="h-4 w-4" /> Register patient</Link>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input className="field pl-9" placeholder="Name, phone or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search patients" />
        </div>
        <select className="field-sm" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Patient type">
          <option value="">All patients</option><option value="new">New (≤1 visit)</option><option value="returning">Returning</option>
        </select>
        <select className="field-sm" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="created">Newest first</option><option value="lastVisit">Recent visit</option><option value="name">Name A–Z</option>
        </select>
      </div>

      <DataTable
        loading={isLoading} error={error} onRetry={refetch} rows={data?.data}
        onRowClick={(r) => setSelected(r._id)}
        empty={<EmptyState title={q ? 'No patient matches that' : 'No patients yet'} body={q ? 'Try a different name or number.' : 'Patients are created when they book or are registered at the desk.'} />}
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}{r.guardianPatientId && <span className="ml-1.5 text-xs text-ink-muted">(dependent)</span>}</span> },
          { key: 'phone', header: 'Phone', render: (r) => <span className="font-mono text-sm">{r.phone}</span> },
          { key: 'demo', header: 'Age / Gender', hideOnMobile: true, render: (r) => [age(r.dob), r.gender && titleCase(r.gender)].filter(Boolean).join(' · ') || '—' },
          { key: 'visits', header: 'Visits', hideOnMobile: true, render: (r) => r.visitCount || 0 },
          { key: 'last', header: 'Last visit', render: (r) => relative(r.lastVisitAt) },
        ]}
      />
      <Pagination meta={data?.meta} page={page} onPage={setPage} />
      <PatientRecord patientId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
