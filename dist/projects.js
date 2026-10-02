/** Small durable index from DSH session ids to GitHub repositories. Contains no checkout. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
function validProject(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const item = value;
    return ['owner', 'name', 'fullName', 'defaultBranch', 'branch'].every(key => typeof item[key] === 'string')
        && typeof item.private === 'boolean';
}
export class ProjectStore {
    path;
    queue = Promise.resolve();
    constructor(path) {
        this.path = path;
    }
    async get(sessionId) {
        const projects = await this.read();
        return projects[sessionId];
    }
    async set(sessionId, project) {
        const operation = this.queue.then(async () => {
            const projects = await this.read();
            projects[sessionId] = project;
            await mkdir(dirname(this.path), { recursive: true });
            const temp = `${this.path}.${randomUUID()}.tmp`;
            await writeFile(temp, `${JSON.stringify(projects, null, 2)}\n`, { mode: 0o600 });
            await rename(temp, this.path);
        });
        this.queue = operation.catch(() => { });
        return operation;
    }
    async read() {
        let text;
        try {
            text = await readFile(this.path, 'utf8');
        }
        catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
                return {};
            throw error;
        }
        const value = JSON.parse(text);
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            throw new Error('Invalid cloud project index.');
        const entries = Object.entries(value);
        if (!entries.every(([key, project]) => key.length > 0 && validProject(project)))
            throw new Error('Invalid cloud project entry.');
        return Object.fromEntries(entries);
    }
}
