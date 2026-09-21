"use client";

import { useState } from "react";
import { IdentificationCardIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";

import {
  PROFILE_EXPERTISES,
  PROFILE_FORMATS,
  PROFILE_LANGUAGES,
  PROFILE_TONES,
  PROFILE_VERBOSITIES,
  type ProfileEnumField,
  type UserProfile,
} from "@/lib/profile-types";

const FIELD_LABELS: Record<ProfileEnumField, string> = {
  tone: "Тон",
  verbosity: "Длина",
  format: "Формат",
  language: "Язык",
  expertise: "Уровень",
};

const FIELD_OPTIONS: Record<ProfileEnumField, Record<string, string>> = {
  tone: PROFILE_TONES,
  verbosity: PROFILE_VERBOSITIES,
  format: PROFILE_FORMATS,
  language: PROFILE_LANGUAGES,
  expertise: PROFILE_EXPERTISES,
};

export type ProfilePanelProps = {
  profiles: UserProfile[];
  activeProfile: UserProfile | null;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  profileTokens: number | null;
  onToggle: (enabled: boolean) => void;
  onActivate: (profileId: number) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onDelete: (profileId: number) => Promise<void>;
  onUpdate: (
    profileId: number,
    patch: Partial<Record<ProfileEnumField | "role" | "name", string>>,
  ) => Promise<void>;
  onAddConstraint: (profileId: number, value: string) => Promise<void>;
  onDeleteConstraint: (profileId: number, constraintId: number) => Promise<void>;
};

export function ProfilePanel({
  profiles,
  activeProfile,
  enabled,
  busy,
  error,
  profileTokens,
  onToggle,
  onActivate,
  onCreate,
  onDelete,
  onUpdate,
  onAddConstraint,
  onDeleteConstraint,
}: ProfilePanelProps) {
  const [newProfileName, setNewProfileName] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [constraint, setConstraint] = useState("");

  const roleValue = role ?? activeProfile?.role ?? "";

  async function submitProfile() {
    const name = newProfileName.trim();
    if (name.length === 0) return;
    await onCreate(name);
    setNewProfileName("");
  }

  async function submitConstraint() {
    if (!activeProfile || constraint.trim().length === 0) return;
    await onAddConstraint(activeProfile.id, constraint.trim());
    setConstraint("");
  }

  async function submitRole() {
    if (!activeProfile) return;
    const next = roleValue.trim();
    if (next === (activeProfile.role ?? "")) return;
    await onUpdate(activeProfile.id, { role: next });
    setRole(null);
  }

  return (
    <section className="flex flex-col gap-3 border-b border-line px-4 py-4">
      <header className="flex items-start justify-between gap-3 pr-12 xl:pr-0">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            User profile
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight">Профиль</h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Слой профиля в промпте"
          onClick={() => onToggle(!enabled)}
          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            enabled
              ? "border-accent/40 bg-accent/10 text-foreground"
              : "border-line text-muted hover:text-foreground"
          }`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${enabled ? "bg-sky-400" : "bg-white/20"}`}
          />
          PROF {profileTokens === null ? "" : `${profileTokens} ток.`}
        </button>
      </header>

      {error && (
        <p
          className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={activeProfile?.id ?? ""}
          aria-label="Активный профиль"
          disabled={busy}
          onChange={(event) => void onActivate(Number(event.target.value))}
          className="min-h-11 min-w-0 flex-1 cursor-pointer rounded-lg border border-line bg-background px-2 text-xs disabled:opacity-50"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Удалить активный профиль"
          disabled={busy || profiles.length < 2 || !activeProfile}
          onClick={() => activeProfile && void onDelete(activeProfile.id)}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-muted transition-colors hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <TrashIcon size={15} aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newProfileName}
          onChange={(event) => setNewProfileName(event.target.value)}
          placeholder="Новый профиль"
          aria-label="Имя нового профиля"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Создать профиль"
          disabled={busy || newProfileName.trim().length === 0}
          onClick={() => void submitProfile()}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <PlusIcon size={15} weight="bold" aria-hidden />
        </button>
      </div>

      {activeProfile && (
        <>
          <div className="flex items-center gap-2">
            <IdentificationCardIcon className="text-accent" size={16} aria-hidden />
            <input
              value={roleValue}
              onChange={(event) => setRole(event.target.value)}
              onBlur={() => void submitRole()}
              placeholder="Роль пользователя"
              aria-label="Роль пользователя"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(FIELD_OPTIONS) as ProfileEnumField[]).map((field) => (
              <label key={field} className="flex flex-col gap-1 text-[10px] text-muted">
                {FIELD_LABELS[field]}
                <select
                  value={activeProfile[field]}
                  disabled={busy}
                  onChange={(event) =>
                    void onUpdate(activeProfile.id, { [field]: event.target.value })
                  }
                  className="min-h-11 cursor-pointer rounded-lg border border-line bg-background px-2 text-[11px] text-foreground disabled:opacity-50"
                >
                  {Object.entries(FIELD_OPTIONS[field]).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div>
            <p className="text-[11px] font-medium">Ограничения</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {activeProfile.constraints.length === 0 && (
                <li className="rounded-lg border border-dashed border-line px-2 py-2 text-center text-[11px] text-muted">
                  Ограничений нет
                </li>
              )}
              {activeProfile.constraints.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-lg border border-line px-2 py-1.5"
                >
                  <span className="mt-0.5 rounded-full bg-sky-400/15 px-1.5 py-0.5 font-mono text-[9px] text-sky-200">
                    {item.origin === "user" ? "вручную" : "роутер"}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed">
                    {item.value}
                  </span>
                  <button
                    type="button"
                    aria-label={`Удалить ограничение ${item.value}`}
                    disabled={busy}
                    onClick={() => void onDeleteConstraint(activeProfile.id, item.id)}
                    className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                  >
                    <TrashIcon size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={constraint}
                onChange={(event) => setConstraint(event.target.value)}
                placeholder="Например: без эмодзи"
                aria-label="Новое ограничение"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-background px-2 text-[11px] placeholder:text-muted/70 focus:border-accent/50 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Добавить ограничение"
                disabled={busy || constraint.trim().length === 0}
                onClick={() => void submitConstraint()}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-line text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
              >
                <PlusIcon size={15} weight="bold" aria-hidden />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
