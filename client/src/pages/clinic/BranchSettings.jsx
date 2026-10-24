import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { PageHeader, Section } from '../../components/ui/Page.jsx';
import { Skeleton, EmptyState } from '../../components/ui/States.jsx';
import { BranchForm } from './Branches.jsx';

/** Branch managers edit their own branch's contact details and hours — nothing else. */
export default function BranchSettings() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['branches'], queryFn: () => api.get('/clinics/branches').then(unwrap) });
  const branch = q.data?.find((b) => String(b._id) === String(user?.branchId));
  return (
    <div>
      <PageHeader title="Branch settings" description="Contact details and opening hours for your branch. Opening new branches or closing one is done by the clinic owner." />
      <Section>
        {q.isLoading ? <Skeleton className="h-48" /> : branch ? <BranchForm branch={branch} limited /> : <EmptyState title="No branch assigned" body="Ask the clinic owner to assign you to a branch." />}
      </Section>
    </div>
  );
}
