import type {
  StoredExchangeCompression,
  SummaryCheckpoint,
} from "./compression-types";

export type SummaryRow = {
  id: number;
  conversation_id: string;
  summarized_through_message_id: number;
  summarized_message_count: number;
  content: string;
  model: string;
  provider_prompt_tokens: number | null;
  provider_completion_tokens: number | null;
  cost_micros_usd: number;
  created_at: string;
};

export type ExchangeCompressionRow = {
  assistant_message_id: number;
  conversation_id: string;
  summary_id: number | null;
  raw_tail_message_count: number;
  full_prompt_tokens: number;
  compressed_prompt_tokens: number;
  summary_tokens: number;
  raw_tail_tokens: number;
  gross_saved_tokens: number;
  provider_prompt_tokens: number | null;
  provider_completion_tokens: number | null;
  request_tokens: number | null;
  response_tokens: number | null;
  source: StoredExchangeCompression["source"] | null;
  cost_micros_usd: number | null;
  created_at: string;
};

export function mapSummary(row: SummaryRow): SummaryCheckpoint {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    summarizedThroughMessageId: row.summarized_through_message_id,
    summarizedMessageCount: row.summarized_message_count,
    content: row.content,
    model: row.model,
    providerPromptTokens: row.provider_prompt_tokens,
    providerCompletionTokens: row.provider_completion_tokens,
    costMicrosUsd: row.cost_micros_usd,
    createdAt: row.created_at,
  };
}
