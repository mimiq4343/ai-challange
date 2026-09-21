export type InvariantCategory =
  | "architecture"
  | "tech_decision"
  | "stack"
  | "business_rule";

export type InvariantStatus = "active" | "retired";

export type InvariantOrigin = "user" | "agent";

export type Invariant = {
  id: number;
  profileId: number;
  category: InvariantCategory;
  statement: string;
  rationale: string | null;
  status: InvariantStatus;
  blockedCount: number;
  origin: InvariantOrigin;
  createdAt: string;
  updatedAt: string;
};

export type InvariantInput = {
  category: InvariantCategory;
  statement: string;
  rationale: string | null;
};

export type InvariantProposal = InvariantInput & {
  id: number;
  profileId: number;
  conversationId: string | null;
  createdAt: string;
};

export type InvariantEventKind =
  | "created"
  | "updated"
  | "retired"
  | "restored"
  | "proposal_accepted"
  | "proposal_rejected"
  | "violation_blocked";

export type InvariantEvent = {
  id: number;
  profileId: number;
  invariantId: number | null;
  kind: InvariantEventKind;
  origin: InvariantOrigin;
  statement: string | null;
  detail: string | null;
  conversationId: string | null;
  createdAt: string;
};

export type InvariantSnapshot = {
  invariants: Invariant[];
  proposals: InvariantProposal[];
  events: InvariantEvent[];
};

/** Решение предварительной проверки запроса. */
export type GuardVerdict =
  | { verdict: "allow" }
  | {
      verdict: "conflict";
      invariantIds: number[];
      explanation: string;
      alternative: string | null;
    };

export const INVARIANT_CATEGORY_LABELS: Record<InvariantCategory, string> = {
  architecture: "архитектура",
  tech_decision: "техрешение",
  stack: "стек",
  business_rule: "бизнес-правило",
};
