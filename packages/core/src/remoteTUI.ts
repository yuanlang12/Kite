// ─── Classic Macintosh CRT TUI for remote mode ───────────────────────────────

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const BRIGHT_GREEN = '\x1b[92m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const GRAY = '\x1b[90m'
const MAGENTA = '\x1b[35m'

interface LogEntry {
  time: string
  icon: string
  text: string
}

export class RemoteTUI {
  private logs: LogEntry[] = []
  private maxLogs = 100
  private isActive = false

  start() {
    this.isActive = true
    this.logs = []
    process.stdout.write('\x1b[?1049h')
    process.stdout.write('\x1b[?25l')
    this.render()
    process.stdout.on('resize', this.onResize)
  }

  stop() {
    this.isActive = false
    process.stdout.removeListener('resize', this.onResize)
    process.stdout.write('\x1b[?25h')
    process.stdout.write('\x1b[?1049l')
  }

  addMessage(from: string, text: string) {
    this.log('◆', `${CYAN}${from}${RESET}: ${text}`)
  }

  addThinking() {
    this.log('◈', `${YELLOW}Claude is thinking...${RESET}`)
  }

  addResponse(preview: string) {
    this.log('◇', `${GREEN}Response sent${RESET} ${DIM}${preview}${RESET}`)
  }

  addError(text: string) {
    this.log('✖', `${YELLOW}${text}${RESET}`)
  }

  addInfo(text: string) {
    this.log('·', `${DIM}${text}${RESET}`)
  }

  private onResize = () => {
    if (this.isActive) this.render()
  }

  private log(icon: string, text: string) {
    const sanitized = text.replace(/[\n\r]/g, ' ')
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    this.logs.push({ time, icon, text: sanitized })
    if (this.logs.length > this.maxLogs) this.logs.shift()
    if (this.isActive) this.render()
  }

  private render() {
    const cols = process.stdout.columns || 80
    const rows = process.stdout.rows || 24

    // Layout: every line must be exactly `cols` display columns
    //
    // Screen content line:
    //   ║ <sp> ░ │ <content padded to screenW cols> │ ░ <sp> ║
    //   1 + sp + 1 + 1 + screenW + 1 + 1 + sp + 1 = screenW + 2*sp + 6
    //
    // Bezel line:
    //   ║ <sp> ░×bezelW <sp> ║
    //   bezelW = screenW + 4

    const sp = 2
    const screenW = cols - (2 * sp) - 6
    const bezelW = screenW + 4

    process.stdout.write('\x1b[2J\x1b[H')

    const lines: string[] = []
    const C = `${GRAY}║${RESET}`
    const B = `${DIM}░${RESET}`
    const pad = ' '.repeat(sp)

    // Fixed rows: top(5) + bottom(4) + chin(6) = 15
    // top: casing + bezel + screen border + title + separator = 5
    // bottom: footer sep + footer + screen border + bezel = 4
    // chin: bezel + logo×3 + blank + casing bottom = 6
    const chinHeight = 6
    const fixedRows = 5 + 4 + chinHeight
    const screenHeight = Math.max(1, rows - fixedRows)

    // ── Casing top ──
    lines.push(`${GRAY}╔${'═'.repeat(cols - 2)}╗${RESET}`)

    // ── Bezel top ──
    lines.push(`${C}${pad}${B.repeat(bezelW)}${pad}${C}`)

    // ── Screen top + title ──
    lines.push(`${C}${pad}${B}${BOLD}┌${'─'.repeat(screenW)}┐${RESET}${B}${pad}${C}`)
    const titleL = '● ○ ○  Kite Remote Console'
    const statusR = `${BRIGHT_GREEN}●${RESET} ON`
    const statusCols = 4
    const titleGap = Math.max(0, screenW - displayWidth(titleL) - statusCols - 2)
    lines.push(`${C}${pad}${B}│ ${titleL}${' '.repeat(titleGap)}${statusR} │${B}${pad}${C}`)
    lines.push(`${C}${pad}${B}${BOLD}├${'─'.repeat(screenW)}┤${RESET}${B}${pad}${C}`)

    // ── Screen content ──
    const visible = this.logs.slice(-screenHeight)
    for (let i = 0; i < screenHeight; i++) {
      const entry = visible[i]
      if (entry) {
        const raw = ` ${GRAY}${entry.time}${RESET} ${entry.icon} ${entry.text}`
        const rawW = displayWidthAnsi(raw)
        if (rawW >= screenW) {
          const truncated = truncateToWidth(raw, screenW - 2)
          const truncW = displayWidthAnsi(truncated)
          lines.push(`${C}${pad}${B}│${truncated}${' '.repeat(Math.max(0, screenW - truncW))}${RESET}│${B}${pad}${C}`)
        } else {
          lines.push(`${C}${pad}${B}│${raw}${' '.repeat(screenW - rawW)}${RESET}│${B}${pad}${C}`)
        }
      } else {
        lines.push(`${C}${pad}${B}│${' '.repeat(screenW)}│${B}${pad}${C}`)
      }
    }

    // ── Footer ──
    lines.push(`${C}${pad}${B}${BOLD}├${'─'.repeat(screenW)}┤${RESET}${B}${pad}${C}`)
    const footer = ' ⏎ Press Enter to return to terminal'
    const footerW = displayWidth(footer)
    lines.push(`${C}${pad}${B}│${DIM}${footer}${' '.repeat(Math.max(0, screenW - footerW))}${RESET}│${B}${pad}${C}`)

    // ── Screen bottom + bezel ──
    lines.push(`${C}${pad}${B}${BOLD}└${'─'.repeat(screenW)}┘${RESET}${B}${pad}${C}`)
    lines.push(`${C}${pad}${B.repeat(bezelW)}${pad}${C}`)

    // ── Chin: large ASCII art logo ──
    lines.push(`${C}${pad}${B.repeat(bezelW)}${pad}${C}`)
    lines.push(`${C}${' '.repeat(cols - 2)}${C}`)
    const logoLines = [
      '╦╔═  ╦  ╔╦╗  ╔═╗',
      '╠╩╗  ║   ║   ╠╡',
      '╩ ╩  ╩   ╩   ╚═╝',
    ]
    for (const ll of logoLines) {
      const llW = displayWidth(ll)
      const llL = Math.floor((cols - 2 - llW) / 2)
      const llR = cols - 2 - llW - llL
      lines.push(`${C}${' '.repeat(Math.max(0, llL))}${MAGENTA}${ll}${RESET}${' '.repeat(Math.max(0, llR))}${C}`)
    }

    // ── Casing bottom ──
    lines.push(`${GRAY}╚${'═'.repeat(cols - 2)}╝${RESET}`)

    process.stdout.write(lines.slice(0, rows).join('\n'))
  }
}

// ─── Character width helpers (CJK = 2 columns) ─────────────────────────────

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||   // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) ||   // CJK radicals
    (code >= 0x3040 && code <= 0x33bf) ||   // Hiragana, Katakana, CJK
    (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Ext A
    (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified
    (code >= 0xa960 && code <= 0xa97c) ||   // Hangul
    (code >= 0xac00 && code <= 0xd7a3) ||   // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) ||   // CJK Compatibility
    (code >= 0xfe30 && code <= 0xfe6b) ||   // CJK Forms
    (code >= 0xff01 && code <= 0xff60) ||   // Fullwidth
    (code >= 0xffe0 && code <= 0xffe6) ||   // Fullwidth signs
    (code >= 0x20000 && code <= 0x2fa1f)    // CJK Ext B+
  )
}

/** Display width of a plain string (no ANSI) */
function displayWidth(str: string): number {
  let w = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i)!
    if (code > 0xffff) i++ // surrogate pair
    w += isWide(code) ? 2 : 1
  }
  return w
}

/** Display width of a string that may contain ANSI escape codes */
function displayWidthAnsi(str: string): number {
  return displayWidth(str.replace(/\x1b\[[0-9;]*m/g, ''))
}

/** Truncate to at most maxCols display columns, preserving ANSI codes */
function truncateToWidth(str: string, maxCols: number): string {
  let cols = 0
  let i = 0
  while (i < str.length && cols < maxCols) {
    // Skip ANSI sequences
    if (str[i] === '\x1b') {
      const end = str.indexOf('m', i)
      if (end !== -1) {
        i = end + 1
        continue
      }
    }
    const code = str.codePointAt(i)!
    const charW = isWide(code) ? 2 : 1
    if (cols + charW > maxCols) break
    cols += charW
    i += code > 0xffff ? 2 : 1
  }
  return str.slice(0, i)
}
