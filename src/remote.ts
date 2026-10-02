/** Browser-facing catalog and selection API. It transfers repository metadata only. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GitHubClient, Repository } from './github.js'
import type { CloudProject } from './github.js'
import type { ProjectStore } from './projects.js'

export interface GitHubCloudRemoteOptions {
  tokenRef: string
  client: () => Promise<GitHubClient>
  projects: ProjectStore
  lock: (agent: Agent) => void
}

/**
 * A small Remote service used by the Settings page and composer picker.
 * It deliberately exposes neither a token nor file contents.
 */
export class GitHubCloudController extends TypertRemoteService {
  constructor(ctx: Context, private readonly options: GitHubCloudRemoteOptions) {
    super(ctx, 'githubCloudController', { namespace: 'githubCloud' })
  }

  @Remote
  async status(): Promise<{ tokenRef: string, configured: boolean }> {
    return {
      tokenRef: this.options.tokenRef,
      configured: (await this.ctx.credentials.describe(this.options.tokenRef as never)).configured,
    }
  }

  @Remote
  async repositories(): Promise<Array<Pick<Repository, 'fullName' | 'defaultBranch' | 'private'>>> {
    return (await (await this.options.client()).listRepositories()).map(repository => ({
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      private: repository.private,
    }))
  }

  @Remote
  async selected(sessionId: string): Promise<CloudProject | undefined> {
    return this.options.projects.get(sessionId)
  }

  @Remote
  async select(sessionId: string, repository: string, branch?: string): Promise<CloudProject> {
    const agent = this.ctx.agents.get(sessionId as never)
    if (agent === undefined) throw new Error('This chat session is no longer active.')
    const [owner, name, ...extra] = repository.split('/')
    if (!owner || !name || extra.length > 0) throw new Error('Repository must use owner/name format.')
    const repo = await (await this.options.client()).getRepository(owner, name)
    const targetBranch = branch ?? repo.defaultBranch
    if (!targetBranch.trim() || targetBranch.includes('\0')) throw new Error('Invalid branch name.')
    const project = { ...repo, branch: targetBranch }
    await this.options.projects.set(sessionId, project)
    this.options.lock(agent)
    return project
  }
}
