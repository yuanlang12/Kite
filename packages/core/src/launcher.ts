import { runLocalMode } from './localMode.js'
import { runRemoteMode } from './remoteMode.js'
import { SessionScanner } from './sessionScanner.js'
import { findLatestSessionId } from './sessionManager.js'
import { RemoteTUI } from './remoteTUI.js'
import { AccessGate } from './accessGate.js'
import type { IMAdapter, IncomingMessage } from './types.js'

export interface LauncherOptions {
  projectPath: string
  claudeArgs: string[]
  adapters: IMAdapter[]
}

interface QueuedMessage {
  text: string
  chatId: string
  adapter: IMAdapter
}

// ─── Remote settings (controlled via Telegram commands) ─────────────────────

interface RemoteSettings {
  model: string | null           // --model
  effort: string | null          // --effort
}

const defaultSettings: RemoteSettings = {
  model: null,
  effort: null,
}

/** Build extra claude args from current settings */
function settingsToArgs(s: RemoteSettings): string[] {
  const args: string[] = []
  if (s.model) args.push('--model', s.model)
  if (s.effort) args.push('--effort', s.effort)
  return args
}

/** Handle a /command message. Returns response text, or null if not a command. */
function handleCommand(text: string, settings: RemoteSettings, gate: AccessGate): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const parts = trimmed.split(/\s+/)
  const cmd = parts[0].toLowerCase().replace('@', '').split('@')[0]
  const arg = parts[1]

  switch (cmd) {
    case '/model': {
      const valid = ['sonnet', 'opus', 'haiku']
      const a = arg?.toLowerCase()
      if (!a) return `Usage: /model <${valid.join('|')}>\nCurrent: ${settings.model ?? 'default'}`
      if (!valid.includes(a)) return `Unknown model. Use: ${valid.join(', ')}`
      settings.model = a
      return `Model switched to: ${a}`
    }
    case '/effort': {
      const valid = ['low', 'medium', 'high', 'max']
      const a = arg?.toLowerCase()
      if (!a) return `Usage: /effort <${valid.join('|')}>\nCurrent: ${settings.effort ?? 'default'}`
      if (!valid.includes(a)) return `Unknown level. Use: ${valid.join(', ')}`
      settings.effort = a
      return `Effort set to: ${a}`
    }
    case '/approve': {
      if (!arg) {
        const pending = gate.listPending()
        if (pending.length === 0) return `No pending pairings.`
        const list = pending.map((p) => `\`${p.code}\` — ${p.username ?? p.userId}`).join('\n')
        return `Pending pairings:\n${list}\n\nUsage: /approve <code>`
      }
      const result = gate.approvePairing(arg)
      if (!result) return `Invalid or expired code: ${arg}`
      return `Approved: ${result.username ?? result.userId}`
    }
    case '/status': {
      const pending = gate.listPending()
      const lines = [
        `🪁 Kite Remote Settings`,
        `Model: ${settings.model ?? 'default'}`,
        `Effort: ${settings.effort ?? 'default'}`,
        `Access: ${gate.mode}`,
        pending.length > 0 ? `Pending: ${pending.map((p) => p.code).join(', ')}` : '',
      ].filter(Boolean)
      return lines.join('\n')
    }
    default:
      return null
  }
}

// ─── Console muting ─────────────────────────────────────────────────────────

const _origLog = console.log
const _origWarn = console.warn
const _origError = console.error
const _noop = () => {}

function muteConsole() {
  console.log = _noop
  console.warn = _noop
  console.error = _noop
}

function unmuteConsole() {
  console.log = _origLog
  console.warn = _origWarn
  console.error = _origError
}

// ─── CLI args forwarding ────────────────────────────────────────────────────
// These flags should apply to remote mode too (not just local).
// We filter out flags that remote mode handles itself (-p, --resume, --output-format).

const REMOTE_FORWARD_FLAGS = new Set([
  '--model', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions',
  '--permission-mode', '--effort', '--allowedTools', '--allowed-tools',
  '--disallowedTools', '--disallowed-tools', '--add-dir', '--system-prompt',
  '--append-system-prompt', '--tools', '--max-budget-usd',
])

/** Extract CLI args that should be forwarded to remote mode */
function extractRemoteArgs(claudeArgs: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < claudeArgs.length; i++) {
    const arg = claudeArgs[i]
    if (REMOTE_FORWARD_FLAGS.has(arg)) {
      result.push(arg)
      // Check if this flag takes a value (not a boolean flag)
      if (arg !== '--dangerously-skip-permissions' && arg !== '--allow-dangerously-skip-permissions') {
        const next = claudeArgs[i + 1]
        if (next && !next.startsWith('--')) {
          result.push(next)
          i++
        }
      }
    }
  }
  return result
}

/**
 * Main state machine loop. Alternates between local mode (terminal) and remote mode (IM).
 * At any given time, only one Claude process is running. Both modes share the same session via --resume.
 */
export async function launch(opts: LauncherOptions): Promise<void> {
  const { projectPath, claudeArgs, adapters } = opts

  let mode: 'local' | 'remote' = 'local'
  let sessionId: string | null = await findLatestSessionId(projectPath)

  // Extract CLI args that also apply to remote mode
  const cliRemoteArgs = extractRemoteArgs(claudeArgs)

  // Access gate for pairing authentication
  const gate = new AccessGate()

  if (sessionId) {
    console.log(`[Kite] Found existing session: ${sessionId}`)
  }

  // Message queue for IM messages
  const messageQueue: QueuedMessage[] = []
  let messageWaiter: ((msg: QueuedMessage) => void) | null = null

  // Subscribe all adapters — push incoming messages to queue
  for (const adapter of adapters) {
    adapter.onMessage(async (msg: IncomingMessage) => {
      const queued: QueuedMessage = { text: msg.text, chatId: msg.chatId, adapter }
      if (messageWaiter) {
        const waiter = messageWaiter
        messageWaiter = null
        waiter(queued)
      } else {
        messageQueue.push(queued)
      }
    })
  }

  // Start session scanner — forward assistant messages to all IM chats (only in local mode)
  let scannerForwardingEnabled = true
  const subscribedChats = new Map<string, { adapter: IMAdapter; chatId: string }>()
  const scanner = new SessionScanner(projectPath)
  scanner.on((event) => {
    if (event.kind === 'assistant' && scannerForwardingEnabled && subscribedChats.size > 0) {
      for (const { adapter, chatId } of subscribedChats.values()) {
        adapter.sendMessage(chatId, event.text).catch(() => {})
      }
    }
  })
  await scanner.start()

  // Start all IM adapters
  await Promise.all(adapters.map((a) => a.start()))
  console.log(`[Kite] ${adapters.length} adapter(s) started`)

  // Remote settings (persistent across mode switches within this session)
  const settings: RemoteSettings = { ...defaultSettings }

  // Remote TUI instance
  const tui = new RemoteTUI()

  // Helper: wait for next message from queue (blocking)
  function waitForMessage(): Promise<QueuedMessage> {
    if (messageQueue.length > 0) {
      return Promise.resolve(messageQueue.shift()!)
    }
    return new Promise<QueuedMessage>((resolve) => {
      messageWaiter = resolve
    })
  }

  // Helper: check if queue has messages
  function hasMessages(): boolean {
    return messageQueue.length > 0
  }

  // Cleanup function
  const cleanup = async () => {
    await Promise.all(adapters.map((a) => a.stop()))
    await scanner.stop()
  }

  try {
    // Main state machine loop
    while (true) {
      if (mode === 'local') {
        const localAbort = new AbortController()

        // Mute console — Claude Code's TUI owns the terminal now
        muteConsole()

        // If a message arrives while in local mode, abort to switch to remote
        const messagePromise = waitForMessage().then((msg) => {
          messageQueue.unshift(msg)
          const chatKey = `${msg.adapter.name}:${msg.chatId}`
          subscribedChats.set(chatKey, { adapter: msg.adapter, chatId: msg.chatId })
          localAbort.abort()
        })

        const result = await runLocalMode({
          sessionId,
          projectPath,
          claudeArgs,
          signal: localAbort.signal,
          onSessionId: (id) => {
            sessionId = id
          },
        })

        unmuteConsole()

        if (result === 'exit') {
          if (hasMessages()) {
            mode = 'remote'
            continue
          }
          break
        }

        mode = 'remote'
      } else {
        // Remote mode — use TUI
        const remoteAbort = new AbortController()

        if (!sessionId) {
          console.error('[Kite] Cannot enter remote mode without a session ID')
          mode = 'local'
          continue
        }

        // Mute console so Scanner/Telegram logs don't corrupt TUI
        muteConsole()

        // Disable scanner forwarding — remote mode sends responses directly
        scannerForwardingEnabled = false

        // Start TUI
        tui.start()
        tui.addInfo('Waiting for Telegram messages...')

        const keyHandler = setupKeyListener(() => {
          remoteAbort.abort()
        })

        let currentAdapter: IMAdapter | null = null
        let currentChatId: string | null = null

        const result = await runRemoteMode({
          sessionId,
          projectPath,
          extraArgs: [...cliRemoteArgs, ...settingsToArgs(settings)],
          getNextMessage: async () => {
            while (true) {
              if (remoteAbort.signal.aborted) return null

              let msg: QueuedMessage | null = null

              // Check queue first
              if (messageQueue.length > 0) {
                msg = messageQueue.shift()!
              } else {
                // Wait for next message or abort
                msg = await new Promise<QueuedMessage | null>((resolve) => {
                  const onAbort = () => resolve(null)
                  if (remoteAbort.signal.aborted) { resolve(null); return }
                  remoteAbort.signal.addEventListener('abort', onAbort, { once: true })
                  messageWaiter = (m) => {
                    remoteAbort.signal.removeEventListener('abort', onAbort)
                    resolve(m)
                  }
                })
              }

              if (!msg) return null

              currentAdapter = msg.adapter
              currentChatId = msg.chatId
              const chatKey = `${msg.adapter.name}:${msg.chatId}`
              subscribedChats.set(chatKey, { adapter: msg.adapter, chatId: msg.chatId })

              // Check if it's a /command
              const cmdResponse = handleCommand(msg.text, settings, gate)
              if (cmdResponse !== null) {
                tui.addInfo(`Command: ${msg.text}`)
                await msg.adapter.sendMessage(msg.chatId, cmdResponse).catch(() => {})
                tui.addInfo(cmdResponse.split('\n')[0])
                continue // Wait for next message
              }

              tui.addMessage(msg.adapter.name, msg.text)
              return msg.text
            }
          },
          onResponse: async (text) => {
            const preview = text.slice(0, 80) + (text.length > 80 ? '...' : '')
            tui.addResponse(preview)
            if (currentAdapter && currentChatId) {
              await currentAdapter.sendMessage(currentChatId, text).catch(() => {})
            }
          },
          onThinking: async () => {
            tui.addThinking()
            if (currentAdapter && currentChatId) {
              await currentAdapter.sendTyping(currentChatId).catch(() => {})
            }
          },
          signal: remoteAbort.signal,
        })

        keyHandler.stop()
        tui.stop()
        unmuteConsole()
        scannerForwardingEnabled = true

        if (result === 'exit') break

        mode = 'local'
      }
    }
  } finally {
    await cleanup()
  }
}

/**
 * Listens for Enter key press on stdin to trigger mode switch.
 * Returns a handle with stop() to clean up.
 */
function setupKeyListener(onEnter: () => void): { stop: () => void } {
  const wasRaw = process.stdin.isRaw
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
  }

  const handler = (data: Buffer) => {
    // Enter key = 0x0d (CR) or 0x0a (LF)
    if (data[0] === 0x0d || data[0] === 0x0a) {
      onEnter()
    }
    // Ctrl+C = 0x03
    if (data[0] === 0x03) {
      process.exit(0)
    }
  }

  process.stdin.on('data', handler)

  return {
    stop() {
      process.stdin.removeListener('data', handler)
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw ?? false)
        process.stdin.pause()
      }
    },
  }
}
