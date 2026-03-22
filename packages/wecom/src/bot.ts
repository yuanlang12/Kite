import AiBot from '@wecom/aibot-node-sdk'
import type { WsFrame, TextMessage } from '@wecom/aibot-node-sdk'
import type { IMAdapter, IncomingMessage } from '@kite/core'

export interface WecomAdapterConfig {
  botId: string
  secret: string
  /** Allowed WeCom user IDs. Empty array = allow all. */
  allowedUserIds?: string[]
}

const MAX_CHUNK_LEN = 2048

/**
 * WeCom (企业微信) adapter using the official @wecom/aibot-node-sdk.
 * WebSocket long connection — no public IP or webhook needed.
 */
export class WecomAdapter implements IMAdapter {
  readonly name = 'wecom'

  /** Test connection with given credentials. Throws on failure. */
  static async testConnection(botId: string, secret: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = new AiBot.WSClient({
        botId,
        secret,
        maxReconnectAttempts: 0,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      })

      const timer = setTimeout(() => {
        client.disconnect()
        reject(new Error('Connection timeout (10s)'))
      }, 10_000)

      client.on('authenticated', () => {
        clearTimeout(timer)
        client.disconnect()
        resolve(botId)
      })

      client.on('error', (err: Error) => {
        clearTimeout(timer)
        client.disconnect()
        reject(err)
      })

      client.connect()
    })
  }

  private wsClient: InstanceType<typeof AiBot.WSClient>
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private readonly allowedUserIds: Set<string>

  constructor(private readonly config: WecomAdapterConfig) {
    this.wsClient = new AiBot.WSClient({
      botId: config.botId,
      secret: config.secret,
      logger: {
        debug() {},
        info(...args: unknown[]) { process.stderr.write(`[WeCom] ${args.join(' ')}\n`) },
        warn(...args: unknown[]) { process.stderr.write(`[WeCom] WARN: ${args.join(' ')}\n`) },
        error(...args: unknown[]) { process.stderr.write(`[WeCom] ERROR: ${args.join(' ')}\n`) },
      },
    })
    this.allowedUserIds = new Set(config.allowedUserIds ?? [])
  }

  private isAllowed(userId: string): boolean {
    if (this.allowedUserIds.size === 0) return true
    return this.allowedUserIds.has(userId)
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const chunks = splitMessage(text, MAX_CHUNK_LEN)
    for (const chunk of chunks) {
      await this.wsClient.sendMessage(chatId, {
        msgtype: 'markdown',
        markdown: { content: chunk },
      })
    }
  }

  async editMessage(_chatId: string, _messageId: string, _text: string): Promise<void> {
    // WeCom bot API does not support editing messages
  }

  async sendTyping(_chatId: string): Promise<void> {
    // WeCom has no native typing indicator
  }

  async start(): Promise<void> {
    this.wsClient.on('authenticated', () => {
      process.stderr.write('[WeCom] Authenticated successfully\n')
    })

    this.wsClient.on('message.text', async (frame: WsFrame<TextMessage>) => {
      const content = frame.body?.text?.content
      if (!content) return

      const userId = frame.body?.from?.userid ?? ''
      // For group chats use chatid, for DMs use userid
      const chatId = frame.body?.chattype === 'group'
        ? (frame.body?.chatid ?? userId)
        : userId

      if (!this.isAllowed(userId)) return
      if (!this.messageHandler) return

      process.stderr.write(`[WeCom] Message from ${userId}: ${content}\n`)

      const incoming: IncomingMessage = {
        platform: 'wecom',
        chatId,
        userId,
        text: content,
      }
      await this.messageHandler(incoming)
    })

    this.wsClient.connect()
    console.log('[WeCom] Bot started (WebSocket long connection)')
  }

  async stop(): Promise<void> {
    this.wsClient.disconnect()
    console.log('[WeCom] Bot stopped')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
