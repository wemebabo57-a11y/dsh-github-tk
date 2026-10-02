import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "github-cloud";
export declare const inject: string[];
export interface Config {
    /** Durable session-to-repository metadata; DSH may separately persist tool content in session logs. */
    statePath?: string;
    /** Credential reference set by /github-token or DSH's credential settings. */
    tokenRef?: string;
    /** Restrict selected cloud-project sessions to GitHub tools, preventing local file and shell tools. */
    restrictLocalTools?: boolean;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
