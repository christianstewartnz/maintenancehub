import { MaintenanceStatus, WorkOrderStatus } from '@/lib/types'
import { STATUS_LABELS, STATUS_COLORS, WORK_ORDER_STATUS_LABELS } from '@/lib/utils'

export function StatusBadge({ status }: { status: MaintenanceStatus }) {
  return (
    <span className={`badge ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
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
