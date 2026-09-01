export function maintenanceDueEmail(opts: {
  upcomingUnits: { unitIdentifier: string; projectName: string; settlementDate: string; dueDate: string; daysUntilDue: number }[]
  overdueUnits: { unitIdentifier: string; projectName: string; settlementDate: string; dueDate: string; daysOverdue: number }[]
  appUrl: string
}): { subject: string; html: string } {
  const { upcomingUnits, overdueUnits, appUrl } = opts

  const upcomingRows = upcomingUnits.map(u => `
    <tr style="border-top: 1px solid #e9e9e7;">
      <td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${u.unitIdentifier}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.projectName}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.settlementDate}</td>
      <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: ${u.daysUntilDue <= 3 ? '#eb5757' : '#d09c3a'};">${u.dueDate} (${u.daysUntilDue}d)</td>
    </tr>
  `).join('')

  const overdueRows = overdueUnits.map(u => `
    <tr style="border-top: 1px solid #e9e9e7;">
      <td style="padding: 8px 0; font-size: 14px; font-weight: 500;">${u.unitIdentifier}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.projectName}</td>
      <td style="padding: 8px 0; font-size: 13px; color: #787774;">${u.settlementDate}</td>
      <td style="padding: 8px 0; font-size: 13px; font-weight: 600; color: #eb5757;">${u.dueDate} (${u.daysOverdue}d overdue)</td>
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
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #eb5757;">Overdue (${overdueUnits.length})</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Unit</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Project</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Settlement</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Due Date</th>
            </tr>
          </thead>
          <tbody>${overdueRows}</tbody>
        </table>
        ` : ''}

        ${upcomingUnits.length > 0 ? `
        <h3 style="margin: 0 0 12px; font-size: 15px; color: #d09c3a;">Upcoming — Next 14 Days (${upcomingUnits.length})</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Unit</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Project</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Settlement</th>
              <th style="text-align: left; font-size: 12px; color: #787774; padding-bottom: 6px;">Due Date</th>
            </tr>
          </thead>
          <tbody>${upcomingRows}</tbody>
        </table>
        ` : ''}

        <a href="${appUrl}/projects" style="display: inline-block; background: #2383e2; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">Open Maintenance Hub</a>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 24px 0;" />
        <p style="color: #787774; font-size: 12px;">Sent daily when maintenance forms are due within 14 days or overdue · Maintenance Hub</p>
      </div>
    `,
  }
}

export function contractorCompleteEmail(opts: {
  itemTitle: string
  itemNumber: string
  unitIdentifier: string
  projectName: string
  contractorName: string
  appUrl: string
  itemId: string
}): { subject: string; html: string } {
  const { itemTitle, itemNumber, unitIdentifier, projectName, contractorName, appUrl, itemId } = opts
  return {
    subject: `Ready for inspection — ${itemNumber} ${itemTitle}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">Work Ready for Inspection</h2>
        <p style="color: #787774; margin-top: 0;">${projectName} · Unit ${unitIdentifier}</p>
        <hr style="border: none; border-top: 1px solid #e9e9e7; margin: 20px 0;" />
        <p><strong>${contractorName}</strong> has marked the following item as complete and ready for your inspection:</p>
        <div style="background: #f7f7f5; border-radius: 6px; padding: 14px 18px; margin: 16px 0;">
          <p style="margin: 0 0 4px; font-weight: 600;">${itemNumber} — ${itemTitle}</p>
          <p style="margin: 0; color: #787774; font-size: 13px;">Unit ${unitIdentifier} · ${projectName}</p>
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
  unitIdentifier: string
  projectName: string
  contractorName: string
  commentText: string
  appUrl: string
  itemId: string
}): { subject: string; html: string } {
  const { itemTitle, itemNumber, unitIdentifier, projectName, contractorName, commentText, appUrl, itemId } = opts
  return {
    subject: `New comment from ${contractorName} — ${itemNumber}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #37352f;">
        <h2 style="margin-bottom: 4px;">New Contractor Comment</h2>
        <p style="color: #787774; margin-top: 0;">${projectName} · Unit ${unitIdentifier}</p>
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
  overdueItems: { title: string; itemNumber: string; unitIdentifier: string; projectName: string; daysSince: number }[]
  recentlyCompleted: { title: string; itemNumber: string; unitIdentifier: string; projectName: string }[]
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
        <td style="padding: 8px 0; font-size: 13px; color: #787774;">${i.projectName} · ${i.unitIdentifier}</td>
        <td style="padding: 8px 0; font-size: 13px; color: #eb5757; text-align: right;">${i.daysSince}d</td>
      </tr>
    `).join('')

  const completedHtml = recentlyCompleted.length === 0
    ? '<p style="color: #787774; font-size: 14px;">No items completed this period.</p>'
    : recentlyCompleted.map(i => `
      <tr style="border-top: 1px solid #e9e9e7;">
        <td style="padding: 8px 0; font-size: 14px;">${i.itemNumber} — ${i.title}</td>
        <td style="padding: 8px 0; font-size: 13px; color: #787774;">${i.projectName} · ${i.unitIdentifier}</td>
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
