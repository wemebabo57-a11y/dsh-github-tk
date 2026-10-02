/** Direct GitHub REST operations. No repository content is written to disk. */
export interface Repository {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    private: boolean;
}
export interface CloudProject extends Repository {
    branch: string;
}
export declare class GitHubError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare function parseRepository(input: string): {
    owner: string;
    name: string;
};
export declare function validatePath(input: string): string;
export declare class GitHubClient {
    private readonly token;
    private readonly fetcher;
    constructor(token: string, fetcher?: typeof fetch);
    private request;
    verify(signal?: AbortSignal): Promise<string>;
    listRepositories(signal?: AbortSignal): Promise<Repository[]>;
    getRepository(owner: string, name: string, signal?: AbortSignal): Promise<Repository>;
    createRepository(name: string, isPrivate: boolean, signal?: AbortSignal): Promise<Repository>;
    private contentsPath;
    readFile(project: CloudProject, path: string, signal?: AbortSignal): Promise<{
        content: string;
        sha: string;
    }>;
    listFiles(project: CloudProject, prefix?: string, signal?: AbortSignal): Promise<{
        path: string;
        type: string;
        sha: string;
    }[]>;
    writeFile(project: CloudProject, path: string, content: string, message: string, sha?: string, signal?: AbortSignal): Promise<string>;
    deleteFile(project: CloudProject, path: string, message: string, sha: string, signal?: AbortSignal): Promise<string>;
}
