import { gsap, useGsapContext, prefersReducedMotion } from '../../animations/gsapUtils.js';
import { usePlatformStats } from '../../hooks/usePlatformStats.js';
import { Skeleton } from '../ui/States.jsx';

/**
 * The platform stats band, wired to real numbers from GET /api/public/stats
 * — not marketing copy. Counts up on scroll-into-view once the data has
 * actually arrived; the count-up itself is the reveal, so these skip the
 * page's separate data-reveal fade (which is set up once on mount and
 * wouldn't know about elements that only exist once the fetch resolves).
 */
export function StatsBand({ numberClassName, labelClassName, skeletonClassName = '' }) {
  const { data: stats, isLoading } = usePlatformStats();

  useGsapContext(() => {
    if (!stats || prefersReducedMotion()) return;
    gsap.utils.toArray('[data-stat]').forEach((el) => {
      const target = parseFloat(el.dataset.stat);
      const suffix = el.dataset.suffix || '';
      if (!Number.isFinite(target)) return;
      const obj = { n: 0 };
      gsap.to(obj, {
        n: target, duration: 1.4, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onUpdate: () => {
          el.textContent = `${Number.isInteger(target) ? Math.round(obj.n).toLocaleString('en-IN') : obj.n.toFixed(1)}${suffix}`;
        },
      });
    });
  }, [stats]);

  const defs = stats ? [
    { value: stats.totalClinics, suffix: '', label: 'Clinics running on ClinicSaathi' },
    { value: stats.totalAppointments, suffix: '', label: 'Appointments booked through the platform' },
    { value: stats.totalPatients, suffix: '', label: 'Patients on the platform' },
    { value: stats.noShowRate, suffix: '%', label: 'No-show rate across all clinics' },
  ] : [];

  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {isLoading
        ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={`h-14 ${skeletonClassName}`} />)
        : defs.map(({ value, suffix, label }) => (
          <div key={label}>
            <p data-stat={value} data-suffix={suffix} className={numberClassName}>0</p>
            <p className={labelClassName}>{label}</p>
          </div>
        ))}
    </div>
  );
}
