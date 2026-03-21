import * as Lark from '@larksuiteoapi/node-sdk'
import type { IMAdapter, IncomingMessage } from '@kite/core'

export interface FeishuAdapterConfig {
  appId: string
  appSecret: string
  /** Allowed Feishu user IDs. Empty array = allow all. */
  allowedUserIds?: string[]
}

/**
 * Feishu (Lark) adapter using the official Node.js SDK with long connection mode.
 * No public IP or webhook required — uses Feishu's persistent WebSocket connection.
 */
export class FeishuAdapter implements IMAdapter {
  readonly name = 'feishu'
  private client: Lark.Client
  private wsClient: Lark.WSClient
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private readonly allowedUserIds: Set<string>

  constructor(private readonly config: FeishuAdapterConfig) {
    this.client = new Lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
    })
    this.wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
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
    await this.client.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      params: { receive_id_type: 'chat_id' },
    })
  }

  async editMessage(_chatId: string, _messageId: string, _text: string): Promise<void> {
    // Feishu message editing via message.update API
    // TODO: implement if needed
  }

  async sendTyping(_chatId: string): Promise<void> {
    // Feishu doesn't have a native "typing" indicator
    // Can send a temporary message or use custom status
  }

  async start(): Promise<void> {
    // Long connection mode — Feishu's WebSocket-based persistent connection
    // No public IP or webhook server required
    this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          const msg = data.message
          if (msg.message_type !== 'text') return

          const userId = data.sender?.sender_id?.user_id ?? ''
          if (!this.isAllowed(userId)) return
          if (!this.messageHandler) return

          let text = ''
          try {
            text = (JSON.parse(msg.content) as { text: string }).text
          } catch {
            return
          }

          const incoming: IncomingMessage = {
            platform: 'feishu',
            chatId: msg.chat_id ?? '',
            userId,
            text,
          }
          await this.messageHandler(incoming)
        },
      }),
    })
    console.log('[Feishu] Bot started (long connection)')
  }

  async stop(): Promise<void> {
    // WSClient does not expose a close method in all versions — graceful shutdown
    console.log('[Feishu] Bot stopped')
  }
}
