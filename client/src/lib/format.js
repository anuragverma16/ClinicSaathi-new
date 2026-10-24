import dayjs from 'dayjs';

export const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
    .format(Number(n) || 0);
export const inr2 = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(n) || 0);

export const time = (d) => dayjs(d).format('h:mm A');
export const date = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const dateTime = (d) => (d ? dayjs(d).format('DD MMM, h:mm A') : '—');
export const ymd = (d = new Date()) => dayjs(d).format('YYYY-MM-DD');
export const relative = (d) => {
  if (!d) return 'Never';
  const days = dayjs().diff(dayjs(d), 'day');
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} mo ago` : `${Math.floor(months / 12)} yr ago`;
};
export const age = (dob) => (dob ? `${dayjs().diff(dayjs(dob), 'year')}y` : null);
export const titleCase = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
