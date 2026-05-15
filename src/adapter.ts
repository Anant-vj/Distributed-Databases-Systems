import { LocalFirstEngine, type EngineOptions } from "./engine.js";

export function createEngine(options: EngineOptions = {}): LocalFirstEngine {
  return new LocalFirstEngine(options);
}

export { LocalFirstEngine };
export type { EngineOptions, ExecuteResult, MutationResult, SelectResult } from "./engine.js";
