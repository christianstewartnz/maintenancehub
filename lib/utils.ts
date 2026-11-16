import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { MaintenanceStatus, WorkOrderStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(date: string) {
  return new Date(date).toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function getDaysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24))
}

export function getAgeClass(createdAt: string, amberDays = 7, redDays = 14) {
  const days = getDaysSince(createdAt)
  if (days >= redDays) return 'age-red'
  if (days >= amberDays) return 'age-amber'
  return ''
}

export const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  logged: 'Logged',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  contractor_complete: 'Contractor Complete',
  complete: 'Complete',
}

export const STATUS_COLORS: Record<MaintenanceStatus, string> = {
  logged: 'badge-gray',
  assigned: 'badge-blue',
  in_progress: 'badge-amber',
  contractor_complete: 'badge-orange',
  complete: 'badge-green',
}

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  in_progress: 'In Progress',
  complete: 'Complete',
}

export const STATUS_FLOW: MaintenanceStatus[] = [
  'logged',
  'assigned',
  'in_progress',
  'contractor_complete',
  'complete',
]

export function nextStatus(current: MaintenanceStatus): MaintenanceStatus | null {
  const idx = STATUS_FLOW.indexOf(current)
  return idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null
}

type UnitLike = { unit_identifier?: string | null; address?: string | null } | null | undefined

/**
 * Canonical unit reference: always shows BOTH the unit number and the street
 * address when present (e.g. "A12 · 5 Smith St"). Some projects (e.g. Karori)
 * have no unit numbers, so the address alone is used; never drop the address
 * just because a unit number exists. Use this anywhere a unit is referenced.
 */
export function formatUnitLabel(unit: UnitLike, fallback = '—', separator = ' · '): string {
  const id = unit?.unit_identifier?.trim()
  const addr = unit?.address?.trim()
  if (id && addr) return `${id}${separator}${addr}`
  return id || addr || fallback
}
