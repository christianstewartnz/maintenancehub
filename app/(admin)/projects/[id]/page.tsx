import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/layout/PageHeader'
import ProjectDetailClient from './ProjectDetailClient'

export const dynamic = 'force-dynamic'

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [projectRes, unitsRes, tradesRes, contractorsRes, assignmentsRes, workOrdersRes] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase.from('units').select('*').eq('project_id', id),
    supabase.from('trades').select('*').eq('project_id', id).order('name'),
    supabase.from('contractors').select('*').order('company_name'),
    supabase.from('project_trade_assignments').select('*, trade:trades(*), contractor:contractors(*)').eq('project_id', id),
    supabase.from('work_orders').select('*, contractor:contractors(id, company_name)').eq('project_id', id).order('created_at', { ascending: false }),
  ])

  if (!projectRes.data) notFound()

  return (
    <div>
      <PageHeader
        emoji="🏗️"
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
      />
    </div>
  )
}
