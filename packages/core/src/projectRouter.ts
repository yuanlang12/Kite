import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { findLatestSessionId } from './sessionManager.js'
import type { ProjectRoute } from './types.js'

interface ProjectEntry {
  projectPath: string
}

interface ProjectsConfig {
  projects: Record<string, ProjectEntry>
  bindings: Record<string, string> // chatKey -> alias
}

const CONFIG_DIR = join(homedir(), '.config', 'kite')
const CONFIG_FILE = join(CONFIG_DIR, 'projects.json')

export class ProjectRouter {
  private projects = new Map<string, ProjectRoute>()
  private bindings = new Map<string, string>() // chatKey -> alias
  private registeredAliases = new Set<string>() // manually added via /addproject (not auto-discovered)
  private defaultAlias: string

  constructor(defaultProjectPath: string) {
    this.defaultAlias = 'default'
    this.projects.set(this.defaultAlias, {
      alias: this.defaultAlias,
      projectPath: resolve(defaultProjectPath),
      sessionId: null,
    })
    this.load()
    this.autoDiscover()
  }

  /** Resolve chatKey to its bound project, or return the default */
  resolve(chatKey: string): ProjectRoute {
    const alias = this.bindings.get(chatKey)
    if (alias) {
      const route = this.projects.get(alias)
      if (route) return route
    }
    return this.projects.get(this.defaultAlias)!
  }

  /** Ensure the route has a sessionId, discovering one if needed */
  async ensureSessionId(route: ProjectRoute): Promise<string | null> {
    if (route.sessionId) return route.sessionId
    const sid = await findLatestSessionId(route.projectPath)
    if (sid) {
      route.sessionId = sid
      // No need to persist sessionId — it's a runtime cache
    }
    return sid
  }

  addProject(alias: string, projectPath: string): { ok: boolean; error?: string } {
    const absPath = resolve(projectPath.replace(/^~/, homedir()))
    if (!existsSync(absPath)) {
      return { ok: false, error: `Path not found: ${absPath}` }
    }
    if (alias === this.defaultAlias) {
      return { ok: false, error: `Cannot use reserved name "${this.defaultAlias}"` }
    }
    this.projects.set(alias, { alias, projectPath: absPath, sessionId: null })
    this.registeredAliases.add(alias)
    this.save()
    return { ok: true }
  }

  removeProject(alias: string): { ok: boolean; error?: string } {
    if (alias === this.defaultAlias) {
      return { ok: false, error: `Cannot remove the default project` }
    }
    if (!this.projects.has(alias)) {
      return { ok: false, error: `Unknown project: ${alias}` }
    }
    this.projects.delete(alias)
    this.registeredAliases.delete(alias)
    // Clean up bindings pointing to this project
    for (const [key, val] of this.bindings) {
      if (val === alias) this.bindings.delete(key)
    }
    this.save()
    return { ok: true }
  }

  bind(chatKey: string, alias: string): { ok: boolean; error?: string } {
    if (!this.projects.has(alias)) {
      const available = [...this.projects.keys()].filter((k) => k !== this.defaultAlias)
      return {
        ok: false,
        error: `Unknown project: ${alias}\nAvailable: ${available.length ? available.join(', ') : '(none)'}`,
      }
    }
    this.bindings.set(chatKey, alias)
    this.save()
    return { ok: true }
  }

  unbind(chatKey: string): void {
    this.bindings.delete(chatKey)
    this.save()
  }

  listProjects(): ProjectRoute[] {
    return [...this.projects.values()]
  }

  /** List only manually registered projects (via /addproject), excluding auto-discovered ones */
  listRegisteredProjects(): ProjectRoute[] {
    return [...this.registeredAliases]
      .map((alias) => this.projects.get(alias))
      .filter((r): r is ProjectRoute => r !== undefined)
  }

  listBindings(): Array<{ chatKey: string; alias: string }> {
    return [...this.bindings.entries()].map(([chatKey, alias]) => ({ chatKey, alias }))
  }

  /** Get all unique project paths that have at least one binding */
  getBoundProjectPaths(): string[] {
    const paths = new Set<string>()
    for (const alias of this.bindings.values()) {
      const route = this.projects.get(alias)
      if (route) paths.add(route.projectPath)
    }
    // Always include default
    paths.add(this.projects.get(this.defaultAlias)!.projectPath)
    return [...paths]
  }

  private save(): void {
    const config: ProjectsConfig = { projects: {}, bindings: {} }
    // Only persist manually registered projects — not auto-discovered ones
    for (const alias of this.registeredAliases) {
      const route = this.projects.get(alias)
      if (route) config.projects[alias] = { projectPath: route.projectPath }
    }
    for (const [chatKey, alias] of this.bindings) {
      config.bindings[chatKey] = alias
    }
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
  }

  private load(): void {
    if (!existsSync(CONFIG_FILE)) return
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf-8')
      const config: ProjectsConfig = JSON.parse(raw)

      if (config.projects) {
        for (const [alias, entry] of Object.entries(config.projects)) {
          if (alias === this.defaultAlias) continue
          this.projects.set(alias, {
            alias,
            projectPath: entry.projectPath,
            sessionId: null,
          })
          this.registeredAliases.add(alias)
        }
      }

      if (config.bindings) {
        for (const [chatKey, alias] of Object.entries(config.bindings)) {
          // Only load bindings for projects that still exist
          if (this.projects.has(alias)) {
            this.bindings.set(chatKey, alias)
          }
        }
      }
    } catch {
      // Corrupted config — start fresh
    }
  }

  /**
   * Auto-discover projects from Claude Code's project history.
   * Claude stores sessions at ~/.claude/projects/<encoded-path>/
   * We decode the directory names to find project paths that exist on disk.
   */
  private autoDiscover(): void {
    const claudeProjectsDir = join(homedir(), '.claude', 'projects')
    if (!existsSync(claudeProjectsDir)) return

    let dirs: string[]
    try {
      dirs = readdirSync(claudeProjectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return
    }

    // Track existing project paths to avoid duplicates
    const knownPaths = new Set<string>()
    for (const route of this.projects.values()) {
      knownPaths.add(route.projectPath)
    }

    // Track aliases to handle name conflicts
    const usedAliases = new Set(this.projects.keys())

    for (const encoded of dirs) {
      // Decode: the encoding is encodeURIComponent(path).replace(/%2F/g, '-')
      // Reverse: replace '-' back to '%2F', then decodeURIComponent
      const decoded = tryDecodePath(encoded)
      if (!decoded || !existsSync(decoded) || knownPaths.has(decoded)) continue

      // Use the folder name as alias
      let alias = basename(decoded)
      if (!alias) continue // Skip empty aliases from decode failures
      if (usedAliases.has(alias)) {
        // Conflict — add parent folder name
        const parent = basename(resolve(decoded, '..'))
        alias = `${parent}/${alias}`
      }
      if (usedAliases.has(alias) || alias === this.defaultAlias) continue

      this.projects.set(alias, { alias, projectPath: decoded, sessionId: null })
      knownPaths.add(decoded)
      usedAliases.add(alias)
    }
  }
}

/**
 * Try to decode a Claude projects directory name back to a file path.
 * Encoding: encodeURIComponent(path).replace(/%2F/g, '-')
 * This is ambiguous when paths contain '-', so we verify the result exists.
 */
function tryDecodePath(encoded: string): string | null {
  try {
    // The simple approach: replace '-' with '/' since paths start with '/'
    // and encodeURIComponent doesn't encode '-'
    // But we need to be smarter — only '-' that represent '/' should be replaced
    // Strategy: try decodeURIComponent with '-' → '%2F', check if path exists
    const withSlashes = decodeURIComponent(encoded.replace(/-/g, '%2F'))
    if (existsSync(withSlashes)) return withSlashes

    // Fallback: the encoded form might use a different scheme
    // Try raw decodeURIComponent (some versions don't replace %2F)
    const raw = decodeURIComponent(encoded)
    if (existsSync(raw)) return raw

    return null
  } catch {
    return null
  }
}
