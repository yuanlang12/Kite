import { spawn, type ChildProcess } from 'node:child_process'

export interface RemoteModeOptions {
  sessionId: string
  projectPath: string
  extraArgs?: string[]
  getNextMessage: () => Promise<string | null>
  onResponse: (text: string) => Promise<void>
  onThinking: () => Promise<void>
  signal: AbortSignal
}

/**
 * Runs Claude Code in remote mode — receives messages from IM, processes them via Claude CLI,
 * and sends responses back. Uses non-interactive `claude -p --resume` mode.
 * Returns 'switch' if aborted (user wants terminal back), 'exit' if no more messages.
 */
export async function runRemoteMode(opts: RemoteModeOptions): Promise<'switch' | 'exit'> {
  const { sessionId, projectPath, extraArgs, getNextMessage, onResponse, onThinking, signal } = opts

  while (!signal.aborted) {
    const message = await getNextMessage()

    if (message === null || signal.aborted) {
      return signal.aborted ? 'switch' : 'exit'
    }

    await onThinking().catch(() => {})

    try {
      const response = await executeClaudeCommand({
        sessionId,
        projectPath,
        message,
        extraArgs,
        signal,
      })

      if (signal.aborted) return 'switch'

      if (response) {
        await onResponse(response)
      }
    } catch (err) {
      if (signal.aborted) return 'switch'
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[Kite] Remote mode error: ${errMsg}`)
      await onResponse(`Error: ${errMsg}`).catch(() => {})
    }
  }

  return 'switch'
}

async function executeClaudeCommand(opts: {
  sessionId: string
  projectPath: string
  message: string
  extraArgs?: string[]
  signal: AbortSignal
}): Promise<string> {
  const { sessionId, projectPath, message, extraArgs, signal } = opts

  const args = [
    '-p', message,
    '--resume', sessionId,
    '--output-format', 'text',
    '--permission-mode', 'auto',
    ...(extraArgs ?? []),
  ]

  return new Promise<string>((resolve, reject) => {
    let child: ChildProcess | null = null
    let resolved = false

    const onAbort = () => {
      if (resolved) return
      resolved = true
      if (child && !child.killed) {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child && !child.killed) child.kill('SIGKILL')
        }, 2000)
      }
      reject(new Error('Aborted'))
    }

    if (signal.aborted) {
      reject(new Error('Aborted'))
      return
    }

    signal.addEventListener('abort', onAbort, { once: true })

    child = spawn('claude', args, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    let output = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.stderr?.on('data', () => {
      // Claude writes status info to stderr — ignore
    })

    child.on('error', (err) => {
      if (resolved) return
      resolved = true
      signal.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('exit', (code) => {
      if (resolved) return
      resolved = true
      signal.removeEventListener('abort', onAbort)
      if (code !== 0 && code !== null) {
        reject(new Error(`claude exited with code ${code}`))
      } else {
        resolve(output.trim())
      }
    })
  })
}
