import { MaintenanceStatus, Priority, WorkOrderStatus } from '@/lib/types'
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, WORK_ORDER_STATUS_LABELS } from '@/lib/utils'

export function StatusBadge({ status }: { status: MaintenanceStatus }) {
  return (
    <span className={`badge ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className={`priority-dot ${PRIORITY_COLORS[priority]}`} />
      <span style={{ fontSize: 13, color: '#37352f' }}>{PRIORITY_LABELS[priority]}</span>
    </span>
  )
}

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  const colors: Record<WorkOrderStatus, string> = {
    draft: 'badge-gray',
    sent: 'badge-blue',
    in_progress: 'badge-amber',
    complete: 'badge-green',
  }
  return (
    <span className={`badge ${colors[status]}`}>
      {WORK_ORDER_STATUS_LABELS[status]}
    </span>
  )
}
