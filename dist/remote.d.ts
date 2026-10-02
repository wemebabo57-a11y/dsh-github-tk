/** Browser-facing catalog and selection API. It transfers repository metadata only. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { GitHubClient, Repository } from './github.js';
import type { CloudProject } from './github.js';
import type { ProjectStore } from './projects.js';
export interface GitHubCloudRemoteOptions {
    tokenRef: string;
    client: () => Promise<GitHubClient>;
    projects: ProjectStore;
    lock: (agent: Agent) => void;
}
/**
 * A small Remote service used by the Settings page and composer picker.
 * It deliberately exposes neither a token nor file contents.
 */
export declare class GitHubCloudController extends TypertRemoteService {
    private readonly options;
    constructor(ctx: Context, options: GitHubCloudRemoteOptions);
    status(): Promise<{
        tokenRef: string;
        configured: boolean;
    }>;
    repositories(): Promise<Array<Pick<Repository, 'fullName' | 'defaultBranch' | 'private'>>>;
    selected(sessionId: string): Promise<CloudProject | undefined>;
    select(sessionId: string, repository: string, branch?: string): Promise<CloudProject>;
}
