// REC mode: masks what would leak on a screen recording. Display only —
// what the model reads is never touched.

const tag = (label: string) => `⟦${label}⟧`

const luhn = (digits: string): boolean => {
  let sum = 0
  let isDouble = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (isDouble) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    isDouble = !isDouble
  }
  return sum % 10 === 0
}

const isPesel = (s: string): boolean => {
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  let sum = 0
  for (let i = 0; i < 10; i++) sum += (w[i] ?? 0) * (s.charCodeAt(i) - 48)
  const month = Number(s.slice(2, 4)) % 20
  return (10 - (sum % 10)) % 10 === s.charCodeAt(10) - 48 && month >= 1 && month <= 12
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Rule = [RegExp, string | ((m: string, ...g: string[]) => string)]

const RULES: Rule[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, tag('private key')],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, tag('api key')],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, tag('stripe key')],
  [/\bwhsec_[A-Za-z0-9]{10,}/g, tag('webhook secret')],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, tag('api key')],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, tag('github token')],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, tag('slack token')],
  [/\bAKIA[0-9A-Z]{16}\b/g, tag('aws key')],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, tag('google key')],
  [/\bhf_[A-Za-z0-9]{20,}/g, tag('hf token')],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, tag('jwt')],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, (_m, kind) => `${kind} ${tag('token')}`],
  [
    /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_?SECRET)[A-Za-z0-9_]*)(\s*[=:]\s*)(["']?)([^\s"'`,;]{4,})\3/gi,
    (_m, key, sep, q) => `${key}${sep}${q}${tag('secret')}${q}`,
  ],
  [/:\/\/([^\s:/@]+):([^\s@/]+)@/g, (_m, user) => `://${user}:${tag('password')}@`],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, tag('email')],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g, m => (/\d{10}/.test(m.replace(/ /g, '')) ? tag('iban') : m)],
  [/\b(?:\d[ -]?){12,18}\d\b/g, m => (luhn(m.replace(/[ -]/g, '')) ? tag('card') : m)],
  [/\b\d{11}\b/g, m => (isPesel(m) ? tag('pesel') : m)],
  [/(?<![\w+])\+\d{1,3}[ -]?\d{2,3}[ -]?\d{3}[ -]?\d{3,4}\b/g, tag('phone')],
  [/\/Users\/[^/\s'"`]+/g, '~'],
  [/\/home\/[^/\s'"`]+/g, '~'],
]

export const redactText = (text: string, words: readonly string[] = []): string => {
  let out = text
  for (const [re, to] of RULES) out = out.replace(re, to as never)
  for (const w of words) {
    if (w.trim().length < 2) continue
    out = out.replace(new RegExp(escape(w.trim()), 'gi'), tag('hidden'))
  }
  return out
}

// Walks any value and masks every string in it, keeping its shape.
export const redactDeep = <T>(value: T, words: readonly string[] = [], depth = 0): T => {
  if (depth > 24) return value
  if (typeof value === 'string') return redactText(value, words) as T
  if (Array.isArray(value)) return value.map(v => redactDeep(v, words, depth + 1)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, words, depth + 1)
    return out as T
  }
  return value
}
