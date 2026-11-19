import { formatUnitLabel } from '@/lib/utils'

export function maintenanceDueEmail(opts: {
  upcomingUnits: { unitId: string; hasOwnerEmail: boolean; unitLabel: string; projectName: string; settlementDate: string; dueDate: string; daysUntilDue: number }[]
  overdueUnits: { unitId: string; hasOwnerEmail: boolean; unitLabel: string; projectName: string; settlementDate: string; dueDate: string; daysOverdue: number }[]
  appUrl: string
}): { subject: string; html: string } {
  const { upcomingUnits, overdueUnits, appUrl } = opts

  // Downloads the owner reminder as an Outlook .eml (project documents attached).
  const draftCell = (u: { unitId: string; hasOwnerEmail: boolean }) => `
      <td style="padding: 8px 0 8px 12px; font-size: 13px; white-space: nowrap;">
        <a href="${appUrl}/api/maintenance-due/draft/${encodeURIComponent(u.unitId)}" style="color: #2383e2; text-decoration: none; font-weight: 500;">Draft email</a>${u.hasOwnerEmail ? '' : '<br><span style="color: #9b9a97; font-size: 11px;">no owner email</span>'}
      </td>`

  const upcomingRows = upcomingUnits.map(u => `
    <tr style="border-top: 1px solid #e9e9e7;">
      <td style="padding: 8px 12px 8px 0; font-size: 14px; font-weight: 500;">${esc(u.unitLabel)}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.projectName}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.settlementDate}</td>
      <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: ${u.daysUntilDue <= 3 ? '#eb5757' : '#d09c3a'};">${u.dueDate} (${u.daysUntilDue}d)</td>${draftCell(u)}
    </tr>
  `).join('')

  const overdueRows = overdueUnits.map(u => `
    <tr style="border-top: 1px solid #e9e9e7;">
      <td style="padding: 8px 12px 8px 0; font-size: 14px; font-weight: 500;">${esc(u.unitLabel)}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.projectName}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.settlementDate}</td>
      <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: #eb5757;">${u.dueDate} (${u.daysOverdue}d overdue)</td>${draftCell(u)}
    </tr>
  `).join('')

  const totalCount = upcomingUnits.length + overdueUnits.length
  const subjectParts = []
  if (overdueUnits.length > 0) subjectParts.push(`${overdueUnits.length} overdue`)
  if (upcomingUnits.length > 0) subjectParts.push(`${upcomingUnits.length} upcoming`)

  return {
    subject: `Maintenance forms due — ${subjectParts.join(', ')} (${totalCount} unit${totalCount !== 1 ? 's' : ''})`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 640px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">3-Month Maintenance Forms Due</h2>
        <p style="color: #787774; margin-top: 0;">Units approaching or past their 90-day defect maintenance date</p>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />

        ${overdueUnits.length > 0 ? `
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #eb5757;">Overdue — Last 7 Days (${overdueUnits.length})</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Unit</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Project</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Settlement</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Due Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${overdueRows}</tbody>
        </table>
        ` : ''}

        ${upcomingUnits.length > 0 ? `
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #d09c3a;">Upcoming — Next 28 Days (${upcomingUnits.length})</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Unit</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Project</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Settlement</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Due Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${upcomingRows}</tbody>
        </table>
        ` : ''}

        <a href="${appUrl}/projects" style="display: inline-block; background: #2383e2; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">Open Maintenance Hub</a>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
        <p style="color: #787774; font-size: 12px;">Sent weekly when maintenance forms are due within 28 days or up to 7 days overdue. “Draft email” downloads the owner reminder — open it in Outlook, check it and send · Maintenance Hub</p>
      </div>
    `,
  }
}

function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Trimmed owners with a name, so blank rows don't print an empty "Owner:" line. */
function ownerLines(owners: { name: string; email: string | null; phone: string | null }[] | undefined) {
  return (owners ?? [])
    .map(o => ({ name: o.name?.trim() ?? '', phone: o.phone?.trim() || null, email: o.email?.trim() || null }))
    .filter(o => o.name)
}

export function contractorNewItemsEmail(opts: {
  contractorName: string
  contactName: string | null
  items: {
    itemNumber: string
    title: string
    unitIdentifier: string | null
    address: string | null
    projectName: string | null
    owners?: { name: string; email: string | null; phone: string | null }[]
  }[]
  portalUrl: string
  /** The staff member who clicked Notify; shown as the sign-off. */
  sender?: { name: string | null; email: string | null }
}): { subject: string; html: string; text: string } {
  const { contractorName, contactName, items, portalUrl, sender } = opts
  const n = items.length
  const senderName = sender?.name?.trim() || null
  const senderEmail = sender?.email?.trim() || null
  const hasSignOff = !!(senderName || senderEmail)

  // Group by project so a contractor working across sites can scan it quickly.
  const byProject = new Map<string, typeof items>()
  for (const i of items) {
    const key = i.projectName ?? 'Other'
    if (!byProject.has(key)) byProject.set(key, [])
    byProject.get(key)!.push(i)
  }

  const sections = Array.from(byProject.entries()).map(([project, list]) => `
    <h3 style="margin: 20px 0 8px; font-size: 15px;">${esc(project)}</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      ${list.map(i => `
        <tr style="border-top: 1px solid #e9e9e7;">
          <td style="padding: 8px 12px 8px 0; color: #787774; font-size: 13px; white-space: nowrap; vertical-align: top;">${esc(i.itemNumber)}</td>
          <td style="padding: 8px 12px 8px 0; vertical-align: top;">${esc(i.title)}</td>
          <td style="padding: 8px 0; color: #787774; font-size: 13px; vertical-align: top;">
            ${i.unitIdentifier?.trim() && i.address?.trim()
              ? `${esc(i.unitIdentifier.trim())}<br>${esc(i.address.trim())}`
              : esc(formatUnitLabel({ unit_identifier: i.unitIdentifier, address: i.address }))}
            ${ownerLines(i.owners).map(o => `
              <div style="margin-top: 6px; color: #37352f;">Owner: ${esc(o.name)}${o.phone ? ` · <a href="tel:${esc(o.phone.replace(/\s+/g, ''))}" style="color: #2383e2;">${esc(o.phone)}</a>` : ''}${o.email ? `<br><a href="mailto:${esc(o.email)}" style="color: #2383e2;">${esc(o.email)}</a>` : ''}</div>
            `).join('')}
          </td>
        </tr>
      `).join('')}
    </table>
  `).join('')

  const text = [
    `Hi ${contactName || contractorName},`,
    '',
    `You have ${n} new item${n !== 1 ? 's' : ''} assigned to you. Full details, site access contacts and photos are on your portal:`,
    portalUrl,
    ...Array.from(byProject.entries()).flatMap(([project, list]) => [
      '',
      project,
      ...list.flatMap(i => [
        `  ${i.itemNumber}  ${i.title}${i.unitIdentifier?.trim() || i.address?.trim() ? `  (${formatUnitLabel({ unit_identifier: i.unitIdentifier, address: i.address }, '', ', ')})` : ''}`,
        ...ownerLines(i.owners).map(o => `      Owner: ${[o.name, o.phone, o.email].filter(Boolean).join(' · ')}`),
      ]),
    ]),
    '',
    'Your portal always shows every open job assigned to you. Please update each item there as you schedule and complete the work.',
    ...(hasSignOff ? ['', 'Thanks,', ...(senderName ? [senderName] : []), ...(senderEmail ? [senderEmail] : [])] : []),
  ].join('\n')

  return {
    subject: `Stratum Maintenance Hub: ${n} new maintenance item${n !== 1 ? 's' : ''} for ${contractorName}`,
    text,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 640px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">New Maintenance Items</h2>
        <p style="color: #787774; margin-top: 0;">${esc(contractorName)}</p>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />
        <p>Hi ${esc(contactName || contractorName)},</p>
        <p>You have <strong>${n} new item${n !== 1 ? 's' : ''}</strong> assigned to you. Full details, site access contacts and photos are on your portal.</p>
        <a href="${esc(portalUrl)}" style="display: inline-block; background: #2383e2; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; margin: 8px 0 4px;">Open your jobs</a>
        ${sections}
        ${hasSignOff ? `
        <p style="margin: 24px 0 0;">Thanks,<br>
          ${senderName ? `<strong>${esc(senderName)}</strong><br>` : ''}
          ${senderEmail ? `<a href="mailto:${esc(senderEmail)}" style="color: #2383e2;">${esc(senderEmail)}</a>` : ''}
        </p>
        ` : ''}
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
        <p style="color: #787774; font-size: 13px;">Your portal always shows every open job assigned to you. Please update each item there as you schedule and complete the work.<br>
          <a href="${esc(portalUrl)}" style="color: #2383e2;">${esc(portalUrl)}</a>
        </p>
      </div>
    `,
  }
}

export function contractorCompleteEmail(opts: {
  itemTitle: string
  itemNumber: string
  /** Pre-formatted with formatUnitLabel (unit number + address). */
  unitLabel: string
  projectName: string
  contractorName: string
  appUrl: string
  itemId: string
}): { subject: string; html: string } {
  const { itemTitle, itemNumber, unitLabel, projectName, contractorName, appUrl, itemId } = opts
  return {
    subject: `Ready for inspection — ${itemNumber} ${itemTitle} (${unitLabel})`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">Work Ready for Inspection</h2>
        <p style="color: #787774; margin-top: 0;">${projectName} · ${unitLabel}</p>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />
        <p><strong>${contractorName}</strong> has marked the following item as complete and ready for your inspection:</p>
        <div style="background: #f7f7f5; border-radius: 6px; padding: 14px 18px; margin: 16px 0;">
          <p style="margin: 0 0 4px; font-weight: 600;">${itemNumber} — ${itemTitle}</p>
          <p style="margin: 0; color: #787774; font-size: 13px;">${unitLabel} · ${projectName}</p>
        </div>
        <a href="${appUrl}/maintenance/${itemId}" style="display: inline-block; background: #2383e2; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 8px;">View Item</a>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
        <p style="color: #787774; font-size: 13px;">You can confirm completion or request further work from the item detail page.</p>
      </div>
    `,
  }
}

export function contractorCommentEmail(opts: {
  itemTitle: string
  itemNumber: string
  /** Pre-formatted with formatUnitLabel (unit number + address). */
  unitLabel: string
  projectName: string
  contractorName: string
  commentText: string
  appUrl: string
  itemId: string
}): { subject: string; html: string } {
  const { itemTitle, itemNumber, unitLabel, projectName, contractorName, commentText, appUrl, itemId } = opts
  return {
    subject: `New comment from ${contractorName} — ${itemNumber} (${unitLabel})`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">New Contractor Comment</h2>
        <p style="color: #787774; margin-top: 0;">${projectName} · ${unitLabel}</p>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />
        <p><strong>${contractorName}</strong> left a comment on <strong>${itemNumber} — ${itemTitle}</strong>:</p>
        <blockquote style="margin: 0; padding: 12px 16px; background: #f7f7f5; border-left: 3px solid #e9e9e7; border-radius: 0 6px 6px 0; white-space: pre-wrap; font-size: 14px;">${commentText}</blockquote>
        <a href="${appUrl}/maintenance/${itemId}" style="display: inline-block; background: #2383e2; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 20px;">View Item</a>
      </div>
    `,
  }
}

export function reportEmail(opts: {
  reportTitle: string
  periodLabel: string
  stats: { label: string; value: number; color?: string }[]
  overdueItems: { title: string; itemNumber: string; unitLabel: string; projectName: string; daysSince: number }[]
  recentlyCompleted: { title: string; itemNumber: string; unitLabel: string; projectName: string }[]
  appUrl: string
}): { subject: string; html: string } {
  const { reportTitle, periodLabel, stats, overdueItems, recentlyCompleted, appUrl } = opts

  const statsHtml = stats.map(s => `
    <td style="text-align: center; padding: 12px 16px;">
      <div style="font-size: 28px; font-weight: 700; color: ${s.color ?? '#37352f'};">${s.value}</div>
      <div style="font-size: 12px; color: #787774; margin-top: 4px;">${s.label}</div>
    </td>
  `).join('')

  const overdueHtml = overdueItems.length === 0
    ? '<p style="color: #787774; font-size: 14px;">No overdue items.</p>'
    : overdueItems.map(i => `
      <tr style="border-top: 1px solid #e9e9e7;">
        <td style="padding: 8px 0; font-size: 14px;">${i.itemNumber} — ${i.title}</td>
        <td style="padding: 8px 0; font-size: 13px; color: #787774;">${i.projectName} · ${i.unitLabel}</td>
        <td style="padding: 8px 0; font-size: 13px; color: #eb5757; text-align: right;">${i.daysSince}d</td>
      </tr>
    `).join('')

  const completedHtml = recentlyCompleted.length === 0
    ? '<p style="color: #787774; font-size: 14px;">No items completed this period.</p>'
    : recentlyCompleted.map(i => `
      <tr style="border-top: 1px solid #e9e9e7;">
        <td style="padding: 8px 0; font-size: 14px;">${i.itemNumber} — ${i.title}</td>
        <td style="padding: 8px 0; font-size: 13px; color: #787774;">${i.projectName} · ${i.unitLabel}</td>
      </tr>
    `).join('')

  return {
    subject: `${reportTitle} — ${periodLabel}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 640px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">${reportTitle}</h2>
        <p style="color: #787774; margin-top: 0;">${periodLabel}</p>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />

        <table style="width: 100%; border-collapse: collapse; background: #f7f7f5; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
          <tr>${statsHtml}</tr>
        </table>

        ${overdueItems.length > 0 ? `
        <h3 style="margin: 0 0 12px; font-size: 15px;">Overdue Items</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          ${overdueHtml}
        </table>
        ` : ''}

        ${recentlyCompleted.length > 0 ? `
        <h3 style="margin: 0 0 12px; font-size: 15px;">Completed This Period</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          ${completedHtml}
        </table>
        ` : ''}

        <a href="${appUrl}/dashboard" style="display: inline-block; background: #2383e2; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">Open Dashboard</a>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
        <p style="color: #787774; font-size: 12px;">Maintenance Hub · <a href="${appUrl}/settings" style="color: #787774;">Manage report settings</a></p>
      </div>
    `,
  }
}
