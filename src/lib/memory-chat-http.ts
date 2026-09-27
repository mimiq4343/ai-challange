import { ALL_MEMORY_LAYERS_ENABLED, type MemoryLayerToggles } from "./memory-types";
import type { PersonalizedChatResponse } from "./personalized-chat-agent";

export function parseMemoryLayers(value: unknown): MemoryLayerToggles | null {
  if (value === undefined) return ALL_MEMORY_LAYERS_ENABLED;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const toggles = ["shortTerm", "working", "longTerm", "profile", "task", "invariants"] as const;
  if (toggles.some((name) => typeof candidate[name] !== "boolean")) return null;
  return {
    shortTerm: candidate.shortTerm as boolean,
    working: candidate.working as boolean,
    longTerm: candidate.longTerm as boolean,
    profile: candidate.profile as boolean,
    task: candidate.task as boolean,
    invariants: candidate.invariants as boolean,
  };
}

export function memoryResponseHeaders(response: PersonalizedChatResponse): Record<string, string> {
  const { layerTokens } = response;
  return {
    "X-Token-System": String(layerTokens.systemTokens),
    "X-Token-History": String(layerTokens.shortTermTokens),
    "X-Token-Request": String(layerTokens.requestTokens),
    "X-Token-Prompt": String(layerTokens.promptTokens),
    "X-Token-Reserved-Output": String(layerTokens.reservedOutputTokens),
    "X-Token-Context": String(layerTokens.contextTokens),
    "X-Token-Limit": String(layerTokens.contextLimit),
    "X-Memory-Ltm": String(layerTokens.longTermTokens),
    "X-Memory-Wm": String(layerTokens.workingTokens),
    "X-Memory-Stm": String(layerTokens.shortTermTokens),
    "X-Memory-Prof": String(layerTokens.profileTokens),
    "X-Memory-Task": String(layerTokens.taskTokens),
    "X-Memory-Inv": String(layerTokens.invariantTokens),
    "X-Invariant-Block": response.blockedBy.join(","),
    "X-Memory-Stm-Messages": String(response.shortTermMessages),
    "X-Memory-Profile": String(response.profile.id),
  };
}
