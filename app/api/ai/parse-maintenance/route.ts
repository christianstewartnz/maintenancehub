import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'AI parsing is not configured (missing ANTHROPIC_API_KEY)' }, { status: 500 })
  }

  const { text, units, trades } = await req.json() as {
    text: string
    units: { id: string; unit_identifier: string; address: string | null }[]
    trades: { id: string; name: string }[]
  }

  if (!text?.trim()) {
    return Response.json({ error: 'No text provided' }, { status: 400 })
  }

  const unitList = units.map(u => `${u.unit_identifier}${u.address ? ` (${u.address})` : ''}`).join(', ')
  const tradeList = trades.map(t => t.name).join(', ')

  const prompt = `You are a maintenance coordinator parsing a free-text maintenance report into structured work items.

Available units: ${unitList || 'not specified'}
Available trades: ${tradeList || 'not specified'}

Parse the following text and return a JSON array of maintenance items. Each item must have:
- unit_hint: the unit identifier mentioned (match exactly to available units, or null if unclear)
- title: short title of the issue (max 60 chars)
- description: more detailed description (or null if none)
- trade_hint: the most likely trade from the available list (or null if unclear)
- priority: one of "low", "medium", "high", "urgent" based on urgency cues in the text

Return ONLY a valid JSON array, no other text.

Text to parse:
${text}`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const content = message.content[0]
  if (content.type !== 'text') {
    return Response.json({ error: 'Unexpected AI response' }, { status: 500 })
  }

  try {
    // Strip markdown code fences if present
    const raw = content.text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const items = JSON.parse(raw)
    return Response.json({ items })
  } catch {
    return Response.json({ error: 'Failed to parse AI response', raw: content.text }, { status: 500 })
  }
}
