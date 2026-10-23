const TONES = {
  neutral: 'bg-paper-sunk text-ink-muted border-line',
  positive: 'bg-pulse-soft text-pulse-deep border-pulse/20',
  info: 'bg-[#E6EEF9] text-[#1D4E89] border-[#1D4E89]/15',
  warning: 'bg-signal-soft text-signal border-signal/25',
  negative: 'bg-alert-soft text-alert border-alert/20',
};

const MAP = {
  // Appointments
  REQUESTED: ['warning', 'Pending confirmation'],
  CONFIRMED: ['info', 'Confirmed'],
  CHECKED_IN: ['positive', 'Checked in'],
  WAITING: ['warning', 'Waiting'],
  IN_CONSULTATION: ['positive', 'With doctor'],
  COMPLETED: ['neutral', 'Completed'],
  CANCELLED: ['negative', 'Cancelled'],
  RESCHEDULED: ['neutral', 'Rescheduled'],
  NO_SHOW: ['negative', 'No show'],
  // Queue
  CALLED: ['positive', 'Called'],
  SKIPPED: ['neutral', 'Skipped'],
  // Money
  PAID: ['positive', 'Paid'],
  UNPAID: ['warning', 'Unpaid'],
  PARTIAL: ['warning', 'Part paid'],
  OVERDUE: ['negative', 'Overdue'],
  REFUNDED: ['neutral', 'Refunded'],
  PARTIALLY_REFUNDED: ['warning', 'Part refunded'],
  VOID: ['neutral', 'Void'],
  SUCCESS: ['positive', 'Success'],
  CREATED: ['neutral', 'Started'],
  PENDING: ['warning', 'Pending'],
  FAILED: ['negative', 'Failed'],
  PROCESSED: ['positive', 'Processed'],
  // Clinical
  DRAFT: ['warning', 'Draft'],
  FINAL: ['positive', 'Signed'],
  ISSUED: ['positive', 'Issued'],
  REVOKED: ['negative', 'Revoked'],
  ORDERED: ['warning', 'Ordered'],
  SAMPLE_COLLECTED: ['info', 'Sample collected'],
  PROCESSING: ['info', 'Processing'],
  RESULT_SUBMITTED: ['warning', 'Awaiting verification'],
  VERIFIED: ['positive', 'Verified'],
  URGENT: ['negative', 'Urgent'],
  ROUTINE: ['neutral', 'Routine'],
  // Automation
  SENT: ['positive', 'Sent'],
  DELIVERED: ['positive', 'Delivered'],
  READ: ['positive', 'Read'],
  RECEIVED: ['info', 'Received'],
  SCHEDULED: ['info', 'Scheduled'],
  RESPONDED: ['info', 'Responded'],
  BOOKED: ['positive', 'Booked'],
  ESCALATED: ['negative', 'Escalated'],
  CLOSED: ['neutral', 'Closed'],
  DUE: ['warning', 'Due'],
  NOTIFIED: ['info', 'Notified'],
  DISMISSED: ['neutral', 'Dismissed'],
  APPROVED: ['info', 'Approved'],
  SENDING: ['info', 'Sending'],
  // Subscriptions / accounts / tickets
  TRIALING: ['warning', 'Trialing'],
  ACTIVE: ['positive', 'Active'],
  INACTIVE: ['neutral', 'Inactive'],
  EXPIRED: ['negative', 'Expired'],
  PAST_DUE: ['negative', 'Past due'],
  OPEN: ['warning', 'Open'],
  IN_PROGRESS: ['info', 'In progress'],
  RESOLVED: ['positive', 'Resolved'],
  ENQUEUE_FAILED: ['negative', 'Not queued'],
};

export function StatusBadge({ status, children }) {
  const [tone, label] = MAP[status] || ['neutral', String(status || '—').replace(/_/g, ' ').toLowerCase()];
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children || label}
    </span>
  );
}
