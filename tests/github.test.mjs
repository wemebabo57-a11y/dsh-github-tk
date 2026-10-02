import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitHubClient, parseRepository, validatePath } from '../dist/github.js'
import { ProjectStore } from '../dist/projects.js'
import { apply } from '../dist/index.js'

const project = {
  owner: 'alice', name: 'demo', fullName: 'alice/demo',
  defaultBranch: 'main', branch: 'main', private: true,
}

function fakeFetch(responses, calls) {
  return async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift()
    assert.ok(next, `unexpected request ${url}`)
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }
}

test('validates repository and file path before sending requests', () => {
  assert.deepEqual(parseRepository('alice/demo'), { owner: 'alice', name: 'demo' })
  assert.throws(() => parseRepository('../demo'))
  assert.equal(validatePath('src/main file.ts'), 'src/main%20file.ts')
  for (const path of ['/a', '../a', 'a/../b', 'a//b', 'a\\b']) assert.throws(() => validatePath(path))
})

test('uses bearer token, reads content and commits with the observed SHA through REST', async () => {
  const calls = []
  const client = new GitHubClient('ghp_classic_or_fine_grained', fakeFetch([
    { body: { type: 'file', encoding: 'base64', content: Buffer.from('old').toString('base64'), sha: 'file-sha' } },
    { body: { commit: { sha: 'commit-sha' } } },
  ], calls))
  assert.deepEqual(await client.readFile(project, 'src/a.ts'), { content: 'old', sha: 'file-sha' })
  assert.equal(await client.writeFile(project, 'src/a.ts', 'new', 'Update a', 'file-sha'), 'commit-sha')
  assert.equal(calls[0].url, 'https://api.github.com/repos/alice/demo/contents/src/a.ts?ref=main')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ghp_classic_or_fine_grained')
  assert.equal(calls[1].init.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    message: 'Update a', content: Buffer.from('new').toString('base64'), branch: 'main', sha: 'file-sha',
  })
})

test('creates a remote repository and rejects stale writes from GitHub', async () => {
  const calls = []
  const client = new GitHubClient('github_pat_example', fakeFetch([
    { body: { owner: { login: 'alice' }, name: 'new', full_name: 'alice/new', default_branch: 'main', private: true } },
    { status: 409, body: { message: 'Conflict' } },
  ], calls))
  const repo = await client.createRepository('new', true)
  assert.equal(repo.fullName, 'alice/new')
  assert.equal(calls[0].url, 'https://api.github.com/user/repos')
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'new', private: true, auto_init: true })
  await assert.rejects(client.writeFile(project, 'x', 'x', 'change', 'stale'), /GitHub API 409/)
})

test('stores only session-to-repository metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-github-cloud-'))
  const file = join(directory, 'projects.json')
  const store = new ProjectStore(file)
  await store.set('session-1', project)
  assert.deepEqual(await new ProjectStore(file).get('session-1'), project)
  const saved = await readFile(file, 'utf8')
  assert.ok(saved.includes('alice/demo'))
  assert.ok(!saved.includes('ghp_'))
})

test('registers redacted token and cloud-project selection commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-github-cloud-plugin-'))
  const commands = new Map()
  const tools = new Map()
  const listeners = new Map()
  let secret
  const ctx = {
    credentials: {
      resolve: async () => secret && { value: secret, source: 'test' },
      set: async (_ref, value) => { secret = value },
    },
    commands: { register: command => { commands.set(command.name, command); return () => {} } },
    tools: { register: tool => { tools.set(tool.name, tool); return () => {} } },
    systemPrompt: { section: () => () => {} },
    inject: (_names, callback) => callback(ctx),
    on: (event, listener) => { listeners.set(event, listener); return () => {} },
  }
  apply(ctx, { statePath: join(directory, 'projects.json') })
  assert.equal(commands.get('github-token').recordInput, false)
  assert.ok(tools.has('github_read_file'))
  assert.ok(tools.has('github_write_file'))
  const originalFetch = globalThis.fetch
  try {
    const calls = []
    globalThis.fetch = fakeFetch([
      { body: { login: 'alice' } },
      { body: { owner: { login: 'alice' }, name: 'demo', full_name: 'alice/demo', default_branch: 'main', private: true } },
    ], calls)
    const restrictions = []
    const guards = []
    const agent = {
      session: { id: 'session-1' },
      ctx: { tools: {
        restrict: restriction => { restrictions.push(restriction); return () => {} },
        guard: guard => { guards.push(guard); return () => {} },
      } },
    }
    const invocation = { agent, signal: new AbortController().signal }
    const connected = await commands.get('github-token').handler({ ...invocation, rawInput: 'github_pat_test' })
    assert.equal(connected.kind, 'success')
    assert.ok(!connected.text.includes('github_pat_test'))
    const selected = await commands.get('github').handler({ ...invocation, rawInput: 'alice/demo' })
    assert.equal(selected.kind, 'success')
    assert.deepEqual(await new ProjectStore(join(directory, 'projects.json')).get('session-1'), project)
    assert.equal(calls[0].init.headers.Authorization, 'Bearer github_pat_test')
    assert.deepEqual(restrictions, [{ allow: [
      'github_project', 'github_list_repositories', 'github_select_repository', 'github_create_repository',
      'github_list_files', 'github_read_file', 'github_write_file', 'github_delete_file', 'run_code',
    ] }])
    assert.equal(guards[0]({ name: 'write' }), 'This is a GitHub cloud project. Local filesystem, shell, and non-GitHub tools are disabled for this session.')
    assert.equal(guards[0]({ name: 'github_write_file' }), undefined)

    const resumedRestrictions = []
    const resumedGuards = []
    const resumedAgent = {
      session: { id: 'session-1' },
      ctx: { tools: {
        restrict: restriction => { resumedRestrictions.push(restriction); return () => {} },
        guard: guard => { resumedGuards.push(guard); return () => {} },
      } },
    }
    const decision = await listeners.get('agent/pre-step')({ agent: resumedAgent }, async () => 'continue')
    assert.equal(decision, 'continue')
    assert.equal(resumedRestrictions.length, 1)
    assert.equal(resumedGuards[0]({ name: 'bash' }), 'This is a GitHub cloud project. Local filesystem, shell, and non-GitHub tools are disabled for this session.')
  } finally {
    globalThis.fetch = originalFetch
  }
})
