/**
 * iLink Bot API client for WeChat.
 *
 * Wraps the HTTP endpoints exposed by WeChat's iLink Bot platform.
 * All methods are stateless — auth token and base URL are set once at construction.
 */

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'

// ─── Response types ──────────────────────────────────────────────────────────

export interface ILinkMessageItem {
  type: number // 1=text, 2=image, 3=voice, 4=file, 5=video
  text_item?: { text: string }
  voice_item?: { recognize_text?: string }
  file_item?: { file_name?: string }
}

export interface ILinkMessage {
  from_user_id: string
  from_user_name?: string
  to_user_id: string
  client_id?: string
  message_type: number
  message_state: number
  item_list: ILinkMessageItem[]
  context_token: string
}

export interface GetUpdatesResponse {
  errcode: number
  errmsg?: string
  get_updates_buf?: string
  msgs?: ILinkMessage[]
}

export interface SendMessageResponse {
  errcode: number
  errmsg?: string
}

export interface GetConfigResponse {
  errcode: number
  errmsg?: string
  typing_ticket?: string
}

// ─── Auth types ──────────────────────────────────────────────────────────────

export interface AuthQRResponse {
  qrcode: string             // QR code content string (used for polling)
  qrcode_img_content: string // QR code image URL (for terminal rendering)
}

export type AuthStatus = 'wait' | 'scaned' | 'confirmed' | 'expired'

export interface AuthPollResponse {
  status: AuthStatus
  bot_token?: string         // returned when status === 'confirmed'
  ilink_bot_id?: string      // bot identifier (accountId)
  baseurl?: string           // optional custom API base URL
  ilink_user_id?: string     // user who scanned the QR code
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class ILinkAPI {
  private readonly baseUrl: string
  private readonly token: string
  private readonly uin: string

  constructor(token: string, baseUrl?: string) {
    this.token = token
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.uin = randomBase64Uin()
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${this.token}`,
      'X-WECHAT-UIN': this.uin,
    }
  }

  /**
   * Long-poll for new messages.
   * Returns immediately when messages arrive, or after ~35s timeout.
   */
  async getUpdates(buf: string, signal?: AbortSignal): Promise<GetUpdatesResponse> {
    const resp = await fetch(`${this.baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ get_updates_buf: buf }),
      signal,
    })
    if (!resp.ok) {
      throw new Error(`getUpdates HTTP ${resp.status}`)
    }
    return resp.json() as Promise<GetUpdatesResponse>
  }

  /**
   * Send a text message to a user.
   */
  async sendMessage(toUserId: string, text: string, contextToken: string): Promise<SendMessageResponse> {
    const body = {
      msg: {
        to_user_id: toUserId,
        client_id: `kite_${Date.now()}`,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text } }],
        context_token: contextToken,
      },
    }
    const resp = await fetch(`${this.baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      throw new Error(`sendMessage HTTP ${resp.status}`)
    }
    return resp.json() as Promise<SendMessageResponse>
  }

  /**
   * Send typing indicator.
   * status: 1 = start typing, 0 = stop typing
   */
  async sendTyping(toUserId: string, ticket: string, status = 1): Promise<void> {
    await fetch(`${this.baseUrl}/ilink/bot/sendtyping`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        to_user_id: toUserId,
        typing_ticket: ticket,
        status,
      }),
    }).catch(() => {}) // Best effort
  }

  /**
   * Get config (including typing_ticket) for a conversation.
   */
  async getConfig(userId: string, contextToken: string): Promise<GetConfigResponse> {
    const resp = await fetch(`${this.baseUrl}/ilink/bot/getconfig`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        user_id: userId,
        context_token: contextToken,
      }),
    })
    if (!resp.ok) {
      throw new Error(`getConfig HTTP ${resp.status}`)
    }
    return resp.json() as Promise<GetConfigResponse>
  }
}

// ─── Auth helpers (no token required) ────────────────────────────────────────

const POLL_STATUS_TIMEOUT_MS = 35_000

/**
 * Request a QR code for bot authorization.
 * The returned `qrcode_img_content` is a URL that can be rendered as a QR code in the terminal.
 */
export async function requestAuthQR(baseUrl?: string): Promise<AuthQRResponse> {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const resp = await fetch(`${base}/ilink/bot/get_bot_qrcode?bot_type=3`)
  if (!resp.ok) {
    throw new Error(`requestAuthQR HTTP ${resp.status}`)
  }
  return resp.json() as Promise<AuthQRResponse>
}

/**
 * Poll the auth status after the QR code has been displayed.
 * Uses long polling (35s timeout) — returns 'wait' → 'scaned' → 'confirmed' (with bot_token).
 * On timeout, returns { status: 'wait' } so the caller can retry.
 */
export async function pollAuthStatus(qrcode: string, baseUrl?: string): Promise<AuthPollResponse> {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POLL_STATUS_TIMEOUT_MS)
  try {
    const resp = await fetch(
      `${base}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      {
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal,
      },
    )
    clearTimeout(timer)
    if (!resp.ok) {
      throw new Error(`pollAuthStatus HTTP ${resp.status}`)
    }
    return resp.json() as Promise<AuthPollResponse>
  } catch (err) {
    clearTimeout(timer)
    // Timeout = server didn't respond within 35s, treat as "still waiting"
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { status: 'wait' }
    }
    throw err
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a random base64 UIN string for the X-WECHAT-UIN header */
function randomBase64Uin(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Extract readable text from an iLink message's item_list.
 */
export function extractText(items: ILinkMessageItem[]): string {
  const parts: string[] = []
  for (const item of items) {
    switch (item.type) {
      case 1: // text
        if (item.text_item?.text) parts.push(item.text_item.text)
        break
      case 2: // image
        parts.push('(image)')
        break
      case 3: // voice
        if (item.voice_item?.recognize_text) {
          parts.push(item.voice_item.recognize_text)
        } else {
          parts.push('(voice)')
        }
        break
      case 4: // file
        parts.push(item.file_item?.file_name ?? '(file)')
        break
      case 5: // video
        parts.push('(video)')
        break
    }
  }
  return parts.join(' ')
}
