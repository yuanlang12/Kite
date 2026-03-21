import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

interface AccessState {
  mode: 'open' | 'pairing' | 'allowlist'
  allowed: string[]   // approved user IDs
  pending: Record<string, { userId: string; username?: string; expiresAt: number }>
}

const ACCESS_DIR = join(homedir(), '.config', 'kite')
const ACCESS_FILE = join(ACCESS_DIR, 'access.json')

function loadState(): AccessState {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf-8')
    return JSON.parse(raw) as AccessState
  } catch {
    return { mode: 'open', allowed: [], pending: {} }
  }
}

function saveState(state: AccessState): void {
  mkdirSync(ACCESS_DIR, { recursive: true })
  writeFileSync(ACCESS_FILE, JSON.stringify(state, null, 2))
}

/**
 * Access gate for IM users. Supports three modes:
 * - open: everyone allowed (default when ALLOWED_USER_IDS is empty)
 * - pairing: unknown users get a 6-char code to approve in terminal
 * - allowlist: only approved users, unknown silently ignored
 */
export class AccessGate {
  private state: AccessState

  constructor(allowedUserIds?: string[]) {
    this.state = loadState()

    // If env var has explicit user IDs, use allowlist mode
    if (allowedUserIds && allowedUserIds.length > 0) {
      this.state.mode = 'allowlist'
      // Merge env var IDs into saved state
      for (const id of allowedUserIds) {
        if (!this.state.allowed.includes(id)) {
          this.state.allowed.push(id)
        }
      }
      saveState(this.state)
    } else if (this.state.allowed.length > 0) {
      // Has approved users from previous sessions → pairing mode
      this.state.mode = 'pairing'
    }
    // else: open mode (no env var, no saved users)

    // Clean expired pending
    this.cleanExpired()
  }

  get mode(): string {
    return this.state.mode
  }

  /** Check if a user is allowed. Returns true/false/'pending' */
  check(userId: string): 'allowed' | 'denied' | 'needs_pairing' {
    if (this.state.mode === 'open') return 'allowed'
    if (this.state.allowed.includes(userId)) return 'allowed'
    if (this.state.mode === 'allowlist') return 'denied'
    return 'needs_pairing' // pairing mode, unknown user
  }

  /** Generate a pairing code for a new user */
  createPairing(userId: string, username?: string): string {
    this.cleanExpired()
    // Check if already pending
    for (const [code, p] of Object.entries(this.state.pending)) {
      if (p.userId === userId) return code
    }
    const code = randomBytes(3).toString('hex').toUpperCase()
    this.state.pending[code] = {
      userId,
      username,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
    }
    saveState(this.state)
    return code
  }

  /** Approve a pairing code. Returns the user info or null if invalid. */
  approvePairing(code: string): { userId: string; username?: string } | null {
    this.cleanExpired()
    const upper = code.toUpperCase()
    const pending = this.state.pending[upper]
    if (!pending) return null

    this.state.allowed.push(pending.userId)
    delete this.state.pending[upper]
    // Switch to pairing mode after first approval (no longer fully open)
    if (this.state.mode === 'open') {
      this.state.mode = 'pairing'
    }
    saveState(this.state)
    return { userId: pending.userId, username: pending.username }
  }

  /** List pending pairings */
  listPending(): Array<{ code: string; userId: string; username?: string }> {
    this.cleanExpired()
    return Object.entries(this.state.pending).map(([code, p]) => ({
      code,
      userId: p.userId,
      username: p.username,
    }))
  }

  private cleanExpired() {
    const now = Date.now()
    let changed = false
    for (const [code, p] of Object.entries(this.state.pending)) {
      if (p.expiresAt < now) {
        delete this.state.pending[code]
        changed = true
      }
    }
    if (changed) saveState(this.state)
  }
}
