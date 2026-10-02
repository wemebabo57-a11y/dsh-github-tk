/** DeepSeek Harness plugin: authenticated direct GitHub projects and file tools. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { GitHubClient, parseRepository } from './github.js'
import type { CloudProject } from './github.js'
import { ProjectStore } from './projects.js'

export const name = 'github-cloud'
export const inject = ['tools', 'credentials']

export interface Config {
  /** Durable session-to-repository metadata; DSH may separately persist tool content in session logs. */
  statePath?: string
  /** Credential reference set by /github-token or DSH's credential settings. */
  tokenRef?: string
  /** Restrict selected cloud-project sessions to GitHub tools, preventing local file and shell tools. */
  restrictLocalTools?: boolean
}

export const Config: z<Config> = z.object({
  statePath: z.string(),
  tokenRef: z.string().default('GITHUB_TOKEN'),
  restrictLocalTools: z.boolean().default(true),
})

const CLOUD_TOOL_NAMES = [
  'github_project', 'github_list_repositories', 'github_select_repository',
  'github_create_repository', 'github_list_files', 'github_read_file',
  'github_write_file', 'github_delete_file',
] as const

const CLOUD_VISIBLE_TOOLS = [...CLOUD_TOOL_NAMES, 'run_code']

const jsonOutput = {
  schema: { type: 'json' } as const,
  render: (_args: object, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

export function apply(ctx: Context, config: Config): void {
  const tokenRef = credentialRef(config.tokenRef ?? 'GITHUB_TOKEN')
  const statePath = config.statePath || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'github-cloud-projects.json')
  const projects = new ProjectStore(statePath)
  const lockedAgents = new WeakSet<Agent>()

  /** Hide and deny every non-GitHub tool in a cloud session, including local filesystem and shell tools. */
  function lockCloudAgent(agent: Agent): void {
    if (config.restrictLocalTools === false || lockedAgents.has(agent)) return
    lockedAgents.add(agent)
    agent.ctx.tools.restrict({ allow: CLOUD_VISIBLE_TOOLS })
    agent.ctx.tools.guard(execution => CLOUD_VISIBLE_TOOLS.includes(execution.name as typeof CLOUD_VISIBLE_TOOLS[number])
      ? undefined
      : 'This is a GitHub cloud project. Local filesystem, shell, and non-GitHub tools are disabled for this session.')
  }

  async function client(): Promise<GitHubClient> {
    const secret = await ctx.credentials.resolve(tokenRef)
    if (!secret) throw new Error(`GitHub token is missing. Run /github-token <token> or configure ${tokenRef}.`)
    return new GitHubClient(secret.value)
  }

  async function current(sessionId: string): Promise<CloudProject> {
    const project = await projects.get(sessionId)
    if (!project) throw new Error('No cloud repository selected for this session. Run /github owner/repo in a new session.')
    return project
  }

  function sessionId(agent: { session: { id: string } } | undefined): string {
    if (!agent) throw new Error('GitHub cloud tools require an active session.')
    return agent.session.id
  }

  function projectValue(project: CloudProject) {
    return { owner: project.owner, name: project.name, fullName: project.fullName,
      defaultBranch: project.defaultBranch, private: project.private, branch: project.branch }
  }

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'github-token',
      description: 'Save a GitHub classic or fine-grained personal access token',
      input: { hint: '<token>' },
      recordInput: false,
      async handler({ rawInput, signal }) {
        const token = rawInput.trim()
        if (!token) return { kind: 'error', text: 'Enter a GitHub personal access token.' }
        try {
          const login = await new GitHubClient(token).verify(signal)
          await ctx.credentials.set(tokenRef, token)
          return { kind: 'success', text: `GitHub account connected: ${login}. Token value was not logged.` }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : 'GitHub token validation failed.' }
        }
      },
    })

    commandCtx.commands.register({
      name: 'github',
      description: 'List, select, or create a GitHub cloud project without a local workspace',
      input: { hint: 'list | owner/repo [branch] | create name [private|public]' },
      async handler({ agent, rawInput, signal }) {
        try {
          const input = rawInput.trim()
          const github = await client()
          if (input === '' || input === 'list') {
            const repos = await github.listRepositories(signal)
            return { kind: 'success', text: repos.slice(0, 50).map(repo => `${repo.fullName} (${repo.defaultBranch})`).join('\n') || 'No accessible repositories.' }
          }
          const pieces = input.split(/\s+/)
          let repo
          let branch: string
          if (pieces[0] === 'create') {
            if (pieces.length < 2 || pieces.length > 3 || (pieces[2] !== undefined && !['private', 'public'].includes(pieces[2]))) {
              return { kind: 'error', text: 'Usage: /github create name [private|public]' }
            }
            repo = await github.createRepository(pieces[1]!, pieces[2] !== 'public', signal)
            branch = repo.defaultBranch
          } else {
            if (pieces.length > 2) return { kind: 'error', text: 'Usage: /github owner/repo [branch]' }
            const parsed = parseRepository(pieces[0]!)
            repo = await github.getRepository(parsed.owner, parsed.name, signal)
            branch = pieces[1] ?? repo.defaultBranch
          }
          if (!branch || branch.includes('\0')) throw new Error('Invalid branch name.')
          const project: CloudProject = { ...repo, branch }
          await projects.set(agent.session.id, project)
          lockCloudAgent(agent)
          return { kind: 'success', text: `Cloud project selected: ${repo.fullName} (${branch}). Local file and shell tools are disabled; AI now operates through GitHub API.` }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : 'GitHub operation failed.' }
        }
      },
    })
  })

  // A resumed session receives a new Agent context. Resolve the durable mapping
  // before its first model step so the local-tool restriction is restored.
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (await projects.get(agent.session.id) !== undefined) lockCloudAgent(agent)
    return next()
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'github-cloud:direct-api', order: 1510,
      text: 'For a selected GitHub cloud project, use github_* tools to inspect and change repository files directly through GitHub API. Do not clone the repository or use local file and shell tools to edit its contents.',
    })
  })

  ctx.tools.register(defineTool({
    name: 'github_project',
    description: 'Show the GitHub cloud repository selected for this session. Repository files are accessed directly through GitHub API.',
    parameters: {}, output: jsonOutput,
    async execute(_args, exec) { return projectValue(await current(sessionId(exec.agent))) },
  }))

  ctx.tools.register(defineTool({
    name: 'github_list_repositories',
    description: 'List repositories accessible to the configured GitHub token for choosing a cloud project.',
    parameters: {}, output: jsonOutput,
    async execute(_args, exec) { return (await (await client()).listRepositories(exec.signal)).map(repo => ({
      owner: repo.owner, name: repo.name, fullName: repo.fullName,
      defaultBranch: repo.defaultBranch, private: repo.private,
    })) },
  }))

  ctx.tools.register(defineTool({
    name: 'github_select_repository',
    description: 'Select an existing GitHub repository as this session\'s cloud project, without choosing a local workspace path.',
    parameters: {
      repository: { type: 'string', required: true, description: 'Repository owner/name.' },
      branch: { type: 'string', description: 'Branch name. Defaults to the repository default branch.' },
    }, output: jsonOutput,
    async execute(args, exec) {
      const parsed = parseRepository(args.repository)
      const repo = await (await client()).getRepository(parsed.owner, parsed.name, exec.signal)
      const branch = args.branch ?? repo.defaultBranch
      if (!branch.trim() || branch.includes('\0')) throw new Error('Invalid branch name.')
      const project = { ...repo, branch }
      await projects.set(sessionId(exec.agent), project)
      lockCloudAgent(exec.agent!)
      return projectValue(project)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'github_create_repository',
    description: 'Create a new GitHub repository for the authenticated user and select it as this session\'s cloud project.',
    parameters: {
      name: { type: 'string', required: true, description: 'New repository name.' },
      private: { type: 'boolean', required: true, description: 'Whether the new repository is private.' },
    }, output: jsonOutput,
    async execute(args, exec) {
      const repo = await (await client()).createRepository(args.name, args.private, exec.signal)
      const project = { ...repo, branch: repo.defaultBranch }
      await projects.set(sessionId(exec.agent), project)
      lockCloudAgent(exec.agent!)
      return projectValue(project)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'github_list_files',
    description: 'List files in the selected cloud repository by GitHub API. No local clone is made.',
    parameters: { prefix: { type: 'string', description: 'Optional repository-relative directory prefix.' } }, output: jsonOutput,
    async execute(args, exec) {
      const project = await current(sessionId(exec.agent))
      return (await client()).listFiles(project, args.prefix, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'github_read_file',
    description: 'Read a UTF-8 file directly from the selected GitHub repository. Returns content and SHA for guarded writes.',
    parameters: { path: { type: 'string', required: true, description: 'Repository-relative file path.' } }, output: jsonOutput,
    async execute(args, exec) {
      const project = await current(sessionId(exec.agent))
      return (await client()).readFile(project, args.path, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'github_write_file',
    description: 'Commit a UTF-8 file directly through GitHub API. For existing files, supply SHA returned by github_read_file; omit SHA only to create a new file.',
    parameters: {
      path: { type: 'string', required: true, description: 'Repository-relative file path.' },
      content: { type: 'string', required: true, description: 'Full new file contents.' },
      message: { type: 'string', required: true, description: 'Commit message.' },
      sha: { type: 'string', description: 'Current file SHA when replacing an existing file.' },
    }, output: jsonOutput,
    async execute(args, exec) {
      const project = await current(sessionId(exec.agent))
      const commit = await (await client()).writeFile(project, args.path, args.content, args.message, args.sha, exec.signal)
      return { repository: project.fullName, branch: project.branch, path: args.path, commit }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'github_delete_file',
    description: 'Delete a file directly through GitHub API using the current file SHA.',
    parameters: {
      path: { type: 'string', required: true, description: 'Repository-relative file path.' },
      message: { type: 'string', required: true, description: 'Commit message.' },
      sha: { type: 'string', required: true, description: 'Current file SHA from github_read_file.' },
    }, output: jsonOutput,
    async execute(args, exec) {
      const project = await current(sessionId(exec.agent))
      const commit = await (await client()).deleteFile(project, args.path, args.message, args.sha, exec.signal)
      return { repository: project.fullName, branch: project.branch, path: args.path, commit }
    },
  }))
}
