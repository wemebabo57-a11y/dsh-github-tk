var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/**
 * A small Remote service used by the Settings page and composer picker.
 * It deliberately exposes neither a token nor file contents.
 */
let GitHubCloudController = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _repositories_decorators;
    let _selected_decorators;
    let _select_decorators;
    return class GitHubCloudController extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote];
            _repositories_decorators = [Remote];
            _selected_decorators = [Remote];
            _select_decorators = [Remote];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _repositories_decorators, { kind: "method", name: "repositories", static: false, private: false, access: { has: obj => "repositories" in obj, get: obj => obj.repositories }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _selected_decorators, { kind: "method", name: "selected", static: false, private: false, access: { has: obj => "selected" in obj, get: obj => obj.selected }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _select_decorators, { kind: "method", name: "select", static: false, private: false, access: { has: obj => "select" in obj, get: obj => obj.select }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        options = __runInitializers(this, _instanceExtraInitializers);
        constructor(ctx, options) {
            super(ctx, 'githubCloudController', { namespace: 'githubCloud' });
            this.options = options;
        }
        async status() {
            return {
                tokenRef: this.options.tokenRef,
                configured: (await this.ctx.credentials.describe(this.options.tokenRef)).configured,
            };
        }
        async repositories() {
            return (await (await this.options.client()).listRepositories()).map(repository => ({
                fullName: repository.fullName,
                defaultBranch: repository.defaultBranch,
                private: repository.private,
            }));
        }
        async selected(sessionId) {
            return this.options.projects.get(sessionId);
        }
        async select(sessionId, repository, branch) {
            const agent = this.ctx.agents.get(sessionId);
            if (agent === undefined)
                throw new Error('This chat session is no longer active.');
            const [owner, name, ...extra] = repository.split('/');
            if (!owner || !name || extra.length > 0)
                throw new Error('Repository must use owner/name format.');
            const repo = await (await this.options.client()).getRepository(owner, name);
            const targetBranch = branch ?? repo.defaultBranch;
            if (!targetBranch.trim() || targetBranch.includes('\0'))
                throw new Error('Invalid branch name.');
            const project = { ...repo, branch: targetBranch };
            await this.options.projects.set(sessionId, project);
            this.options.lock(agent);
            return project;
        }
    };
})();
export { GitHubCloudController };
