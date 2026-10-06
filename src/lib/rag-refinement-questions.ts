import questions from "./rag-questions.json";
import type { RefinementQuestion } from "./rag-refinement-types";

export const REFINEMENT_QUESTIONS: readonly RefinementQuestion[] = [
  ...questions,
  { id: "outside-delivery", question: "Как в Flash Chat реализован расчёт стоимости доставки через DHL?",
    expectedFacts: ["В корпусе нет реализации расчёта доставки DHL.", "Ответ должен явно признать отсутствие сведений и не придумывать тарифы, API или алгоритм доставки."], source: null, section: null, evidence: null },
  { id: "outside-harvest", question: "Как Flash Chat прогнозирует урожай пшеницы на следующий год?",
    expectedFacts: ["В корпусе нет реализации прогнозирования урожая.", "Ответ должен явно признать отсутствие сведений и не приписывать проекту данные, модель или алгоритм прогнозирования."], source: null, section: null, evidence: null },
];
