#!/usr/bin/env bun

import { launch } from '@kite/core'
import type { IMAdapter } from '@kite/core'
import { TelegramAdapter } from '@kite/telegram'
import { FeishuAdapter } from '@kite/feishu'
import { resolve, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

// ─── Load config from ~/.config/kite/.env ───────────────────────────────────

function loadConfigEnv() {
  const configPath = join(homedir(), '.config', 'kite', '.env')
  try {
    const content = readFileSync(configPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      // Don't override existing env vars (shell exports take priority)
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // Config file doesn't exist — that's fine
  }
}

loadConfigEnv()

// ─── Handle `kite setup` subcommand ─────────────────────────────────────────

if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./setup.js')
  await runSetup()
  process.exit(0)
}

// ─── Config from environment variables ────────────────────────────────────────

const PROJECT_PATH = resolve(
  process.env.CLAUDE_PROJECT_PATH ?? process.cwd()
)

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_ALLOWED = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

const FEISHU_APP_ID = process.env.FEISHU_APP_ID
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET
const FEISHU_ALLOWED = (process.env.FEISHU_ALLOWED_USER_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

// ─── Parse CLI args ──────────────────────────────────────────────────────────
// All args are transparently passed to claude.
// kite [claude args...]

const claudeArgs = process.argv.slice(2)

// ─── Build IM adapters ───────────────────────────────────────────────────────

const adapters: IMAdapter[] = []

if (TELEGRAM_TOKEN) {
  const tg = new TelegramAdapter({
    token: TELEGRAM_TOKEN,
    allowedUserIds: TELEGRAM_ALLOWED,
  })
  adapters.push(tg)
  console.log('[Kite] Telegram adapter registered')
} else {
  console.warn('[Kite] TELEGRAM_BOT_TOKEN not set — Telegram disabled')
}

if (FEISHU_APP_ID && FEISHU_APP_SECRET) {
  const feishu = new FeishuAdapter({
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    allowedUserIds: FEISHU_ALLOWED,
  })
  adapters.push(feishu)
  console.log('[Kite] Feishu adapter registered')
}

// ─── Launch ──────────────────────────────────────────────────────────────────

// First-run detection: no config file + no env vars + no adapters
const configFileExists = existsSync(join(homedir(), '.config', 'kite', '.env'))
if (adapters.length === 0 && !configFileExists) {
  console.log('\n  Welcome to Kite! No configuration found.')
  console.log('  Run \x1b[1mkite setup\x1b[0m to get started.\n')
  process.exit(0)
}

console.log(`[Kite] Starting kite — Claude Code with IM bridge`)
console.log(`[Kite] Project path: ${PROJECT_PATH}`)
if (adapters.length === 0) {
  console.warn('[Kite] No IM adapters configured. Running as plain Claude launcher.')
}

// Prevent macOS idle sleep when IM adapters are active
let caffeinate: ReturnType<typeof spawn> | null = null
if (adapters.length > 0 && process.platform === 'darwin') {
  caffeinate = spawn('caffeinate', ['-i'], { stdio: 'ignore', detached: true })
  caffeinate.unref()
}

launch({
  projectPath: PROJECT_PATH,
  claudeArgs,
  adapters,
}).finally(() => {
  caffeinate?.kill()
}).catch((err) => {
  console.error('[Kite] Fatal error:', err)
  process.exit(1)
})
