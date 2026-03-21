import { Bot } from 'grammy'
import { AccessGate } from '@kite/core'
import type { IMAdapter, IncomingMessage } from '@kite/core'

export interface TelegramAdapterConfig {
  token: string
  /** Allowed Telegram user IDs. Empty array = allow all. */
  allowedUserIds?: string[]
}

export class TelegramAdapter implements IMAdapter {
  readonly name = 'telegram'

  /** Test connection with given token. Returns bot username on success. */
  static async testConnection(token: string): Promise<string> {
    const bot = new Bot(token)
    const me = await bot.api.getMe()
    return me.username ?? me.first_name
  }
  private bot: Bot
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private readonly gate: AccessGate

  constructor(private readonly config: TelegramAdapterConfig) {
    this.bot = new Bot(config.token)
    this.gate = new AccessGate(config.allowedUserIds)
    this.setupHandlers()
  }

  private setupHandlers(): void {
    this.bot.on('message:text', async (ctx) => {
      const userId = String(ctx.from?.id ?? '')
      const username = ctx.from?.username

      const access = this.gate.check(userId)

      if (access === 'denied') {
        // Silently ignore in allowlist mode
        return
      }

      if (access === 'needs_pairing') {
        const code = this.gate.createPairing(userId, username)
        await ctx.reply(
          `🔐 Pairing required\n\n` +
          `Your code: \`${code}\`\n\n` +
          `Ask the terminal user to run:\n` +
          `\`/approve ${code}\`\n\n` +
          `Code expires in 1 hour.`,
          { parse_mode: 'Markdown' },
        )
        return
      }

      // allowed
      if (!this.messageHandler) return

      const incoming: IncomingMessage = {
        platform: 'telegram',
        chatId: String(ctx.chat.id),
        userId,
        username,
        text: ctx.message.text,
      }
      await this.messageHandler(incoming)
    })
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  async sendMessage(chatId: string, text: string): Promise<string> {
    const chunks = splitMessage(text)
    let lastMsgId = ''
    for (const chunk of chunks) {
      const msg = await this.bot.api.sendMessage(Number(chatId), chunk, {
        parse_mode: 'Markdown',
      }).catch(() =>
        this.bot.api.sendMessage(Number(chatId), chunk)
      )
      lastMsgId = String(msg.message_id)
    }
    return lastMsgId
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    await this.bot.api.editMessageText(Number(chatId), Number(messageId), text, {
      parse_mode: 'Markdown',
    }).catch(() =>
      this.bot.api.editMessageText(Number(chatId), Number(messageId), text)
    )
  }

  async sendTyping(chatId: string): Promise<void> {
    await this.bot.api.sendChatAction(Number(chatId), 'typing')
  }

  async start(): Promise<void> {
    // Register bot command menu
    await this.bot.api.setMyCommands([
      { command: 'model', description: '切换模型 — /model sonnet | opus | haiku' },
      { command: 'effort', description: '推理力度 — /effort low | medium | high | max' },
      { command: 'status', description: '查看当前设置' },
    ]).catch(() => {})

    await this.startWithRetry(3)
  }

  private async startWithRetry(maxRetries: number): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.bot.api.deleteWebhook({ drop_pending_updates: true })

        this.bot.catch((err) => {
          console.error('[Telegram] Bot error:', err.message ?? err)
        })

        this.bot.start({
          onStart: (info) => console.log(`[Telegram] Bot @${info.username} started (long polling)`),
        }).catch((err) => {
          const msg = err?.message ?? String(err)
          if (msg.includes('409')) {
            console.warn('[Telegram] Polling conflict detected, will retry...')
            setTimeout(() => {
              this.bot = new Bot(this.config.token)
              this.setupHandlers()
              this.startWithRetry(1).catch(() => {})
            }, 3000)
          }
        })

        return
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (attempt < maxRetries && msg.includes('409')) {
          console.warn(`[Telegram] Conflict on attempt ${attempt}/${maxRetries}, waiting 3s...`)
          await new Promise((r) => setTimeout(r, 3000))
        } else {
          console.error(`[Telegram] Failed to start: ${msg}`)
        }
      }
    }
  }

  async stop(): Promise<void> {
    try {
      await this.bot.stop()
    } catch {
      // Already stopped
    }
  }
}

function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text]
  const parts: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    parts.push(remaining.slice(0, maxLen))
    remaining = remaining.slice(maxLen)
  }
  return parts
}
