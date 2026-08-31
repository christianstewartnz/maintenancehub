import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/layout/PageHeader'
import SignOffClient from './SignOffClient'

export const dynamic = 'force-dynamic'

export default async function SignOffPage() {
  const supabase = await createClient()

  const { data: items } = await supabase
    .from('maintenance_items')
    .select(`
      id, item_number, title, priority, created_at, updated_at, contractor_id,
      unit:units(id, unit_identifier, address, project:projects(id, name)),
      contractor:contractors(id, company_name, contact_name, email)
    `)
    .eq('status', 'contractor_complete')
    .order('updated_at', { ascending: true })

  const itemIds = (items ?? []).map(i => i.id)

  const { data: comments } = itemIds.length
    ? await supabase
        .from('contractor_comments')
        .select('id, maintenance_item_id, author, content, created_at')
        .in('maintenance_item_id', itemIds)
        .order('created_at', { ascending: false })
    : { data: [] }

  const lastCommentMap = new Map<string, typeof comments extends (infer T)[] | null ? T : never>()
  for (const c of comments ?? []) {
    if (!lastCommentMap.has(c.maintenance_item_id)) lastCommentMap.set(c.maintenance_item_id, c)
  }

  const enriched = (items ?? []).map(item => ({
    ...item,
    lastComment: lastCommentMap.get(item.id) ?? null,
  }))

  return (
    <div>
      <PageHeader
        emoji="✅"
        title="Sign-off Queue"
        description={
          enriched.length === 0
            ? 'No items awaiting confirmation'
            : `${enriched.length} item${enriched.length !== 1 ? 's' : ''} awaiting confirmation — oldest first`
        }
      />
      <SignOffClient items={enriched} />
    </div>
  )
}
