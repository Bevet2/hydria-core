import { ExternalKnowledgeExpansionWatcher } from "./externalKnowledgeExpansionWatcher.js";
import { InternalGapWatcher } from "./internalGapWatcher.js";
import { WatcherStore } from "./watcherStore.js";
import type { WatcherRun } from "../../types/watchers.js";

type WatcherScope = "internal" | "external" | "all";

type WatcherKernelOptions = {
  store?: Pick<WatcherStore, "appendRun" | "load">;
  internalWatcher?: Pick<InternalGapWatcher, "run">;
  externalWatcher?: Pick<ExternalKnowledgeExpansionWatcher, "run">;
};

type RunArgs = {
  scope?: WatcherScope;
  limit?: number;
  rebuildInteractionDigest?: boolean;
};

export class WatcherKernel {
  private readonly store: Pick<WatcherStore, "appendRun" | "load">;
  private readonly internalWatcher: Pick<InternalGapWatcher, "run">;
  private readonly externalWatcher: Pick<ExternalKnowledgeExpansionWatcher, "run">;

  constructor(options: WatcherKernelOptions = {}) {
    this.store = options.store ?? new WatcherStore();
    this.internalWatcher = options.internalWatcher ?? new InternalGapWatcher();
    this.externalWatcher = options.externalWatcher ?? new ExternalKnowledgeExpansionWatcher();
  }

  async run(args: RunArgs = {}) {
    const scope = args.scope ?? "all";
    const runs: WatcherRun[] = [];

    if (scope === "internal" || scope === "all") {
      runs.push(
        await this.internalWatcher.run({
          limit: args.limit,
          rebuildInteractionDigest: args.rebuildInteractionDigest
        })
      );
    }

    if (scope === "external" || scope === "all") {
      runs.push(await this.externalWatcher.run());
    }

    let state = await this.store.load();
    for (const run of runs) {
      state = await this.store.appendRun(run);
    }

    return {
      scope,
      runs,
      state
    };
  }
}

export type { WatcherScope };
