import PDFDocument from 'pdfkit'

export async function generateWorkOrderPDF(workOrder: any, items: any[]): Promise<Buffer> {
  const project = workOrder.project as any
  const contractor = workOrder.contractor as any

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const DARK = '#37352f'
    const GRAY = '#787774'
    const LINE = '#e9e9e7'
    const LEFT = 50
    const RIGHT = 545

    function divider() {
      doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(LINE).lineWidth(0.5).stroke()
      doc.moveDown(0.6)
    }

    function sectionLabel(text: string) {
      doc.fontSize(9).fillColor(GRAY).text(text.toUpperCase(), { characterSpacing: 0.8 })
      doc.moveDown(0.15)
    }

    // ── Header ──────────────────────────────────────────────────────
    doc.fontSize(22).fillColor(DARK).text(workOrder.work_order_number)
    doc.fontSize(11).fillColor(GRAY).text(
      `Date: ${new Date(workOrder.created_at).toLocaleDateString('en-NZ', {
        day: 'numeric', month: 'long', year: 'numeric',
      })}`,
    )
    doc.moveDown(0.8)
    divider()

    // ── Project ──────────────────────────────────────────────────────
    sectionLabel('Project')
    doc.fontSize(13).fillColor(DARK).text(project?.name ?? '')
    if (project?.address) doc.fontSize(10).fillColor(GRAY).text(project.address)
    doc.moveDown(0.8)

    // ── Contractor ───────────────────────────────────────────────────
    sectionLabel('Contractor')
    doc.fontSize(13).fillColor(DARK).text(contractor?.company_name ?? '')
    if (contractor?.contact_name) doc.fontSize(10).fillColor(GRAY).text(`Contact: ${contractor.contact_name}`)
    if (contractor?.email) doc.fontSize(10).fillColor(GRAY).text(`Email: ${contractor.email}`)
    if (contractor?.phone) doc.fontSize(10).fillColor(GRAY).text(`Phone: ${contractor.phone}`)
    doc.moveDown(0.8)
    divider()

    // ── Items ─────────────────────────────────────────────────────────
    doc.fontSize(13).fillColor(DARK).text(`Maintenance Items (${items.length})`)
    doc.moveDown(0.6)

    for (const item of items) {
      if (doc.y > 700) doc.addPage()

      const unit = item.unit as any
      const tradeName: string = item.trade?.name ?? ''
      const priority: string = item.priority
        ? item.priority.charAt(0).toUpperCase() + item.priority.slice(1)
        : ''

      doc.fontSize(12).fillColor(DARK).text(`${item.item_number}  —  ${item.title}`)

      if (unit) {
        doc.fontSize(10).fillColor(GRAY)
        const unitLine = unit.lot_number
          ? `Unit ${unit.unit_identifier} · Lot ${unit.lot_number}`
          : `Unit ${unit.unit_identifier}`
        doc.text(unitLine, { indent: 12 })
        if (unit.address) doc.text(`Address: ${unit.address}`, { indent: 12 })
        if (unit.owner_name) {
          doc.text(
            `Owner: ${unit.owner_name}${unit.owner_phone ? `  ·  ${unit.owner_phone}` : ''}`,
            { indent: 12 },
          )
        }
        if (unit.access_contact_name) {
          doc.text(
            `Access: ${unit.access_contact_name}${unit.access_contact_phone ? `  ·  ${unit.access_contact_phone}` : ''}`,
            { indent: 12 },
          )
        }
      }

      const meta = [tradeName, priority].filter(Boolean).join('  ·  ')
      if (meta) doc.fontSize(10).fillColor(GRAY).text(meta, { indent: 12 })

      if (item.description) {
        doc.moveDown(0.3)
        doc.fontSize(10).fillColor(DARK).text(item.description, { indent: 20 })
      }

      doc.moveDown(0.5)
      divider()
    }

    // ── Notes ─────────────────────────────────────────────────────────
    if (workOrder.notes) {
      sectionLabel('Notes / Instructions')
      doc.fontSize(11).fillColor(DARK).text(workOrder.notes)
      doc.moveDown(0.8)
    }

    doc.end()
  })
}
