/**
 * Recharts needs literal colours (it can't read CSS variables), so these are
 * the light app palette's hex twins: navy ink, teal primary, cool greys.
 */
export const CHART = {
  grid: '#E3E8F0',
  axis: '#5E6E85',
  teal: '#0D9488',
  navy: '#1D4E89',
  amber: '#CA7D14',
  red: '#C43A31',
  muted: '#9AA8BC',
  tooltip: { background: '#FFFFFF', border: '1px solid #DFE5EE', borderRadius: 10, color: '#0B1F3A', fontSize: 12 },
};

export const SERIES = [CHART.teal, CHART.navy, CHART.amber, CHART.red, CHART.muted];
