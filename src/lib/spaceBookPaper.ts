/** Display-only physical pagination. Every source character survives; no
 * thought is edited, shortened, persisted or manufactured by the renderer. */
export interface SpaceBookLeaf { thoughtId: string; date: number; lines: string[]; text: string; number: number }
export function paginateSpaceThoughts(items: readonly { id: string; text: string; createdAt: number }[], columns = 10, rows = 8): SpaceBookLeaf[] {
  if (!Number.isFinite(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) throw new RangeError('Invalid paper dimensions')
  const pages: SpaceBookLeaf[] = []
  for (const item of items) {
    const lines: string[] = []; let line = '', width = 0
    for (const char of Array.from(item.text)) {
      if (char === '\n') { lines.push(line + char); line = ''; width = 0; continue }
      const units = char.charCodeAt(0) < 128 ? .55 : 1
      if (line && width + units > columns) { lines.push(line); line = ''; width = 0 }
      line += char; width += units
    }
    if (line) lines.push(line)
    if (!lines.length) lines.push('')
    for (let index = 0; index < lines.length; index += rows) {
      const slice = lines.slice(index, index + rows)
      pages.push({ thoughtId: item.id, date: item.createdAt, lines: slice, text: slice.join(''), number: pages.length + 1 })
    }
  }
  return pages
}

/** A bent sheet rotates progressively along its width instead of as a card. */
export function spacePaperCurl(progress: number, strips = 24): readonly { x: number; lift: number; back: boolean }[] {
  const p = Math.max(0, Math.min(1, progress)), theta = Math.PI * p
  const bend = Math.sin(theta) * .48
  const points = [{ x: 0, lift: 0, back: theta > Math.PI / 2 }]
  let x = 0, lift = 0
  for (let i = 1; i <= strips; i++) {
    const angle = theta + bend * Math.sin(Math.PI * (i - .5) / strips)
    x += Math.cos(angle) / strips; lift += Math.sin(angle) / strips
    points.push({ x, lift, back: angle > Math.PI / 2 })
  }
  return points
}

/** Quiet local paper rustle, only from an explicit page-turn gesture. */
export function playSpacePaperSound(): void {
  const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Audio) return
  try {
    const context = new Audio(), buffer = context.createBuffer(1, Math.floor(context.sampleRate * .22), context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (.6 + .4 * Math.sin(i * .003))
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain()
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 1300
    gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(.035, context.currentTime + .04); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .21)
    source.connect(filter).connect(gain).connect(context.destination)
    source.onended = () => { void context.close().catch(() => {}) }
    void context.resume().then(() => source.start()).catch(() => context.close().catch(() => {}))
  } catch { /* Reading remains usable when audio is not supported. */ }
}
