import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { MessageQueue } from './messageQueue.js'

/**
 * Finds the most recently modified JSONL session file for a given project path.
 * Claude Code stores sessions at ~/.claude/projects/<encoded-path>/<sessionId>.jsonl
 */
export async function findLatestSessionId(projectPath: string): Promise<string | null> {
  const encoded = encodeURIComponent(projectPath).replace(/%2F/g, '-')
  const projectDir = join(homedir(), '.claude', 'projects', encoded)

  let files: { name: string; mtime: number }[]
  try {
    const entries = await readdir(projectDir, { withFileTypes: true })
    const statPromises = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map(async (e) => {
        const { stat } = await import('node:fs/promises')
        const s = await stat(join(projectDir, e.name))
        return { name: e.name, mtime: s.mtimeMs }
      })
    files = await Promise.all(statPromises)
  } catch {
    return null
  }

  if (files.length === 0) return null
  files.sort((a, b) => b.mtime - a.mtime)
  return basename(files[0].name, '.jsonl')
}

/**
 * Injects a message into an existing Claude Code session using `claude --resume`.
 * Captures stdout/stderr and returns the response text.
 *
 * This is the "remote mode" equivalent — resumes the session, sends the message
 * non-interactively, and returns the response.
 */
export async function injectMessage(opts: {
  sessionId: string
  projectPath: string
  message: string
  claudeBin?: string
  onChunk?: (chunk: string) => void
  signal?: AbortSignal
}): Promise<string> {
  const claude = opts.claudeBin ?? 'claude'
  const args = [
    '--resume', opts.sessionId,
    '--print',           // non-interactive output mode
    '--output-format', 'text',
    opts.message,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(claude, args, {
      cwd: opts.projectPath,
      signal: opts.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      opts.onChunk?.(text)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      // Claude Code may write status info to stderr — we ignore it
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`claude exited with code ${code}`))
      } else {
        resolve(output.trim())
      }
    })
  })
}

/**
 * SessionManager wraps injectMessage with a queue so concurrent requests
 * from multiple IM platforms are serialized.
 */
export class SessionManager {
  private queue = new MessageQueue()

  constructor(
    private readonly projectPath: string,
    private readonly claudeBin?: string,
  ) {}

  send(
    message: string,
    opts?: {
      onChunk?: (chunk: string) => void
      signal?: AbortSignal
    },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.enqueue(async () => {
        const sessionId = await findLatestSessionId(this.projectPath)
        if (!sessionId) {
          reject(new Error('No active Claude session found. Start Claude Code first.'))
          return
        }
        try {
          const response = await injectMessage({
            sessionId,
            projectPath: this.projectPath,
            message,
            claudeBin: this.claudeBin,
            onChunk: opts?.onChunk,
            signal: opts?.signal,
          })
          resolve(response)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  get queueSize(): number {
    return this.queue.size
  }
}
