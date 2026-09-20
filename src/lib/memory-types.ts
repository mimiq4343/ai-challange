export type MemoryLayer = "short_term" | "working" | "long_term";

export type LongTermKind = "profile" | "decision" | "knowledge";

export type WorkingSlotKind = "fact" | "constraint" | "step" | "open_question";

export type MemoryOrigin = "router" | "user";

export type LongTermEntry = {
  id: number;
  kind: LongTermKind;
  key: string;
  value: string;
  origin: MemoryOrigin;
  reason: string | null;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LongTermInput = {
  kind: LongTermKind;
  key: string;
  value: string;
  origin: MemoryOrigin;
  reason: string | null;
  sourceConversationId: string | null;
};

export type WorkingSlot = {
  id: number;
  taskId: number;
  kind: WorkingSlotKind;
  value: string;
  origin: MemoryOrigin;
  reason: string | null;
  createdAt: string;
};

export type WorkingSlotInput = {
  kind: WorkingSlotKind;
  value: string;
  origin: MemoryOrigin;
  reason: string | null;
};

export type WorkingTaskStatus = "active" | "closed";

export type WorkingTask = {
  id: number;
  conversationId: string;
  title: string;
  goal: string | null;
  status: WorkingTaskStatus;
  createdAt: string;
  updatedAt: string;
};

export type WorkingTaskInput = {
  title: string;
  goal: string | null;
};

export type WorkingMemory = {
  task: WorkingTask;
  slots: WorkingSlot[];
};

export type MemoryWrite = {
  id: number;
  conversationId: string;
  assistantMessageId: number | null;
  layer: Exclude<MemoryLayer, "short_term">;
  kind: LongTermKind | WorkingSlotKind;
  key: string | null;
  value: string;
  reason: string | null;
  origin: MemoryOrigin;
  createdAt: string;
};

export type MemoryLayerToggles = {
  shortTerm: boolean;
  working: boolean;
  longTerm: boolean;
};

export const ALL_MEMORY_LAYERS_ENABLED: MemoryLayerToggles = {
  shortTerm: true,
  working: true,
  longTerm: true,
};

export type MemoryLayerTokens = {
  systemTokens: number;
  longTermTokens: number;
  workingTokens: number;
  shortTermTokens: number;
  requestTokens: number;
  promptTokens: number;
  reservedOutputTokens: number;
  contextTokens: number;
  contextLimit: number;
};

export type MemoryRouterCost = {
  promptTokens: number;
  completionTokens: number;
  costMicrosUsd: number;
};

export type MemoryExchangeUsageInput = MemoryLayerTokens & {
  layers: MemoryLayerToggles;
  shortTermMessages: number;
  router: MemoryRouterCost | null;
};

export type MemoryExchangeUsage = MemoryExchangeUsageInput & {
  id: number;
  conversationId: string;
  assistantMessageId: number;
  createdAt: string;
};

export type ShortTermSummary = {
  windowMessages: number;
  totalMessages: number;
  includedMessages: number;
};

export type ConversationMemorySnapshot = {
  conversationId: string;
  longTerm: LongTermEntry[];
  working: WorkingMemory | null;
  shortTerm: ShortTermSummary;
  writes: MemoryWrite[];
  latestUsage: MemoryExchangeUsage | null;
};

export type MemoryRouterWrite =
  | {
      layer: "long_term";
      kind: LongTermKind;
      key: string;
      value: string;
      reason: string | null;
    }
  | {
      layer: "working";
      kind: WorkingSlotKind;
      value: string;
      reason: string | null;
    };

export type MemoryRouterResult = {
  task: WorkingTaskInput | null;
  closeTask: boolean;
  writes: MemoryRouterWrite[];
  cost: MemoryRouterCost | null;
};
