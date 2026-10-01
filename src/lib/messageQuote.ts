export type MessageQuoteSpeaker = 'user' | 'assistant'

export interface MessageQuote {
  speaker: MessageQuoteSpeaker
  text: string
}

export interface ParsedQuotedMessage {
  quote: MessageQuote | null
  body: string
}

const USER_MARKER = '[ME]'
const ASSISTANT_MARKER = '[TA]'

function markerOf(speaker: MessageQuoteSpeaker): string {
  return speaker === 'user' ? USER_MARKER : ASSISTANT_MARKER
}

/**
 * Quote is stored inside normal message content so it survives the existing session API unchanged.
 * The stable first-line marker lets current clients render it as a quote and lets evidence detectors
 * strip it without guessing from arbitrary user-typed markdown.
 */
export function formatQuotedMessage(quote: MessageQuote, body: string): string {
  const quoteText = String(quote?.text ?? '').trim()
  const messageBody = String(body ?? '').trim()
  if (!quoteText) return messageBody
  const lines = quoteText.split(/\r?\n/).map((line) => line.trimEnd())
  const first = `> ${markerOf(quote.speaker)} ${lines[0] ?? ''}`.trimEnd()
  const rest = lines.slice(1).map((line) => `> ${line}`)
  const block = [first, ...rest].join('\n')
  return messageBody ? `${block}\n\n${messageBody}` : block
}

export function parseQuotedMessage(content: string): ParsedQuotedMessage {
  const text = String(content ?? '')
  const lines = text.split(/\r?\n/)
  if (lines.length === 0) return { quote: null, body: text }

  const first = lines[0]
  let speaker: MessageQuoteSpeaker | null = null
  let firstText = ''
  if (first.startsWith(`> ${USER_MARKER} `)) {
    speaker = 'user'
    firstText = first.slice(`> ${USER_MARKER} `.length)
  } else if (first === `> ${USER_MARKER}`) {
    speaker = 'user'
  } else if (first.startsWith(`> ${ASSISTANT_MARKER} `)) {
    speaker = 'assistant'
    firstText = first.slice(`> ${ASSISTANT_MARKER} `.length)
  } else if (first === `> ${ASSISTANT_MARKER}`) {
    speaker = 'assistant'
  } else {
    return { quote: null, body: text }
  }

  const quoteLines = [firstText]
  let index = 1
  while (index < lines.length && lines[index].startsWith('> ')) {
    quoteLines.push(lines[index].slice(2))
    index += 1
  }

  if (index < lines.length && lines[index] === '') index += 1

  return {
    quote: {
      speaker,
      text: quoteLines.join('\n').trim(),
    },
    body: lines.slice(index).join('\n').trim(),
  }
}

/** The user's newly asserted text only; quoted prior text is context, never new evidence. */
export function messageEvidenceText(content: string): string {
  const parsed = parseQuotedMessage(content)
  return parsed.quote ? parsed.body : String(content ?? '').trim()
}
