/** Small durable index from DSH session ids to GitHub repositories. Contains no checkout. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CloudProject } from './github.js'

function validProject(value: unknown): value is CloudProject {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return ['owner', 'name', 'fullName', 'defaultBranch', 'branch'].every(key => typeof item[key] === 'string')
    && typeof item.private === 'boolean'
}

export class ProjectStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async get(sessionId: string): Promise<CloudProject | undefined> {
    const projects = await this.read()
    return projects[sessionId]
  }

  async set(sessionId: string, project: CloudProject): Promise<void> {
    const operation = this.queue.then(async () => {
      const projects = await this.read()
      projects[sessionId] = project
      await mkdir(dirname(this.path), { recursive: true })
      const temp = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, this.path)
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  private async read(): Promise<Record<string, CloudProject>> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return {}
      throw error
    }
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid cloud project index.')
    const entries = Object.entries(value)
    if (!entries.every(([key, project]) => key.length > 0 && validProject(project))) throw new Error('Invalid cloud project entry.')
    return Object.fromEntries(entries) as Record<string, CloudProject>
  }
}
