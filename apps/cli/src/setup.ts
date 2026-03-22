import * as p from '@clack/prompts'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ─── i18n ────────────────────────────────────────────────────────────────────

type Lang = 'en' | 'zh'

interface Messages {
  welcome: string
  selectPlatform: string
  platformTelegram: string
  platformFeishu: string
  platformWeixin: string
  platformWecom: string
  tgHeader: string
  tgToken: string
  tgTokenPlaceholder: string
  tgTokenError: string
  tgAllowed: string
  tgAllowedPlaceholder: string
  tgTestAsk: string
  tgTestOk: (name: string) => string
  tgTestFail: (err: string) => string
  tgTestSkip: string
  feishuHeader: string
  feishuAppId: string
  feishuAppIdPlaceholder: string
  feishuAppSecret: string
  feishuAppSecretPlaceholder: string
  feishuAllowed: string
  feishuAllowedPlaceholder: string
  feishuTestAsk: string
  feishuTestOk: (name: string) => string
  feishuTestFail: (err: string) => string
  feishuTestSkip: string
  wxHeader: string
  wxBaseUrl: string
  wxBaseUrlPlaceholder: string
  wxAllowed: string
  wxAllowedPlaceholder: string
  wxScanPrompt: string
  wxScanWaiting: string
  wxScanScanned: string
  wxScanOk: string
  wxScanFail: (err: string) => string
  wxManualFallback: string
  wxToken: string
  wxTokenPlaceholder: string
  wecomHeader: string
  wecomBotId: string
  wecomBotIdPlaceholder: string
  wecomSecret: string
  wecomSecretPlaceholder: string
  wecomAllowed: string
  wecomAllowedPlaceholder: string
  wecomTestAsk: string
  wecomTestOk: (name: string) => string
  wecomTestFail: (err: string) => string
  wecomTestSkip: string
  saveFailedContinue: string
  saved: (path: string) => string
  cancelled: string
  done: string
}

const messages: Record<Lang, Messages> = {
  en: {
    welcome: 'Kite Setup',
    selectPlatform: 'Select IM platforms to configure (press Space to select, Enter to confirm):',
    platformTelegram: 'Telegram',
    platformFeishu: 'Feishu / Lark',
    platformWeixin: 'WeChat (iLink Bot)',
    platformWecom: 'WeCom (企业微信)',
    tgHeader: 'Telegram',
    tgToken: 'Bot Token (from @BotFather):',
    tgTokenPlaceholder: '7123456789:AAH...',
    tgTokenError: 'Token must contain a colon (:)',
    tgAllowed: 'Allowed User IDs (comma-separated, empty = allow all):',
    tgAllowedPlaceholder: '123456,789012',
    tgTestAsk: 'Test connection now?',
    tgTestOk: (name: string) => `Bot @${name} connected!`,
    tgTestFail: (err: string) => `Connection failed: ${err}`,
    tgTestSkip: 'Skipped connection test.',

    feishuHeader: 'Feishu / Lark',
    feishuAppId: 'App ID:',
    feishuAppIdPlaceholder: 'cli_xxx',
    feishuAppSecret: 'App Secret:',
    feishuAppSecretPlaceholder: 'xxx',
    feishuAllowed: 'Allowed User IDs (comma-separated, empty = allow all):',
    feishuAllowedPlaceholder: 'ou_xxx,ou_yyy',
    feishuTestAsk: 'Test connection now?',
    feishuTestOk: (name: string) => `App "${name}" connected!`,
    feishuTestFail: (err: string) => `Connection failed: ${err}`,
    feishuTestSkip: 'Skipped connection test.',

    wxHeader: 'WeChat (iLink Bot)',
    wxBaseUrl: 'API Base URL (leave empty for default):',
    wxBaseUrlPlaceholder: 'https://ilinkai.weixin.qq.com',
    wxAllowed: 'Allowed User IDs (comma-separated, empty = allow all):',
    wxAllowedPlaceholder: 'wxid_xxx,wxid_yyy',
    wxScanPrompt: 'Scan this QR code with WeChat to authorize:',
    wxScanWaiting: 'Waiting for scan...',
    wxScanScanned: 'Scanned! Please confirm on your phone...',
    wxScanOk: 'WeChat bot authorized!',
    wxScanFail: (err: string) => `Authorization failed: ${err}`,
    wxManualFallback: 'QR code unavailable. Enter token manually:',
    wxToken: 'iLink Bot Token:',
    wxTokenPlaceholder: 'ilk_xxx...',

    wecomHeader: 'WeCom (企业微信)',
    wecomBotId: 'Bot ID:',
    wecomBotIdPlaceholder: 'xxx',
    wecomSecret: 'Bot Secret:',
    wecomSecretPlaceholder: 'xxx',
    wecomAllowed: 'Allowed User IDs (comma-separated, empty = allow all):',
    wecomAllowedPlaceholder: 'userid1,userid2',
    wecomTestAsk: 'Test connection now?',
    wecomTestOk: (name: string) => `Bot "${name}" connected!`,
    wecomTestFail: (err: string) => `Connection failed: ${err}`,
    wecomTestSkip: 'Skipped connection test.',

    saveFailedContinue: 'Save anyway despite test failure?',
    saved: (path: string) => `Configuration saved to ${path}`,
    cancelled: 'Setup cancelled.',
    done: 'Done! Run `kite` to start.',
  },
  zh: {
    welcome: 'Kite 配置向导',
    selectPlatform: '选择要配置的 IM 平台（空格选中，回车确认）：',
    platformTelegram: 'Telegram',
    platformFeishu: '飞书 / Lark',
    platformWeixin: '微信（iLink Bot）',
    platformWecom: '企业微信（WeCom）',
    tgHeader: 'Telegram',
    tgToken: 'Bot Token（从 @BotFather 获取）：',
    tgTokenPlaceholder: '7123456789:AAH...',
    tgTokenError: 'Token 必须包含冒号（:）',
    tgAllowed: '允许的用户 ID（逗号分隔，留空 = 允许所有人）：',
    tgAllowedPlaceholder: '123456,789012',
    tgTestAsk: '现在测试连接？',
    tgTestOk: (name: string) => `Bot @${name} 连接成功！`,
    tgTestFail: (err: string) => `连接失败：${err}`,
    tgTestSkip: '跳过连接测试。',

    feishuHeader: '飞书 / Lark',
    feishuAppId: 'App ID：',
    feishuAppIdPlaceholder: 'cli_xxx',
    feishuAppSecret: 'App Secret：',
    feishuAppSecretPlaceholder: 'xxx',
    feishuAllowed: '允许的用户 ID（逗号分隔，留空 = 允许所有人）：',
    feishuAllowedPlaceholder: 'ou_xxx,ou_yyy',
    feishuTestAsk: '现在测试连接？',
    feishuTestOk: (name: string) => `应用「${name}」连接成功！`,
    feishuTestFail: (err: string) => `连接失败：${err}`,
    feishuTestSkip: '跳过连接测试。',

    wxHeader: '微信（iLink Bot）',
    wxBaseUrl: 'API 地址（留空使用默认值）：',
    wxBaseUrlPlaceholder: 'https://ilinkai.weixin.qq.com',
    wxAllowed: '允许的用户 ID（逗号分隔，留空 = 允许所有人）：',
    wxAllowedPlaceholder: 'wxid_xxx,wxid_yyy',
    wxScanPrompt: '请用微信扫描下方二维码完成授权：',
    wxScanWaiting: '等待扫码...',
    wxScanScanned: '已扫码，请在手机上确认...',
    wxScanOk: '微信 Bot 授权成功！',
    wxScanFail: (err: string) => `授权失败：${err}`,
    wxManualFallback: '无法生成二维码，请手动输入 Token：',
    wxToken: 'iLink Bot Token：',
    wxTokenPlaceholder: 'ilk_xxx...',

    wecomHeader: '企业微信（WeCom）',
    wecomBotId: 'Bot ID：',
    wecomBotIdPlaceholder: 'xxx',
    wecomSecret: 'Bot Secret：',
    wecomSecretPlaceholder: 'xxx',
    wecomAllowed: '允许的用户 ID（逗号分隔，留空 = 允许所有人）：',
    wecomAllowedPlaceholder: 'userid1,userid2',
    wecomTestAsk: '现在测试连接？',
    wecomTestOk: (name: string) => `Bot「${name}」连接成功！`,
    wecomTestFail: (err: string) => `连接失败：${err}`,
    wecomTestSkip: '跳过连接测试。',

    saveFailedContinue: '测试失败，仍然保存？',
    saved: (path: string) => `配置已保存到 ${path}`,
    cancelled: '已取消配置。',
    done: '配置完成！运行 `kite` 开始使用。',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.config', 'kite')
const CONFIG_PATH = join(CONFIG_DIR, '.env')

function isCancel(value: unknown): value is symbol {
  return p.isCancel(value)
}

function bail(t: Messages): never {
  p.cancel(t.cancelled)
  process.exit(0)
}

/** Read existing .env config as key-value map */
function readExistingConfig(): Record<string, string> {
  const map: Record<string, string> = {}
  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      map[key] = value
    }
  } catch {
    // no existing config
  }
  return map
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runSetup() {
  const existing = readExistingConfig()

  p.intro('\u{1FA81} Kite Setup')

  // 1. Language
  const lang = await p.select({
    message: 'Language / 语言:',
    options: [
      { value: 'en' as Lang, label: 'English' },
      { value: 'zh' as Lang, label: '中文' },
    ],
  })
  if (isCancel(lang)) bail(messages.en)
  const t = messages[lang]

  // 2. Select platforms
  const platforms = await p.multiselect({
    message: t.selectPlatform,
    options: [
      { value: 'telegram', label: t.platformTelegram },
      { value: 'feishu', label: t.platformFeishu },
      { value: 'weixin', label: t.platformWeixin },
      { value: 'wecom', label: t.platformWecom },
    ],
    required: true,
  })
  if (isCancel(platforms)) bail(t)

  // Config values to save
  let tgToken = ''
  let tgAllowed = ''
  let feishuAppId = ''
  let feishuAppSecret = ''
  let feishuAllowed = ''
  let wxToken = ''
  let wxBaseUrl = ''
  let wxAllowed = ''
  let wecomBotId = ''
  let wecomSecret = ''
  let wecomAllowed = ''

  // 3. Telegram configuration
  if (platforms.includes('telegram')) {
    p.log.step(`── ${t.tgHeader} ──`)

    const token = await p.text({
      message: t.tgToken,
      placeholder: t.tgTokenPlaceholder,
      initialValue: existing.TELEGRAM_BOT_TOKEN || '',
      validate: (val) => {
        if (!val.includes(':')) return t.tgTokenError
      },
    })
    if (isCancel(token)) bail(t)
    tgToken = token

    const allowed = await p.text({
      message: t.tgAllowed,
      placeholder: t.tgAllowedPlaceholder,
      initialValue: existing.TELEGRAM_ALLOWED_USER_IDS || '',
    })
    if (isCancel(allowed)) bail(t)
    tgAllowed = allowed ?? ''

    // Connection test
    const doTest = await p.confirm({ message: t.tgTestAsk })
    if (isCancel(doTest)) bail(t)

    if (doTest) {
      const s = p.spinner()
      s.start('Testing...')
      try {
        const { TelegramAdapter } = await import('@kite/telegram')
        const username = await TelegramAdapter.testConnection(tgToken)
        s.stop(t.tgTestOk(username))
      } catch (err: any) {
        s.stop(t.tgTestFail(err?.message ?? String(err)))
        const saveAnyway = await p.confirm({ message: t.saveFailedContinue })
        if (isCancel(saveAnyway) || !saveAnyway) bail(t)
      }
    } else {
      p.log.info(t.tgTestSkip)
    }
  }

  // 4. Feishu configuration
  if (platforms.includes('feishu')) {
    p.log.step(`── ${t.feishuHeader} ──`)

    const appId = await p.text({
      message: t.feishuAppId,
      placeholder: t.feishuAppIdPlaceholder,
      initialValue: existing.FEISHU_APP_ID || '',
      validate: (val) => {
        if (!val.trim()) return 'Required'
      },
    })
    if (isCancel(appId)) bail(t)
    feishuAppId = appId

    const appSecret = await p.text({
      message: t.feishuAppSecret,
      placeholder: t.feishuAppSecretPlaceholder,
      initialValue: existing.FEISHU_APP_SECRET || '',
      validate: (val) => {
        if (!val.trim()) return 'Required'
      },
    })
    if (isCancel(appSecret)) bail(t)
    feishuAppSecret = appSecret

    const allowed = await p.text({
      message: t.feishuAllowed,
      placeholder: t.feishuAllowedPlaceholder,
      initialValue: existing.FEISHU_ALLOWED_USER_IDS || '',
    })
    if (isCancel(allowed)) bail(t)
    feishuAllowed = allowed ?? ''

    // Connection test
    const doTest = await p.confirm({ message: t.feishuTestAsk })
    if (isCancel(doTest)) bail(t)

    if (doTest) {
      const s = p.spinner()
      s.start('Testing...')
      try {
        const { FeishuAdapter } = await import('@kite/feishu')
        const botName = await FeishuAdapter.testConnection(feishuAppId, feishuAppSecret)
        s.stop(t.feishuTestOk(botName))
      } catch (err: any) {
        s.stop(t.feishuTestFail(err?.message ?? String(err)))
        const saveAnyway = await p.confirm({ message: t.saveFailedContinue })
        if (isCancel(saveAnyway) || !saveAnyway) bail(t)
      }
    } else {
      p.log.info(t.feishuTestSkip)
    }
  }

  // 5. WeChat configuration
  if (platforms.includes('weixin')) {
    p.log.step(`── ${t.wxHeader} ──`)

    // Optional: custom base URL (only for self-hosted / testing)
    const baseUrl = await p.text({
      message: t.wxBaseUrl,
      placeholder: t.wxBaseUrlPlaceholder,
      initialValue: existing.WEIXIN_BASE_URL || '',
    })
    if (isCancel(baseUrl)) bail(t)
    wxBaseUrl = baseUrl ?? ''

    // If already have a token, offer to reuse it
    if (existing.WEIXIN_BOT_TOKEN) {
      const reuse = await p.confirm({
        message: lang === 'zh'
          ? '检测到已有 Token，是否继续使用？'
          : 'Existing token found. Keep using it?',
      })
      if (isCancel(reuse)) bail(t)
      if (reuse) {
        wxToken = existing.WEIXIN_BOT_TOKEN
      }
    }

    // QR code authorization flow
    if (!wxToken) {
      const s = p.spinner()
      s.start(t.wxScanWaiting)
      try {
        const { requestAuthQR, pollAuthStatus } = await import('@kite/weixin')
        const qrResp = await requestAuthQR(wxBaseUrl || undefined)
        s.stop('')

        // Render QR code in terminal
        const QRCode = await import('qrcode')
        const qrText = await QRCode.toString(qrResp.qrcode_img_content, { type: 'terminal', small: true })
        p.log.message(t.wxScanPrompt)
        console.log(qrText)

        // Poll for authorization (8 min total timeout, long-poll per request)
        const s2 = p.spinner()
        s2.start(t.wxScanWaiting)
        const deadline = Date.now() + 480_000
        let lastStatus = ''

        while (Date.now() < deadline) {
          const poll = await pollAuthStatus(qrResp.qrcode, wxBaseUrl || undefined)

          if (poll.status !== lastStatus) {
            lastStatus = poll.status
            if (poll.status === 'scaned') {
              s2.message(t.wxScanScanned)
            }
          }

          if (poll.status === 'confirmed' && poll.bot_token) {
            wxToken = poll.bot_token
            s2.stop(t.wxScanOk)
            break
          }

          if (poll.status === 'expired') {
            break
          }

          // Small delay before next long-poll cycle
          await new Promise((r) => setTimeout(r, 1000))
        }

        if (!wxToken) {
          s2.stop(t.wxScanFail(lang === 'zh' ? '二维码已过期' : 'QR code expired'))
        }
      } catch (err: any) {
        s.stop(t.wxScanFail(err?.message ?? String(err)))
      }

      // Fallback to manual token entry if QR auth failed
      if (!wxToken) {
        const token = await p.text({
          message: t.wxManualFallback,
          placeholder: t.wxTokenPlaceholder,
          validate: (val) => {
            if (!val.trim()) return lang === 'zh' ? 'Token 不能为空' : 'Token is required'
          },
        })
        if (isCancel(token)) bail(t)
        wxToken = token
      }
    }

    const allowed = await p.text({
      message: t.wxAllowed,
      placeholder: t.wxAllowedPlaceholder,
      initialValue: existing.WEIXIN_ALLOWED_USER_IDS || '',
    })
    if (isCancel(allowed)) bail(t)
    wxAllowed = allowed ?? ''
  }

  // 6. WeCom configuration
  if (platforms.includes('wecom')) {
    p.log.step(`── ${t.wecomHeader} ──`)

    const botId = await p.text({
      message: t.wecomBotId,
      placeholder: t.wecomBotIdPlaceholder,
      initialValue: existing.WECOM_BOT_ID || '',
      validate: (val) => {
        if (!val.trim()) return 'Required'
      },
    })
    if (isCancel(botId)) bail(t)
    wecomBotId = botId

    const secret = await p.text({
      message: t.wecomSecret,
      placeholder: t.wecomSecretPlaceholder,
      initialValue: existing.WECOM_BOT_SECRET || '',
      validate: (val) => {
        if (!val.trim()) return 'Required'
      },
    })
    if (isCancel(secret)) bail(t)
    wecomSecret = secret

    const allowed = await p.text({
      message: t.wecomAllowed,
      placeholder: t.wecomAllowedPlaceholder,
      initialValue: existing.WECOM_ALLOWED_USER_IDS || '',
    })
    if (isCancel(allowed)) bail(t)
    wecomAllowed = allowed ?? ''

    // Connection test
    const doTest = await p.confirm({ message: t.wecomTestAsk })
    if (isCancel(doTest)) bail(t)

    if (doTest) {
      const s = p.spinner()
      s.start('Testing...')
      try {
        const { WecomAdapter } = await import('@kite/wecom')
        const name = await WecomAdapter.testConnection(wecomBotId, wecomSecret)
        s.stop(t.wecomTestOk(name))
      } catch (err: any) {
        s.stop(t.wecomTestFail(err?.message ?? String(err)))
        const saveAnyway = await p.confirm({ message: t.saveFailedContinue })
        if (isCancel(saveAnyway) || !saveAnyway) bail(t)
      }
    } else {
      p.log.info(t.wecomTestSkip)
    }
  }

  // 7. Save
  // Build .env content
  const lines: string[] = [
    '# Kite Configuration',
    '# Generated by: kite setup',
    '',
  ]

  if (platforms.includes('telegram')) {
    lines.push('# ── Telegram ──')
    lines.push(`TELEGRAM_BOT_TOKEN=${tgToken}`)
    lines.push(`TELEGRAM_ALLOWED_USER_IDS=${tgAllowed}`)
    lines.push('')
  }

  if (platforms.includes('feishu')) {
    lines.push('# ── Feishu / Lark ──')
    lines.push(`FEISHU_APP_ID=${feishuAppId}`)
    lines.push(`FEISHU_APP_SECRET=${feishuAppSecret}`)
    lines.push(`FEISHU_ALLOWED_USER_IDS=${feishuAllowed}`)
    lines.push('')
  }

  if (platforms.includes('weixin')) {
    lines.push('# ── WeChat (iLink Bot) ──')
    lines.push(`WEIXIN_BOT_TOKEN=${wxToken}`)
    if (wxBaseUrl) lines.push(`WEIXIN_BASE_URL=${wxBaseUrl}`)
    lines.push(`WEIXIN_ALLOWED_USER_IDS=${wxAllowed}`)
    lines.push('')
  }

  if (platforms.includes('wecom')) {
    lines.push('# ── WeCom (企业微信) ──')
    lines.push(`WECOM_BOT_ID=${wecomBotId}`)
    lines.push(`WECOM_BOT_SECRET=${wecomSecret}`)
    lines.push(`WECOM_ALLOWED_USER_IDS=${wecomAllowed}`)
    lines.push('')
  }

  // Write
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, lines.join('\n'), 'utf-8')

  p.log.success(t.saved(CONFIG_PATH))
  p.outro(t.done)
}
