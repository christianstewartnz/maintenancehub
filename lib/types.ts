export type ProjectStatus = 'active' | 'archived'
export type MaintenanceStatus = 'logged' | 'assigned' | 'in_progress' | 'contractor_complete' | 'complete'
export type WorkOrderStatus = 'draft' | 'sent' | 'in_progress' | 'complete'
export type ReportFrequency = 'daily' | 'weekly' | 'none'
export type ReportScope = 'all_projects' | 'per_project'

export interface Project {
  id: string
  name: string
  address: string | null
  description: string | null
  development_company: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
}

export interface UnitOwner {
  id: string
  unit_id: string
  name: string
  email: string | null
  phone: string | null
  created_at: string
}

export interface Unit {
  id: string
  project_id: string
  unit_identifier: string | null
  lot_number: string | null
  address: string | null
  access_contact_name: string | null
  access_contact_email: string | null
  access_contact_phone: string | null
  settlement_date: string | null
  /** When the owners were emailed their 90-day maintenance reminder (null = not yet). */
  maintenance_reminder_sent_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  owners?: UnitOwner[]
}

export interface Contractor {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  portal_token: string
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Extra people at a contractor beyond the main contact (office, supervisor, accounts…). */
export interface ContractorContact {
  id: string
  contractor_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  created_at: string
}

export interface Trade {
  id: string
  project_id: string
  name: string
  created_at: string
}

export interface ProjectTradeAssignment {
  id: string
  project_id: string
  trade_id: string
  contractor_id: string
  created_at: string
  trade?: Trade
  contractor?: Contractor
}

export interface WorkOrder {
  id: string
  work_order_number: string
  project_id: string
  contractor_id: string
  status: WorkOrderStatus
  sent_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  project?: Project
  contractor?: Contractor
}

export interface MaintenanceItem {
  id: string
  item_number: string
  unit_id: string
  trade_id: string | null
  title: string
  description: string | null
  status: MaintenanceStatus
  contractor_id: string | null
  work_order_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  scheduled_date: string | null
  assigned_to: string | null
  /** When the contractor was last emailed (or marked as told) about this item; null = not yet. */
  contractor_notified_at: string | null
  /** When the item was archived; null = active. Archived items are hidden from lists, counts and the portal. */
  archived_at: string | null
  /** Hidden from the contractor portal (and its notify counts) until an admin shows it. */
  portal_hidden: boolean
  /** Set on a step: the job (parent item) it belongs to. Step numbers look like MI-0166-2. */
  parent_item_id?: string | null
  /** A step's position within its job (reorderable; the item number stays fixed). */
  step_order?: number | null
  /** True on a job that's split into steps: it has no contractor and its status follows its steps. */
  has_steps?: boolean
  unit?: Unit & { project?: Project }
  trade?: Trade
  contractor?: Contractor
  work_order?: WorkOrder
}

/** A step as shown in a job's Steps panel / the list. */
export interface ItemStep {
  id: string
  item_number: string
  title: string
  description: string | null
  status: MaintenanceStatus
  step_order: number | null
  trade_id: string | null
  contractor_id: string | null
  archived_at: string | null
  trade?: { id: string; name: string } | null
  contractor?: { id: string; company_name: string } | null
}

/** Columns the maintenance list needs (page load and re-fetching a job after adding a step). */
export const LIST_SELECT = `
  id, item_number, title, description, status, created_at, updated_at, assigned_to, contractor_id, trade_id, archived_at,
  parent_item_id, step_order, has_steps,
  unit:units(id, unit_identifier, address, project_id, project:projects(id, name)),
  trade:trades(id, name),
  contractor:contractors(id, company_name),
  work_order:work_orders(id, work_order_number)
`

export const STEP_SELECT = 'id, item_number, title, description, status, step_order, trade_id, contractor_id, archived_at, trade:trades(id, name), contractor:contractors(id, company_name)'

/** A Maintenance Hub staff user (mirrors auth.users). */
export interface Profile {
  id: string
  email: string | null
  full_name: string | null
}

/** 'admin' sees and manages everything; 'staff' only sees projects they're assigned to. */
export type UserRole = 'admin' | 'staff'

/** A profile with the permission fields (role, active, phone). */
export interface StaffProfile extends Profile {
  role: UserRole
  is_active: boolean
  phone: string | null
}

/** A staff member assigned to a project. is_primary = the project's main contact. */
export interface ProjectStaff {
  project_id: string
  user_id: string
  is_primary: boolean
  created_at: string
  profile?: StaffProfile
}

/** Columns to select from profiles for a StaffProfile. */
export const STAFF_PROFILE_SELECT = 'id, email, full_name, role, is_active, phone'

export type PhotoType = 'before' | 'after'

export interface MaintenanceItemAttachment {
  id: string
  maintenance_item_id: string
  /** Storage path in the maintenance-attachments bucket (older rows may hold a full URL). */
  file_url: string
  file_type: string | null
  file_name: string | null
  uploaded_by: string
  /** 'before' = inspection photo, 'after' = completion photo, null = general attachment. */
  photo_type: PhotoType | null
  created_at: string
}

export interface ActivityLog {
  id: string
  maintenance_item_id: string
  action: string
  details: Record<string, unknown> | null
  performed_by: string
  created_at: string
}

export interface ContractorComment {
  id: string
  maintenance_item_id: string
  author: string
  content: string
  created_at: string
}

export interface ItemUpdate {
  id: string
  maintenance_item_id: string
  author: string
  content: string
  source: string
  email_message_id: string | null
  email_subject: string | null
  email_from: string | null
  email_to: string | null
  email_date: string | null
  status_from: string | null
  status_to: string | null
  created_at: string
}

export interface NotificationPreferences {
  id: string
  user_id: string
  contractor_complete_email: boolean
  contractor_comment_email: boolean
  maintenance_due_email: boolean
  /** Where this user's notifications go; null = their login email. */
  notify_email: string | null
  report_frequency: ReportFrequency
  report_scope: ReportScope
  report_projects: string[]
  /** Admins only: get contractor alerts for every project, not just items they are responsible for. */
  alerts_all_projects: boolean
  created_at: string
  updated_at: string
}
