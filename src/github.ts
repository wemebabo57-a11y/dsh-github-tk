/** Direct GitHub REST operations. No repository content is written to disk. */

export interface Repository {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  private: boolean
}

export interface CloudProject extends Repository {
  branch: string
}

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}

const REPO_PART = /^[A-Za-z0-9_.-]+$/

export function parseRepository(input: string): { owner: string; name: string } {
  const parts = input.trim().split('/')
  if (parts.length !== 2 || parts.some(part => !REPO_PART.test(part) || part === '.' || part === '..')) {
    throw new Error('Repository must be owner/name.')
  }
  return { owner: parts[0]!, name: parts[1]! }
}

export function validatePath(input: string): string {
  if (!input || input.startsWith('/') || input.includes('\\') || input.includes('\0')) {
    throw new Error('File path must be relative to the repository.')
  }
  const parts = input.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('File path contains an empty or traversal segment.')
  }
  return parts.map(encodeURIComponent).join('/')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid GitHub response.')
  return value as Record<string, unknown>
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid GitHub ${field}.`)
  return value
}

function repository(value: unknown): Repository {
  const data = record(value)
  const owner = record(data.owner)
  return {
    owner: string(owner.login, 'owner'),
    name: string(data.name, 'name'),
    fullName: string(data.full_name, 'full_name'),
    defaultBranch: string(data.default_branch, 'default_branch'),
    private: data.private === true,
  }
}

export class GitHubClient {
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    if (!token.trim()) throw new Error('GitHub token is required.')
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'dsh-github-cloud',
        ...init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      },
    })
    if (response.status === 204) return null
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message : response.statusText
      throw new GitHubError(response.status, `GitHub API ${response.status}: ${message}`)
    }
    return body
  }

  async verify(signal?: AbortSignal): Promise<string> {
    const data = record(await this.request('/user', { signal }))
    return string(data.login, 'login')
  }

  async listRepositories(signal?: AbortSignal): Promise<Repository[]> {
    const result: Repository[] = []
    for (let page = 1; page <= 10; page++) {
      const data = await this.request(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, { signal })
      if (!Array.isArray(data)) throw new Error('Invalid GitHub repository list.')
      result.push(...data.map(repository))
      if (data.length < 100) break
    }
    return result
  }

  async getRepository(owner: string, name: string, signal?: AbortSignal): Promise<Repository> {
    return repository(await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { signal }))
  }

  async createRepository(name: string, isPrivate: boolean, signal?: AbortSignal): Promise<Repository> {
    if (!REPO_PART.test(name) || name === '.' || name === '..') throw new Error('Invalid repository name.')
    return repository(await this.request('/user/repos', {
      method: 'POST', body: JSON.stringify({ name, private: isPrivate, auto_init: true }), signal,
    }))
  }

  private contentsPath(project: CloudProject, path: string): string {
    return `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}/contents/${validatePath(path)}`
  }

  async readFile(project: CloudProject, path: string, signal?: AbortSignal): Promise<{ content: string; sha: string }> {
    const data = record(await this.request(`${this.contentsPath(project, path)}?ref=${encodeURIComponent(project.branch)}`, { signal }))
    if (data.type !== 'file' || data.encoding !== 'base64') throw new Error('GitHub path is not a regular file.')
    const raw = Buffer.from(string(data.content, 'content').replace(/\s/g, ''), 'base64')
    const content = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    return { content, sha: string(data.sha, 'sha') }
  }

  async listFiles(project: CloudProject, prefix = '', signal?: AbortSignal): Promise<{ path: string; type: string; sha: string }[]> {
    const data = record(await this.request(`/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}/git/trees/${encodeURIComponent(project.branch)}?recursive=1`, { signal }))
    if (data.truncated === true) throw new Error('GitHub truncated the repository tree; narrow the repository or use another branch.')
    if (!Array.isArray(data.tree)) throw new Error('Invalid GitHub tree.')
    const normalized = prefix ? `${decodeURIComponent(validatePath(prefix)).replace(/\/$/, '')}/` : ''
    return data.tree.map(item => {
      const node = record(item)
      return { path: string(node.path, 'path'), type: string(node.type, 'type'), sha: string(node.sha, 'sha') }
    }).filter(item => item.path.startsWith(normalized))
  }

  async writeFile(project: CloudProject, path: string, content: string, message: string, sha?: string, signal?: AbortSignal): Promise<string> {
    if (!message.trim()) throw new Error('Commit message is required.')
    const data = record(await this.request(this.contentsPath(project, path), {
      method: 'PUT',
      body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), branch: project.branch, ...sha ? { sha } : {} }),
      signal,
    }))
    return string(record(data.commit).sha, 'commit sha')
  }

  async deleteFile(project: CloudProject, path: string, message: string, sha: string, signal?: AbortSignal): Promise<string> {
    if (!message.trim() || !sha.trim()) throw new Error('Commit message and file SHA are required.')
    const data = record(await this.request(this.contentsPath(project, path), {
      method: 'DELETE', body: JSON.stringify({ message, sha, branch: project.branch }), signal,
    }))
    return string(record(data.commit).sha, 'commit sha')
  }
}
