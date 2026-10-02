/** Browser half: settings-owned token form plus a repository picker in the composer. */
import { createElement as h, useEffect, useState } from 'react'
import { Button, Input, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

const json = { mode: 'src-json' }
const descriptor = (id, method, parameters = []) => ({
  id: `dsh-github-tk:${method}`,
  service: 'githubCloudController',
  namespace: 'githubCloud',
  method,
  invocation: { kind: 'direct' },
  parameters: parameters.map(name => ({ name, wire: name, source: 'json', codec: json })),
  result: json,
})

const contribution = {
  package: 'dsh-github-tk',
  descriptors: [
    descriptor('githubCloud.status', 'status'),
    descriptor('githubCloud.repositories', 'repositories'),
    descriptor('githubCloud.selected', 'selected', ['sessionId']),
    descriptor('githubCloud.select', 'select', ['sessionId', 'repository', 'branch']),
  ],
}

function messageOf(result) {
  return result?.ok ? '' : (result?.error?.message || 'GitHub service is unavailable.')
}

function GitHubSettings({ remote }) {
  const [tokenRef, setTokenRef] = useState('GITHUB_TOKEN')
  const [token, setToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const refresh = async () => {
    const response = await remote.githubCloud.status()
    if (!response.ok) return setNotice(messageOf(response))
    setTokenRef(response.value.tokenRef)
    setConfigured(response.value.configured)
  }
  useEffect(() => { void refresh() }, [])
  const save = async () => {
    if (!token.trim()) return setNotice('请输入 GitHub Token。')
    setSaving(true); setNotice('')
    try {
      const response = await remote.credentials.set(tokenRef, token.trim())
      if (!response.ok) throw new Error(messageOf(response))
      setToken(''); setConfigured(true); setNotice('Token 已保存。')
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败。') } finally { setSaving(false) }
  }
  return h('section', { style: { maxWidth: 680, padding: '8px 0' } },
    h('h2', null, 'GitHub 云端项目'),
    h('p', { style: { color: 'var(--dsw-alias-text-secondary, #666)' } }, '保存经典 Token 或细粒度 Token。令牌只写入 DSH 凭据存储，不会显示或写入聊天记录。'),
    h('label', { htmlFor: 'dsh-github-token', style: { display: 'block', margin: '20px 0 8px', fontWeight: 600 } }, 'GitHub Token'),
    h('div', { style: { display: 'flex', gap: 8 } },
      h(Input, { id: 'dsh-github-token', type: 'password', autoComplete: 'off', value: token, placeholder: configured ? '已配置；输入新 Token 以替换' : 'github_pat_… 或 ghp_…', onChange: event => setToken(event.target.value), style: { flex: 1 } }),
      h(Button, { variant: 'primary', disabled: saving, onClick: () => { void save() } }, saving ? '保存中' : '保存 Token'),
    ),
    h('p', { role: notice ? 'status' : undefined, style: { minHeight: 20, marginTop: 10, color: notice.includes('失败') || notice.includes('unavailable') ? '#c33' : 'var(--dsw-alias-text-secondary, #666)' } }, notice || (configured ? `已配置 (${tokenRef})` : '尚未配置。')),
    h('p', { style: { marginTop: 24, color: 'var(--dsw-alias-text-secondary, #666)' } }, '在聊天输入框左侧使用“GitHub 仓库”选择当前会话的云端仓库。选定后，AI 只通过 GitHub API 读写仓库。'),
  )
}

function RepositoryPicker({ remote, sessionId, locked }) {
  const [open, setOpen] = useState(false)
  const [repos, setRepos] = useState([])
  const [selected, setSelected] = useState('GitHub 仓库')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true); setError('')
    const current = await remote.githubCloud.selected(sessionId)
    if (current.ok && current.value) setSelected(current.value.fullName)
    const response = await remote.githubCloud.repositories()
    if (!response.ok) setError(messageOf(response))
    else setRepos(response.value)
    setBusy(false)
  }
  useEffect(() => { void load() }, [sessionId])
  const choose = async (fullName) => {
    setOpen(false); setBusy(true); setError('')
    const response = await remote.githubCloud.select(sessionId, fullName)
    if (!response.ok) setError(messageOf(response))
    else setSelected(response.value.fullName)
    setBusy(false)
  }
  const items = repos.map(repo => ({ id: repo.fullName, label: `${repo.fullName}${repo.private ? ' · 私有' : ''}`, detail: repo.defaultBranch }))
  return h('span', { style: { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start' } },
    h(Menu, { open, items, selectedId: repos.some(repo => repo.fullName === selected) ? selected : undefined, onSelect: id => { void choose(id) }, onClose: () => setOpen(false), side: 'top', portal: true,
      anchor: h(Button, { variant: 'toolbar', size: 'sm', disabled: locked || busy, title: error || '选择 GitHub 云端仓库', onClick: () => setOpen(value => !value) }, busy ? '读取仓库…' : selected),
    }),
    error ? h('span', { role: 'alert', style: { maxWidth: 220, color: '#c33', fontSize: 12, marginTop: 3 } }, error) : null,
  )
}

export const inject = ['slots', 'remote', 'remote.credentials', 'remote.githubCloud']

export function apply(ctx) {
  ctx.effect(async () => await ctx.remote.$mount(contribution), 'github-cloud: mount browser remote')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'github-cloud', order: 30, label: () => 'GitHub',
    inject: () => ({ remote: ctx.remote }),
  }, GitHubSettings))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'github-cloud', order: 30,
    inject: sessionId => ({ remote: ctx.remote, sessionId }),
  }, RepositoryPicker))
}
