import 'server-only'
import ExcelJS from 'exceljs'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import type { Artifact } from '@/lib/domain/schemas'
import { AGENCIES } from '@/lib/domain/seed-data'
import { findPolicy, syntheticClaims, syntheticPayments } from './data'

const RED = 'FFC8102E'

async function claimsWorkbook(a: Artifact, kind: 'claims' | 'payments'): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Generali Automation Control Center (DEMO)'
  wb.created = new Date(a.createdAt)
  const ws = wb.addWorksheet(kind === 'claims' ? 'Sinistri aperti' : 'Pagamenti')
  const agency = AGENCIES.find((x) => x.agencyId === a.agencyId)
  ws.addRow(['DEMO / SYNTHETIC DATA — Documento generato a scopo dimostrativo. Dati non reali.'])
  ws.mergeCells('A1:G1')
  ws.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } }
  ws.addRow([`Agenzia: ${a.agencyId} — ${agency?.agencyName ?? ''}`, '', '', `Periodo: ${a.params.periodLabel ?? ''}`, '', `Ticket: ${a.ticketId}`])
  ws.addRow([])
  const year = Number(a.params.year)
  const month = Number(a.params.month)
  if (kind === 'claims') {
    const header = ws.addRow(['Claim ID', 'Agency ID', 'Policy ID', 'Opening Date', 'Claim Type', 'Claim Status', 'Amount (EUR)'])
    header.font = { bold: true }
    for (const r of syntheticClaims(a.agencyId, year, month))
      ws.addRow([r.claimId, r.agencyId, r.policyId, r.openingDate, r.claimType, r.claimStatus, r.amount])
  } else {
    const header = ws.addRow(['Payment ID', 'Agency ID', 'Policy ID', 'Payment Date', 'Method', 'Status', 'Amount (EUR)'])
    header.font = { bold: true }
    for (const r of syntheticPayments(a.agencyId, year, month))
      ws.addRow([r.paymentId, r.agencyId, r.policyId, r.paymentDate, r.method, r.status, r.amount])
  }
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 30 : 16))
  ws.getColumn(7).numFmt = '#,##0.00'
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

async function pdfDocument(a: Artifact): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(a.fileName)
  doc.setCreator('Generali Automation Control Center (DEMO)')
  doc.setCreationDate(new Date(a.createdAt))
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const red = rgb(0.784, 0.063, 0.18)
  const dark = rgb(0.145, 0.145, 0.145)
  const grey = rgb(0.4, 0.44, 0.52)

  page.drawRectangle({ x: 0, y: 792, width: 595, height: 50, color: red })
  page.drawText('DEMO / SYNTHETIC DATA', { x: 40, y: 810, size: 16, font: bold, color: rgb(1, 1, 1) })
  page.drawText('DEMO - DATI SINTETICI', { x: 120, y: 380, size: 48, font: bold, color: rgb(0.95, 0.85, 0.87), rotate: degrees(35) })

  const agency = AGENCIES.find((x) => x.agencyId === a.agencyId)
  const lines: [string, string][] = []
  let title = ''
  if (a.kind === 'POLICY_PDF') {
    const p = findPolicy(String(a.params.policyId))
    title = `Copia polizza n. ${a.params.policyId}`
    lines.push(
      ['Contraente', p?.holder ?? 'N/D'],
      ['Prodotto', p?.product ?? 'N/D'],
      ['Premio annuo', p ? `EUR ${p.annualPremium.toFixed(2)}` : 'N/D'],
      ['Decorrenza', p?.startDate ?? 'N/D'],
      ['Scadenza', p?.endDate ?? 'N/D'],
    )
  } else if (a.kind === 'ACCESS_PDF') {
    title = 'Conferma abilitazione accesso'
    lines.push(['Accesso', String(a.params.requestedAccess ?? '')], ['Livello', String(a.params.accessLevel ?? '')])
  } else {
    title = 'Attestazione di copertura assicurativa'
    lines.push(['Oggetto', String(a.params.subject ?? 'Attestazione')])
  }
  lines.push(
    ['Agenzia', `${a.agencyId} — ${agency?.agencyName ?? ''}`],
    ['Ticket Remedy', a.ticketId],
    ['Workflow instance', a.instanceId],
    ['Revisione documento', String(a.revision)],
  )

  page.drawText(title, { x: 40, y: 740, size: 20, font: bold, color: dark })
  page.drawText('Generali Automation Control Center — ambiente dimostrativo', { x: 40, y: 718, size: 10, font, color: grey })
  let y = 680
  for (const [k, v] of lines) {
    page.drawText(k, { x: 40, y, size: 11, font: bold, color: dark })
    page.drawText(v, { x: 200, y, size: 11, font, color: dark })
    y -= 24
  }
  page.drawText(
    'Documento generato automaticamente con dati sintetici. Non ha valore contrattuale.',
    { x: 40, y: 60, size: 9, font, color: grey },
  )
  return doc.save()
}

export async function renderArtifact(a: Artifact): Promise<Uint8Array> {
  switch (a.kind) {
    case 'CLAIMS_XLSX':
      return claimsWorkbook(a, 'claims')
    case 'PAYMENTS_XLSX':
      return claimsWorkbook(a, 'payments')
    default:
      return pdfDocument(a)
  }
}
