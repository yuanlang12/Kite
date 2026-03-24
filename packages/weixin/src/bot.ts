import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AccessGate } from '@kite/core'
import type { IMAdapter, IncomingMessage } from '@kite/core'
import { ILinkAPI, extractText } from './api.js'

export interface WeixinAdapterConfig {
  token: string
  baseUrl?: string
  /** Allowed WeChat user IDs. Empty array = allow all. */
  allowedUserIds?: string[]
}

const BUF_DIR = join(homedir(), '.config', 'kite')
const BUF_FILE = join(BUF_DIR, 'weixin_sync_buf.txt')
const MAX_CHUNK_LEN = 2000

export class WeixinAdapter implements IMAdapter {
  readonly name = 'weixin'

  private api: ILinkAPI
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private readonly gate: AccessGate
  private running = false
  private abortController: AbortController | null = null

  /** context_token per user — required by iLink API to reply */
  private contextTokenMap = new Map<string, string>()
  /** typing_ticket per user — cached to avoid repeated getConfig calls */
  private typingTicketMap = new Map<string, string>()

  constructor(private readonly config: WeixinAdapterConfig) {
    this.api = new ILinkAPI(config.token, config.baseUrl)
    this.gate = new AccessGate(config.allowedUserIds)
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const contextToken = this.contextTokenMap.get(chatId)
    if (!contextToken) {
      console.warn(`[WeChat] No context_token for user ${chatId}, cannot send message`)
      return
    }

    const chunks = splitMessage(text, MAX_CHUNK_LEN)
    for (const chunk of chunks) {
      const resp = await this.api.sendMessage(chatId, chunk, contextToken)
      if (resp.errcode !== 0) {
        console.error(`[WeChat] sendMessage error: ${resp.errmsg ?? resp.errcode}`)
      }
    }
  }

  async editMessage(_chatId: string, _messageId: string, _text: string): Promise<void> {
    throw new Error('WeChat does not support editing messages')
  }

  async sendTyping(chatId: string): Promise<void> {
    const contextToken = this.contextTokenMap.get(chatId)
    if (!contextToken) return

    try {
      // Use cached ticket or fetch a new one
      let ticket = this.typingTicketMap.get(chatId)
      if (!ticket) {
        const cfg = await this.api.getConfig(chatId, contextToken)
        ticket = cfg.typing_ticket
        if (ticket) this.typingTicketMap.set(chatId, ticket)
      }
      if (ticket) {
        await this.api.sendTyping(chatId, ticket, 1)
      }
    } catch {
      // Typing is best-effort
    }
  }

  async start(): Promise<void> {
    this.running = true
    console.log('[WeChat] Bot started (iLink long polling)')
    this.pollLoop()
  }

  async stop(): Promise<void> {
    this.running = false
    this.abortController?.abort()
    console.log('[WeChat] Bot stopped')
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    let buf = loadBuf()
    let backoffMs = 1000

    while (this.running) {
      this.abortController = new AbortController()
      try {
        const resp = await this.api.getUpdates(buf, this.abortController.signal)

        if (resp.get_updates_buf) {
          buf = resp.get_updates_buf
          saveBuf(buf)
        }

        for (const msg of resp.msgs ?? []) {
          await this.handleMessage(msg)
        }

        // Successful poll — reset backoff
        backoffMs = 1000
      } catch (err) {
        if (!this.running) break

        const message = err instanceof Error ? err.message : String(err)
        // Abort errors are expected during stop()
        if (message.includes('abort')) break

        console.error(`[WeChat] Poll error: ${message}`)
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, 30_000)
      }
    }
  }

  private async handleMessage(msg: import('./api.js').ILinkMessage): Promise<void> {
    const userId = msg.from_user_id
    const username = msg.from_user_name

    // Always save context_token — needed for replying
    if (msg.context_token) {
      this.contextTokenMap.set(userId, msg.context_token)
    }

    const text = extractText(msg.item_list)
    if (!text) return

    // Access control
    const access = this.gate.check(userId)

    if (access === 'denied') return

    if (access === 'needs_pairing') {
      const code = this.gate.createPairing(userId, username)
      // Send pairing instructions back
      const contextToken = this.contextTokenMap.get(userId)
      if (contextToken) {
        await this.api.sendMessage(
          userId,
          `🔐 配对验证\n\n` +
          `你的配对码: ${code}\n\n` +
          `请让终端用户执行:\n` +
          `/approve ${code}\n\n` +
          `配对码 1 小时内有效。`,
          contextToken,
        ).catch(() => {})
      }
      return
    }

    // Allowed — forward to handler
    if (!this.messageHandler) return

    const incoming: IncomingMessage = {
      platform: 'weixin',
      chatId: userId, // WeChat uses userId as chatId for DMs
      userId,
      username,
      text,
    }
    await this.messageHandler(incoming)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadBuf(): string {
  try {
    return readFileSync(BUF_FILE, 'utf-8').trim()
  } catch {
    return ''
  }
}

function saveBuf(buf: string): void {
  mkdirSync(BUF_DIR, { recursive: true })
  writeFileSync(BUF_FILE, buf)
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const parts: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, maxLen))
    remaining = remaining.slice(maxLen)
  }
  return parts
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
