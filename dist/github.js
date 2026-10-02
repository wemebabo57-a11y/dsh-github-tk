/** Direct GitHub REST operations. No repository content is written to disk. */
export class GitHubError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'GitHubError';
    }
}
const REPO_PART = /^[A-Za-z0-9_.-]+$/;
export function parseRepository(input) {
    const parts = input.trim().split('/');
    if (parts.length !== 2 || parts.some(part => !REPO_PART.test(part) || part === '.' || part === '..')) {
        throw new Error('Repository must be owner/name.');
    }
    return { owner: parts[0], name: parts[1] };
}
export function validatePath(input) {
    if (!input || input.startsWith('/') || input.includes('\\') || input.includes('\0')) {
        throw new Error('File path must be relative to the repository.');
    }
    const parts = input.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error('File path contains an empty or traversal segment.');
    }
    return parts.map(encodeURIComponent).join('/');
}
function record(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('Invalid GitHub response.');
    return value;
}
function string(value, field) {
    if (typeof value !== 'string')
        throw new Error(`Invalid GitHub ${field}.`);
    return value;
}
function repository(value) {
    const data = record(value);
    const owner = record(data.owner);
    return {
        owner: string(owner.login, 'owner'),
        name: string(data.name, 'name'),
        fullName: string(data.full_name, 'full_name'),
        defaultBranch: string(data.default_branch, 'default_branch'),
        private: data.private === true,
    };
}
export class GitHubClient {
    token;
    fetcher;
    constructor(token, fetcher = fetch) {
        this.token = token;
        this.fetcher = fetcher;
        if (!token.trim())
            throw new Error('GitHub token is required.');
    }
    async request(path, init = {}) {
        const response = await this.fetcher(`https://api.github.com${path}`, {
            ...init,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${this.token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'dsh-github-cloud',
                ...init.body === undefined ? {} : { 'Content-Type': 'application/json' },
            },
        });
        if (response.status === 204)
            return null;
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
                ? body.message : response.statusText;
            throw new GitHubError(response.status, `GitHub API ${response.status}: ${message}`);
        }
        return body;
    }
    async verify(signal) {
        const data = record(await this.request('/user', { signal }));
        return string(data.login, 'login');
    }
    async listRepositories(signal) {
        const result = [];
        for (let page = 1; page <= 10; page++) {
            const data = await this.request(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, { signal });
            if (!Array.isArray(data))
                throw new Error('Invalid GitHub repository list.');
            result.push(...data.map(repository));
            if (data.length < 100)
                break;
        }
        return result;
    }
    async getRepository(owner, name, signal) {
        return repository(await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { signal }));
    }
    async createRepository(name, isPrivate, signal) {
        if (!REPO_PART.test(name) || name === '.' || name === '..')
            throw new Error('Invalid repository name.');
        return repository(await this.request('/user/repos', {
            method: 'POST', body: JSON.stringify({ name, private: isPrivate, auto_init: true }), signal,
        }));
    }
    contentsPath(project, path) {
        return `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}/contents/${validatePath(path)}`;
    }
    async readFile(project, path, signal) {
        const data = record(await this.request(`${this.contentsPath(project, path)}?ref=${encodeURIComponent(project.branch)}`, { signal }));
        if (data.type !== 'file' || data.encoding !== 'base64')
            throw new Error('GitHub path is not a regular file.');
        const raw = Buffer.from(string(data.content, 'content').replace(/\s/g, ''), 'base64');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        return { content, sha: string(data.sha, 'sha') };
    }
    async listFiles(project, prefix = '', signal) {
        const data = record(await this.request(`/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}/git/trees/${encodeURIComponent(project.branch)}?recursive=1`, { signal }));
        if (data.truncated === true)
            throw new Error('GitHub truncated the repository tree; narrow the repository or use another branch.');
        if (!Array.isArray(data.tree))
            throw new Error('Invalid GitHub tree.');
        const normalized = prefix ? `${decodeURIComponent(validatePath(prefix)).replace(/\/$/, '')}/` : '';
        return data.tree.map(item => {
            const node = record(item);
            return { path: string(node.path, 'path'), type: string(node.type, 'type'), sha: string(node.sha, 'sha') };
        }).filter(item => item.path.startsWith(normalized));
    }
    async writeFile(project, path, content, message, sha, signal) {
        if (!message.trim())
            throw new Error('Commit message is required.');
        const data = record(await this.request(this.contentsPath(project, path), {
            method: 'PUT',
            body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), branch: project.branch, ...sha ? { sha } : {} }),
            signal,
        }));
        return string(record(data.commit).sha, 'commit sha');
    }
    async deleteFile(project, path, message, sha, signal) {
        if (!message.trim() || !sha.trim())
            throw new Error('Commit message and file SHA are required.');
        const data = record(await this.request(this.contentsPath(project, path), {
            method: 'DELETE', body: JSON.stringify({ message, sha, branch: project.branch }), signal,
        }));
        return string(record(data.commit).sha, 'commit sha');
    }
}
