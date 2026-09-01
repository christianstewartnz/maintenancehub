export type ProjectStatus = 'active' | 'archived'
export type MaintenanceStatus = 'logged' | 'assigned' | 'in_progress' | 'contractor_complete' | 'confirmed' | 'complete'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type WorkOrderStatus = 'draft' | 'sent' | 'in_progress' | 'complete'
export type ReportFrequency = 'daily' | 'weekly' | 'none'
export type ReportScope = 'all_projects' | 'per_project'

export interface Project {
  id: string
  name: string
  address: string | null
  description: string | null
  status: ProjectStatus
  created_at: string
  updated_at: string
}

export interface Unit {
  id: string
  project_id: string
  unit_identifier: string
  lot_number: string | null
  address: string | null
  owner_name: string | null
  owner_email: string | null
  owner_phone: string | null
  access_contact_name: string | null
  access_contact_email: string | null
  access_contact_phone: string | null
  settlement_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
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
  priority: Priority
  contractor_id: string | null
  work_order_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  unit?: Unit & { project?: Project }
  trade?: Trade
  contractor?: Contractor
  work_order?: WorkOrder
}

export interface MaintenanceItemAttachment {
  id: string
  maintenance_item_id: string
  file_url: string
  file_type: string | null
  file_name: string | null
  uploaded_by: string
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

export interface NotificationPreferences {
  id: string
  user_id: string
  contractor_complete_email: boolean
  contractor_comment_email: boolean
  report_frequency: ReportFrequency
  report_scope: ReportScope
  report_projects: string[]
  created_at: string
  updated_at: string
}
