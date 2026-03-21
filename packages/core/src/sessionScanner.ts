import chokidar from 'chokidar'
import { readFile, readdir } from 'node:fs/promises'
import { watch as fsWatch, type FSWatcher as NativeWatcher } from 'node:fs'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RawJSONLEntry, SessionEvent } from './types.js'

// Internal Claude Code event types that are not conversation messages
const SKIP_TYPES = new Set(['file-history-snapshot', 'change', 'queue-operation'])

/**
 * Extracts plain text from a Claude message (strips tool use blocks).
 * Returns empty string for non-text messages.
 */
function extractText(message: RawJSONLEntry): string {
  if (message.type !== 'user' && message.type !== 'assistant') return ''
  const { content } = message.message
  if (typeof content === 'string') return content
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()
}

/**
 * SessionScanner watches Claude Code's JSONL session files and emits
 * structured events whenever Claude produces a new assistant message.
 *
 * Uses chokidar to watch individual files (not glob patterns) because
 * chokidar v4 glob patterns fail on macOS hidden directories like ~/.claude.
 */
export class SessionScanner {
  private watcher: ReturnType<typeof chokidar.watch> | null = null
  private dirWatcher: NativeWatcher | null = null
  private watchedFiles = new Set<string>()
  private processedKeys = new Set<string>()
  private handlers: Array<(event: SessionEvent) => void> = []
  private readonly watchDir: string

  constructor(projectPath?: string) {
    const target = projectPath ?? process.cwd()
    const encoded = encodeURIComponent(target).replace(/%2F/g, '-')
    this.watchDir = projectPath
      ? join(homedir(), '.claude', 'projects', encoded)
      : join(homedir(), '.claude', 'projects')
  }

  on(handler: (event: SessionEvent) => void): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  private emit(event: SessionEvent) {
    for (const h of this.handlers) h(event)
  }

  async start(): Promise<void> {
    // Find existing JSONL files and mark all messages as processed
    const existingFiles = await this.findJsonlFiles()
    for (const f of existingFiles) {
      await this.processFile(f, true)
    }

    // Watch individual files with chokidar (not glob — glob fails on macOS hidden dirs)
    this.watcher = chokidar.watch(existingFiles, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    })

    this.watcher.on('change', (filePath: string) => {
      console.log(`[Scanner] File changed: ${basename(filePath)}`)
      this.processFile(filePath, false)
    })

    for (const f of existingFiles) this.watchedFiles.add(f)

    // Watch directory for new session files using native fs.watch
    try {
      this.dirWatcher = fsWatch(this.watchDir, async (event, filename) => {
        if (!filename?.endsWith('.jsonl')) return
        const fullPath = join(this.watchDir, filename)
        if (this.watchedFiles.has(fullPath)) return
        console.log(`[Scanner] New session file: ${filename}`)
        this.watchedFiles.add(fullPath)
        this.watcher?.add(fullPath)
      })
    } catch {
      // Directory doesn't exist yet — that's fine
    }

    console.log(`[Scanner] Watching ${existingFiles.length} session file(s) in ${this.watchDir}`)
  }

  async stop(): Promise<void> {
    await this.watcher?.close()
    this.dirWatcher?.close()
    this.watcher = null
    this.dirWatcher = null
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async findJsonlFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.watchDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map((e) => join(this.watchDir, e.name))
    } catch {
      return []
    }
  }

  private async processFile(filePath: string, markOnly: boolean): Promise<void> {
    const sessionId = basename(filePath, '.jsonl')
    let content: string
    try {
      content = await readFile(filePath, 'utf-8')
    } catch {
      return
    }

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let entry: RawJSONLEntry
      try {
        const parsed = JSON.parse(trimmed)
        if (!parsed.type || SKIP_TYPES.has(parsed.type)) continue
        if (!['user', 'assistant', 'summary', 'system'].includes(parsed.type)) continue
        entry = parsed as RawJSONLEntry
      } catch {
        continue
      }

      const key = this.messageKey(entry)
      if (this.processedKeys.has(key)) continue
      this.processedKeys.add(key)

      if (markOnly) continue

      // Only emit assistant messages (Claude's responses)
      if (entry.type === 'assistant') {
        const text = extractText(entry)
        if (!text) continue
        console.log(`[Scanner] New assistant message (${text.length} chars)`)
        this.emit({
          kind: 'assistant',
          sessionId,
          uuid: entry.uuid,
          text,
          raw: entry,
        })
      }
    }
  }

  private messageKey(entry: RawJSONLEntry): string {
    if (entry.type === 'summary') return `summary:${entry.leafUuid}:${entry.summary.slice(0, 40)}`
    return `${entry.type}:${entry.uuid}`
  }
}
