import { runLocalMode } from './localMode.js'
import { runRemoteMode } from './remoteMode.js'
import { SessionScanner } from './sessionScanner.js'
import { findLatestSessionId } from './sessionManager.js'
import { RemoteTUI } from './remoteTUI.js'
import { AccessGate } from './accessGate.js'
import { ProjectRouter } from './projectRouter.js'
import { basename } from 'node:path'
import type { IMAdapter, IncomingMessage, ProjectRoute } from './types.js'

export interface LauncherOptions {
  projectPath: string
  claudeArgs: string[]
  adapters: IMAdapter[]
}

interface QueuedMessage {
  text: string
  chatId: string
  messageId?: string
  adapter: IMAdapter
  route: ProjectRoute
}

// ─── Remote settings (controlled via IM commands) ─────────────────────────

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

// ─── Command handling ──────────────────────────────────────────────────────

interface CommandContext {
  chatKey: string
  adapter: IMAdapter
  chatId: string
}

/** Handle a /command message. Returns response text, or null if not a command. */
function handleCommand(
  text: string,
  settings: RemoteSettings,
  gate: AccessGate,
  router: ProjectRouter,
  ctx: CommandContext,
): string | null {
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
    case '/addproject': {
      const alias = parts[1]
      const path = parts.slice(2).join(' ')
      if (!alias || !path) return `Usage: /addproject <name> <path>\nExample: /addproject frontend ~/code/webapp`
      const result = router.addProject(alias, path)
      if (!result.ok) return result.error!
      return `Project "${alias}" added: ${path}`
    }
    case '/rmproject': {
      if (!arg) return `Usage: /rmproject <name>`
      const result = router.removeProject(arg)
      if (!result.ok) return result.error!
      return `Project "${arg}" removed`
    }
    case '/bind': {
      if (!arg) {
        const route = router.resolve(ctx.chatKey)
        return `Current project: ${route.alias} (${route.projectPath})`
      }
      const result = router.bind(ctx.chatKey, arg)
      if (!result.ok) return result.error!
      return `This chat is now bound to project "${arg}"`
    }
    case '/unbind': {
      router.unbind(ctx.chatKey)
      return `Binding removed. Will use default project.`
    }
    case '/projects': {
      const projects = router.listProjects()
      const bindings = router.listBindings()
      const lines = ['Projects:']
      for (const p of projects) {
        const bound = bindings.filter((b) => b.alias === p.alias).map((b) => b.chatKey)
        const bindInfo = bound.length > 0 ? ` (bound: ${bound.join(', ')})` : ''
        lines.push(`  ${p.alias === 'default' ? '* ' : '  '}${p.alias}: ${p.projectPath}${bindInfo}`)
      }
      return lines.join('\n')
    }
    case '/status': {
      const route = router.resolve(ctx.chatKey)
      const pending = gate.listPending()
      const lines = [
        `🪁 Kite Remote Settings`,
        `Project: ${route.alias} (${route.projectPath})`,
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

  // Project router for multi-project support
  const router = new ProjectRouter(projectPath)

  if (sessionId) {
    console.log(`[Kite] Found existing session: ${sessionId}`)
  }

  // Message queue for IM messages
  const messageQueue: QueuedMessage[] = []
  let messageWaiter: ((msg: QueuedMessage) => void) | null = null

  // Subscribe all adapters — push incoming messages to queue with route info
  for (const adapter of adapters) {
    adapter.onMessage(async (msg: IncomingMessage) => {
      const chatKey = `${adapter.name}:${msg.chatId}`
      const route = router.resolve(chatKey)

      // Instant receipt acknowledgment — react with 👀 (fire-and-forget)
      if (msg.messageId && adapter.reactToMessage) {
        adapter.reactToMessage(msg.chatId, msg.messageId, '👀').catch(() => {})
      }

      const queued: QueuedMessage = { text: msg.text, chatId: msg.chatId, messageId: msg.messageId, adapter, route }
      if (messageWaiter) {
        const waiter = messageWaiter
        messageWaiter = null
        waiter(queued)
      } else {
        messageQueue.push(queued)
      }
    })
  }

  // Start session scanner — forward assistant messages to bound IM chats (only in local mode)
  let scannerForwardingEnabled = true
  const subscribedChats = new Map<string, { adapter: IMAdapter; chatId: string }>()
  const scanner = new SessionScanner(projectPath)
  scanner.on((event) => {
    if (event.kind === 'assistant' && scannerForwardingEnabled && subscribedChats.size > 0) {
      for (const [chatKey, { adapter, chatId }] of subscribedChats) {
        // Only forward to chats bound to the default project (local mode always uses default)
        const route = router.resolve(chatKey)
        if (route.projectPath === projectPath) {
          adapter.sendMessage(chatId, event.text).catch(() => {})
        }
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
        const messagePromise = waitForMessage().then(async (msg) => {
          messageQueue.unshift(msg)
          const chatKey = `${msg.adapter.name}:${msg.chatId}`
          subscribedChats.set(chatKey, { adapter: msg.adapter, chatId: msg.chatId })

          // Notify IM user: switching to remote mode with project context
          const route = router.resolve(chatKey)
          const registeredProjects = router.listRegisteredProjects()
          const hasBinding = router.listBindings().some((b) => b.chatKey === chatKey)
          const displayName = route.alias === 'default' ? basename(route.projectPath) : route.alias

          if (registeredProjects.length > 0 && !hasBinding) {
            // Multiple registered projects, no binding — gate in getNextMessage will prompt
            // Don't send switching message here to avoid duplicate prompts
          } else {
            // Bound or single project — show project name
            await msg.adapter.sendMessage(msg.chatId,
              `🪁 Switching to remote — project: ${displayName}`,
            ).catch(() => {})
          }

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
        tui.addInfo('Waiting for IM messages...')

        const keyHandler = setupKeyListener(() => {
          remoteAbort.abort()
        })

        let currentAdapter: IMAdapter | null = null
        let currentChatId: string | null = null
        let thinkingMessageId: string | null = null

        const result = await runRemoteMode({
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
              thinkingMessageId = null
              const chatKey = `${msg.adapter.name}:${msg.chatId}`
              subscribedChats.set(chatKey, { adapter: msg.adapter, chatId: msg.chatId })

              // Check if it's a /command
              const cmdCtx: CommandContext = { chatKey, adapter: msg.adapter, chatId: msg.chatId }
              const cmdResponse = handleCommand(msg.text, settings, gate, router, cmdCtx)
              if (cmdResponse !== null) {
                tui.addInfo(`Command: ${msg.text}`)
                await msg.adapter.sendMessage(msg.chatId, cmdResponse).catch(() => {})
                tui.addInfo(cmdResponse.split('\n')[0])
                continue // Wait for next message
              }

              // Gate: if multiple registered projects and no binding, require /bind first
              const registered = router.listRegisteredProjects()
              const hasBinding = router.listBindings().some((b) => b.chatKey === chatKey)
              if (registered.length > 0 && !hasBinding) {
                tui.addInfo(`No binding for ${chatKey}, prompting to bind`)
                await msg.adapter.sendMessage(msg.chatId,
                  `🪁 Please choose a project first 👇`,
                ).catch(() => {})
                for (const p of registered.slice(0, 5)) {
                  await msg.adapter.sendMessage(msg.chatId, `/bind ${p.alias}`).catch(() => {})
                }
                // Also offer the default project
                const defaultDisplay = basename(router.resolve(chatKey).projectPath)
                await msg.adapter.sendMessage(msg.chatId, `/bind default`).catch(() => {})
                continue // Skip this message — wait for /bind
              }

              // Resolve project route and ensure sessionId
              const route = msg.route
              const resolvedSessionId = await router.ensureSessionId(route)
              if (!resolvedSessionId) {
                // No session found — Claude will create a new one
                // Use the default session as fallback for now
                tui.addInfo(`No session for "${route.alias}", using default`)
              }

              const msgSessionId = resolvedSessionId ?? sessionId!
              tui.addMessage(`${msg.adapter.name} [${route.alias}]`, msg.text)

              return {
                text: msg.text,
                sessionId: msgSessionId,
                projectPath: route.projectPath,
              }
            }
          },
          onResponse: async (text) => {
            const preview = text.slice(0, 80) + (text.length > 80 ? '...' : '')
            tui.addResponse(preview)
            if (currentAdapter && currentChatId) {
              if (thinkingMessageId) {
                // Try to edit the 🤔 message into the response
                try {
                  await currentAdapter.editMessage(currentChatId, thinkingMessageId, text)
                  thinkingMessageId = null
                  return
                } catch {
                  // Edit not supported or failed — fall through to send new message
                }
              }
              await currentAdapter.sendMessage(currentChatId, text).catch(() => {})
              thinkingMessageId = null
            }
          },
          onThinking: async () => {
            tui.addThinking()
            if (currentAdapter && currentChatId) {
              // Send 🤔 as thinking indicator — save messageId for later edit
              const msgId = await currentAdapter.sendMessage(currentChatId, '🤔').catch(() => undefined)
              thinkingMessageId = typeof msgId === 'string' ? msgId : null
            }
          },
          onStderr: (text) => {
            tui.addInfo(`stderr: ${text.slice(0, 120)}`)
            if (currentAdapter && currentChatId) {
              currentAdapter.sendMessage(currentChatId, `⚠️ ${text}`).catch(() => {})
            }
          },
          onTimeout: () => {
            tui.addInfo('Execution taking longer than expected...')
            if (currentAdapter && currentChatId) {
              currentAdapter.sendMessage(currentChatId, '⏳ Claude is still working — this is taking longer than expected...').catch(() => {})
            }
          },
          signal: remoteAbort.signal,
        })

        keyHandler.stop()
        tui.stop()
        unmuteConsole()
        // Don't re-enable scanner forwarding — user is back at the terminal and can see output directly
        scannerForwardingEnabled = false

        if (result === 'exit') break

        mode = 'local'
      }
    }
  } finally {
    await cleanup()
    // Force exit — third-party SDKs (Feishu WSClient, grammy polling, chokidar)
    // keep handles open that prevent Node from exiting gracefully.
    process.exit(0)
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
