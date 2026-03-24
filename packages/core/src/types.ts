// ─── Claude Code session message types ────────────────────────────────────────

export type ClaudeMessageRole = 'user' | 'assistant'

export interface ClaudeTextContent {
  type: 'text'
  text: string
}

export interface ClaudeToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ClaudeToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: string | ClaudeTextContent[]
  is_error?: boolean
}

export type ClaudeContent =
  | ClaudeTextContent
  | ClaudeToolUseContent
  | ClaudeToolResultContent
  | { type: string; [key: string]: unknown }

export interface ClaudeMessage {
  role: ClaudeMessageRole
  content: string | ClaudeContent[]
}

// Raw JSONL line types written by Claude Code
export type RawJSONLEntry =
  | { type: 'user'; uuid: string; message: ClaudeMessage; parent_uuid?: string | null }
  | { type: 'assistant'; uuid: string; message: ClaudeMessage; parent_uuid?: string | null }
  | { type: 'summary'; leafUuid: string; summary: string }
  | { type: 'system'; uuid: string; message: ClaudeMessage }

// ─── Session events emitted by SessionScanner ─────────────────────────────────

export interface SessionAssistantMessage {
  kind: 'assistant'
  sessionId: string
  uuid: string
  text: string // extracted plain text (tool uses stripped)
  raw: RawJSONLEntry
}

export interface SessionUserMessage {
  kind: 'user'
  sessionId: string
  uuid: string
  text: string
  raw: RawJSONLEntry
}

export type SessionEvent = SessionAssistantMessage | SessionUserMessage

// ─── IM Adapter interface ──────────────────────────────────────────────────────

export interface IncomingMessage {
  platform: string // 'telegram' | 'feishu' | ...
  chatId: string
  userId: string
  username?: string
  text: string
  messageId?: string
  replyToMessageId?: string
}

export interface IMAdapter {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  sendMessage(chatId: string, text: string): Promise<void | string>
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
  sendTyping(chatId: string): Promise<void>
  reactToMessage?(chatId: string, messageId: string, emoji: string): Promise<void>
}

// ─── Project routing ──────────────────────────────────────────────────────────

export interface ProjectRoute {
  alias: string
  projectPath: string
  sessionId: string | null
}

// ─── Bridge config ─────────────────────────────────────────────────────────────

export interface BridgeConfig {
  /** Absolute path to the Claude project directory to watch */
  projectPath: string
  /** Maximum time (ms) to wait for Claude to become idle before injecting a new message */
  idleTimeoutMs?: number
  /** Allowed IM user IDs per platform (empty = allow all) */
  allowedUsers?: Record<string, string[]>
}
