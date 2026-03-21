import { spawn, type ChildProcess } from 'node:child_process'
import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

export interface LocalModeOptions {
  sessionId: string | null
  projectPath: string
  claudeArgs: string[]
  signal: AbortSignal
  onSessionId: (id: string) => void
}

/**
 * Runs Claude Code in local mode with stdio: inherit (user interacts in terminal).
 * Returns 'switch' if aborted (e.g. Telegram message arrived), 'exit' if Claude exits normally.
 */
export async function runLocalMode(opts: LocalModeOptions): Promise<'switch' | 'exit'> {
  const { sessionId, projectPath, claudeArgs, signal, onSessionId } = opts

  // Build claude args
  const args: string[] = []
  if (sessionId) {
    args.push('--resume', sessionId)
  }
  args.push(...claudeArgs)

  // If no sessionId yet, watch for new session files to detect it
  let dirWatcher: FSWatcher | null = null
  if (!sessionId) {
    const encoded = encodeURIComponent(projectPath).replace(/%2F/g, '-')
    const watchDir = join(homedir(), '.claude', 'projects', encoded)

    // Get existing files before starting Claude
    const existingFiles = new Set<string>()
    try {
      const entries = await readdir(watchDir)
      for (const e of entries) {
        if (e.endsWith('.jsonl')) existingFiles.add(e)
      }
    } catch {
      // Directory may not exist yet
    }

    try {
      dirWatcher = fsWatch(watchDir, (_event, filename) => {
        if (!filename?.endsWith('.jsonl')) return
        if (existingFiles.has(filename)) return
        const newSessionId = basename(filename, '.jsonl')
        onSessionId(newSessionId)
        dirWatcher?.close()
        dirWatcher = null
      })
    } catch {
      // Directory doesn't exist yet — will be created when Claude starts
    }
  }

  return new Promise<'switch' | 'exit'>((resolve) => {
    let child: ChildProcess | null = null
    let resolved = false

    const cleanup = () => {
      dirWatcher?.close()
      dirWatcher = null
    }

    const onAbort = () => {
      if (resolved) return
      resolved = true
      cleanup()
      if (child && !child.killed) {
        child.kill('SIGTERM')
        // Give it a moment to exit gracefully, then force kill
        setTimeout(() => {
          if (child && !child.killed) child.kill('SIGKILL')
        }, 2000)
      }
      resolve('switch')
    }

    if (signal.aborted) {
      cleanup()
      resolve('switch')
      return
    }

    signal.addEventListener('abort', onAbort, { once: true })

    child = spawn('claude', args, {
      cwd: projectPath,
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', (err) => {
      if (resolved) return
      resolved = true
      cleanup()
      signal.removeEventListener('abort', onAbort)
      console.error('[Kite] Claude process error:', err.message)
      resolve('exit')
    })

    child.on('exit', (code) => {
      if (resolved) return
      resolved = true
      cleanup()
      signal.removeEventListener('abort', onAbort)
      resolve('exit')
    })
  })
}
