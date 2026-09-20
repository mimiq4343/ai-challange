export type ProfileTone = "neutral" | "friendly" | "formal" | "direct";
export type ProfileVerbosity = "brief" | "balanced" | "detailed";
export type ProfileFormat = "prose" | "bullets" | "table" | "code_first";
export type ProfileLanguage = "ru" | "en" | "auto";
export type ProfileExpertise = "beginner" | "intermediate" | "expert";

export type ProfilePreferences = {
  role: string | null;
  tone: ProfileTone;
  verbosity: ProfileVerbosity;
  format: ProfileFormat;
  language: ProfileLanguage;
  expertise: ProfileExpertise;
};

export type ProfileConstraint = {
  id: number;
  profileId: number;
  value: string;
  origin: "router" | "user";
  reason: string | null;
  createdAt: string;
};

export type UserProfile = ProfilePreferences & {
  id: number;
  name: string;
  active: boolean;
  constraints: ProfileConstraint[];
  createdAt: string;
  updatedAt: string;
};

export type ProfileInput = Partial<ProfilePreferences> & { name: string };

export type ProfilePreferenceField = keyof Omit<ProfilePreferences, "role"> | "role";

export type ProfileRouterWrite = {
  layer: "profile";
  kind: ProfilePreferenceField | "constraint";
  value: string;
  reason: string | null;
};

export const PROFILE_TONES: Record<ProfileTone, string> = {
  neutral: "нейтральный",
  friendly: "дружелюбный",
  formal: "официальный",
  direct: "прямой",
};

export const PROFILE_VERBOSITIES: Record<ProfileVerbosity, string> = {
  brief: "кратко",
  balanced: "сбалансированно",
  detailed: "подробно",
};

export const PROFILE_FORMATS: Record<ProfileFormat, string> = {
  prose: "связный текст",
  bullets: "списки",
  table: "таблицы",
  code_first: "сначала код",
};

export const PROFILE_LANGUAGES: Record<ProfileLanguage, string> = {
  ru: "русский",
  en: "английский",
  auto: "язык пользователя",
};

export const PROFILE_EXPERTISES: Record<ProfileExpertise, string> = {
  beginner: "начальный",
  intermediate: "средний",
  expert: "экспертный",
};

export const DEFAULT_PROFILE_PREFERENCES: ProfilePreferences = {
  role: null,
  tone: "neutral",
  verbosity: "balanced",
  format: "prose",
  language: "ru",
  expertise: "intermediate",
};

export const PROFILE_FIELD_VALUES = {
  tone: PROFILE_TONES,
  verbosity: PROFILE_VERBOSITIES,
  format: PROFILE_FORMATS,
  language: PROFILE_LANGUAGES,
  expertise: PROFILE_EXPERTISES,
} as const;

export type ProfileEnumField = keyof typeof PROFILE_FIELD_VALUES;

/** Проверяет, что значение допустимо для перечислимого поля профиля. */
export function isPreferenceValue(field: ProfileEnumField, value: string): boolean {
  return value in PROFILE_FIELD_VALUES[field];
}
