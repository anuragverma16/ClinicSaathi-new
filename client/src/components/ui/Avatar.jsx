/**
 * Profile photo, or the first initial when there isn't one. Size comes from
 * className, so the same component fits the top bar, table rows and the photo dialog.
 */
export function Avatar({ name, src, className = 'h-9 w-9 text-sm', tone = 'bg-gradient-to-br from-teal-500 to-emerald-600 text-white' }) {
  if (src) {
    return <img src={src} alt={name ? `${name}'s profile photo` : 'Profile photo'} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tone} ${className}`}>
      {name?.trim()?.[0]?.toUpperCase() || '?'}
    </span>
  );
}
