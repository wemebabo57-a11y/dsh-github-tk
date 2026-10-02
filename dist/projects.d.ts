import type { CloudProject } from './github.js';
export declare class ProjectStore {
    private readonly path;
    private queue;
    constructor(path: string);
    get(sessionId: string): Promise<CloudProject | undefined>;
    set(sessionId: string, project: CloudProject): Promise<void>;
    private read;
}
