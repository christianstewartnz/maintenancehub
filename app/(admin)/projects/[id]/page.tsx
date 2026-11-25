import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ProjectDetailClient from './ProjectDetailClient'
import ProjectDocuments from './ProjectDocuments'
import ProjectStaffCard from './ProjectStaffCard'
import { getSession, isAdmin } from '@/lib/auth'
import { fetchProjectStaff } from '@/lib/staff'
import { STAFF_PROFILE_SELECT, type StaffProfile } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const session = await getSession()
  const admin = isAdmin(session?.profile)

  const [projectRes, unitsRes, tradesRes, contractorsRes, assignmentsRes, workOrdersRes, projectStaff, peopleRes] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase.from('units').select('*, owners:unit_owners(id, name, email, phone, created_at)').eq('project_id', id),
    supabase.from('trades').select('*').eq('project_id', id).order('name'),
    supabase.from('contractors').select('*').order('company_name'),
    supabase.from('project_trade_assignments').select('*, trade:trades(*), contractor:contractors(*)').eq('project_id', id),
    supabase.from('work_orders').select('*, contractor:contractors(id, company_name)').eq('project_id', id).is('archived_at', null).order('created_at', { ascending: false }),
    fetchProjectStaff(supabase, [id]),
    // Who an admin can add to the Staff card.
    admin
      ? supabase.from('profiles').select(STAFF_PROFILE_SELECT).eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [] }),
  ])

  if (!projectRes.data) notFound()

  return (
    <div>
      <PageHeader
        backHref="/projects"
        title={projectRes.data.name}
        description={projectRes.data.address ?? undefined}
        breadcrumbs={[{ label: 'Projects', href: '/projects' }, { label: projectRes.data.name }]}
      />
      <ProjectDetailClient
        project={projectRes.data}
        units={(unitsRes.data ?? []).sort((a, b) => {
          const n = (v: string | null) => v ? parseInt(v.replace(/\D/g, ''), 10) || Infinity : Infinity
          return n(a.lot_number) - n(b.lot_number)
        })}
        trades={tradesRes.data ?? []}
        contractors={contractorsRes.data ?? []}
        assignments={assignmentsRes.data ?? []}
        workOrders={workOrdersRes.data ?? []}
        isAdmin={admin}
      />
      <ProjectStaffCard
        projectId={id}
        staff={projectStaff}
        canEdit={admin}
        people={(peopleRes.data ?? []) as StaffProfile[]}
      />
      <ProjectDocuments projectId={id} />
    </div>
  )
}
