import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { ensureMemorySchema } from "./memory-schema";
import { openChatDatabase, releaseChatDatabase } from "./sqlite-database";
import {
  DEFAULT_PROFILE_PREFERENCES,
  isPreferenceValue,
  type ProfileConstraint,
  type ProfileInput,
  type ProfilePreferences,
  type ProfileRouterWrite,
  type UserProfile,
} from "./profile-types";

type ProfileRow = {
  id: number;
  name: string;
  role: string | null;
  tone: UserProfile["tone"];
  verbosity: UserProfile["verbosity"];
  format: UserProfile["format"];
  language: UserProfile["language"];
  expertise: UserProfile["expertise"];
  active: number;
  created_at: string;
  updated_at: string;
};

type ConstraintRow = {
  id: number;
  profile_id: number;
  value: string;
  origin: "router" | "user";
  reason: string | null;
  created_at: string;
};

export class ProfileNotFoundError extends Error {
  constructor(readonly profileId: number) {
    super(`Профиль ${profileId} не найден.`);
    this.name = "ProfileNotFoundError";
  }
}

export class LastProfileError extends Error {
  constructor() {
    super("Нельзя удалить последний профиль.");
    this.name = "LastProfileError";
  }
}

export class SqliteProfileStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly listProfilesStatement: StatementSync;
  private readonly getProfileStatement: StatementSync;
  private readonly getActiveProfileStatement: StatementSync;
  private readonly insertProfileStatement: StatementSync;
  private readonly updateProfileStatement: StatementSync;
  private readonly deleteProfileStatement: StatementSync;
  private readonly deactivateProfilesStatement: StatementSync;
  private readonly activateProfileStatement: StatementSync;
  private readonly listConstraintsStatement: StatementSync;
  private readonly insertConstraintStatement: StatementSync;
  private readonly deleteConstraintStatement: StatementSync;
  private readonly insertWriteStatement: StatementSync;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    this.database = openChatDatabase(databasePath);
    ensureMemorySchema(this.database);

    const columns = `id, name, role, tone, verbosity, format, language, expertise,
                     active, created_at, updated_at`;
    this.listProfilesStatement = this.database.prepare(`
      SELECT ${columns} FROM memory_profiles ORDER BY name COLLATE NOCASE ASC, id ASC
    `);
    this.getProfileStatement = this.database.prepare(`
      SELECT ${columns} FROM memory_profiles WHERE id = ?
    `);
    this.getActiveProfileStatement = this.database.prepare(`
      SELECT ${columns} FROM memory_profiles WHERE active = 1
    `);
    this.insertProfileStatement = this.database.prepare(`
      INSERT INTO memory_profiles (
        name, role, tone, verbosity, format, language, expertise, active,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      RETURNING ${columns}
    `);
    this.updateProfileStatement = this.database.prepare(`
      UPDATE memory_profiles
      SET name = ?, role = ?, tone = ?, verbosity = ?, format = ?, language = ?,
          expertise = ?, updated_at = ?
      WHERE id = ?
      RETURNING ${columns}
    `);
    this.deleteProfileStatement = this.database.prepare(`
      DELETE FROM memory_profiles WHERE id = ?
    `);
    this.deactivateProfilesStatement = this.database.prepare(`
      UPDATE memory_profiles SET active = 0, updated_at = ? WHERE active = 1
    `);
    this.activateProfileStatement = this.database.prepare(`
      UPDATE memory_profiles SET active = 1, updated_at = ? WHERE id = ?
    `);
    this.listConstraintsStatement = this.database.prepare(`
      SELECT id, profile_id, value, origin, reason, created_at
      FROM memory_profile_constraints
      WHERE profile_id = ?
      ORDER BY id ASC
    `);
    this.insertConstraintStatement = this.database.prepare(`
      INSERT INTO memory_profile_constraints (profile_id, value, origin, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (profile_id, value) DO NOTHING
      RETURNING id, profile_id, value, origin, reason, created_at
    `);
    this.deleteConstraintStatement = this.database.prepare(`
      DELETE FROM memory_profile_constraints WHERE id = ? AND profile_id = ?
    `);
    this.insertWriteStatement = this.database.prepare(`
      INSERT INTO memory_writes (
        conversation_id, assistant_message_id, layer, kind, key, value, reason,
        origin, created_at
      ) VALUES (?, ?, 'profile', ?, ?, ?, ?, ?, ?)
    `);
  }

  private toProfile(row: ProfileRow): UserProfile {
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      tone: row.tone,
      verbosity: row.verbosity,
      format: row.format,
      language: row.language,
      expertise: row.expertise,
      active: row.active === 1,
      constraints: (this.listConstraintsStatement.all(row.id) as ConstraintRow[]).map(
        (constraint) => ({
          id: constraint.id,
          profileId: constraint.profile_id,
          value: constraint.value,
          origin: constraint.origin,
          reason: constraint.reason,
          createdAt: constraint.created_at,
        }),
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listProfiles(): UserProfile[] {
    return (this.listProfilesStatement.all() as ProfileRow[]).map((row) =>
      this.toProfile(row),
    );
  }

  getProfile(id: number): UserProfile | null {
    const row = this.getProfileStatement.get(id) as ProfileRow | undefined;
    return row ? this.toProfile(row) : null;
  }

  /** Активный профиль существует всегда: схема создаёт его при инициализации. */
  getActiveProfile(): UserProfile {
    const row = this.getActiveProfileStatement.get() as ProfileRow | undefined;
    if (!row) throw new Error("Активный профиль отсутствует в базе.");
    return this.toProfile(row);
  }

  createProfile(input: ProfileInput): UserProfile {
    const timestamp = new Date().toISOString();
    const preferences: ProfilePreferences = {
      ...DEFAULT_PROFILE_PREFERENCES,
      ...input,
      role: input.role ?? null,
    };
    const row = this.insertProfileStatement.get(
      input.name,
      preferences.role,
      preferences.tone,
      preferences.verbosity,
      preferences.format,
      preferences.language,
      preferences.expertise,
      timestamp,
      timestamp,
    ) as ProfileRow;
    return this.toProfile(row);
  }

  updateProfile(id: number, input: ProfileInput): UserProfile {
    const existing = this.getProfile(id);
    if (!existing) throw new ProfileNotFoundError(id);

    const row = this.updateProfileStatement.get(
      input.name,
      input.role ?? null,
      input.tone ?? existing.tone,
      input.verbosity ?? existing.verbosity,
      input.format ?? existing.format,
      input.language ?? existing.language,
      input.expertise ?? existing.expertise,
      new Date().toISOString(),
      id,
    ) as ProfileRow;
    return this.toProfile(row);
  }

  activateProfile(id: number): UserProfile {
    if (!this.getProfile(id)) throw new ProfileNotFoundError(id);

    const timestamp = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.deactivateProfilesStatement.run(timestamp);
      this.activateProfileStatement.run(timestamp, id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return this.getProfile(id) as UserProfile;
  }

  /**
   * Удаляет профиль вместе с его памятью и ограничениями. Если удалён активный
   * профиль, активным становится следующий по имени.
   */
  deleteProfile(id: number): UserProfile {
    const profiles = this.listProfiles();
    const target = profiles.find((profile) => profile.id === id);
    if (!target) throw new ProfileNotFoundError(id);
    if (profiles.length === 1) throw new LastProfileError();

    const next = profiles.find((profile) => profile.id !== id) as UserProfile;
    this.deleteProfileStatement.run(id);
    return target.active ? this.activateProfile(next.id) : this.getActiveProfile();
  }

  addConstraint(
    profileId: number,
    value: string,
    origin: "router" | "user",
    reason: string | null,
    journal?: { conversationId: string | null; assistantMessageId: number | null },
  ): ProfileConstraint | null {
    if (!this.getProfile(profileId)) throw new ProfileNotFoundError(profileId);

    const timestamp = new Date().toISOString();
    const row = this.insertConstraintStatement.get(
      profileId,
      value,
      origin,
      reason,
      timestamp,
    ) as ConstraintRow | undefined;
    if (!row) return null;

    if (journal) {
      this.insertWriteStatement.run(
        journal.conversationId,
        journal.assistantMessageId,
        "constraint",
        null,
        value,
        reason,
        origin,
        timestamp,
      );
    }

    return {
      id: row.id,
      profileId: row.profile_id,
      value: row.value,
      origin: row.origin,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }

  deleteConstraint(profileId: number, constraintId: number): boolean {
    return this.deleteConstraintStatement.run(constraintId, profileId).changes > 0;
  }

  /**
   * Применяет решения роутера по слою профиля: меняет предпочтения и добавляет
   * ограничения. Возвращает число реально применённых записей.
   */
  applyProfileWrites(
    profileId: number,
    writes: readonly ProfileRouterWrite[],
    journal: { conversationId: string | null; assistantMessageId: number | null },
  ): number {
    if (writes.length === 0) return 0;

    const profile = this.getProfile(profileId);
    if (!profile) throw new ProfileNotFoundError(profileId);

    let applied = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const preferences: ProfilePreferences = {
        role: profile.role,
        tone: profile.tone,
        verbosity: profile.verbosity,
        format: profile.format,
        language: profile.language,
        expertise: profile.expertise,
      };
      let preferencesChanged = false;
      const timestamp = new Date().toISOString();

      for (const write of writes) {
        if (write.kind === "constraint") {
          if (this.addConstraint(profileId, write.value, "router", write.reason)) {
            this.insertWriteStatement.run(
              journal.conversationId,
              journal.assistantMessageId,
              "constraint",
              null,
              write.value,
              write.reason,
              "router",
              timestamp,
            );
            applied += 1;
          }
          continue;
        }

        if (write.kind === "role") {
          preferences.role = write.value;
        } else if (isPreferenceValue(write.kind, write.value)) {
          preferences[write.kind] = write.value as never;
        } else {
          continue;
        }

        preferencesChanged = true;
        applied += 1;
        this.insertWriteStatement.run(
          journal.conversationId,
          journal.assistantMessageId,
          write.kind,
          null,
          write.value,
          write.reason,
          "router",
          timestamp,
        );
      }

      if (preferencesChanged) {
        this.updateProfileStatement.run(
          profile.name,
          preferences.role,
          preferences.tone,
          preferences.verbosity,
          preferences.format,
          preferences.language,
          preferences.expertise,
          timestamp,
          profileId,
        );
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    return applied;
  }

  close(): void {
    releaseChatDatabase(this.databasePath);
  }
}

const globalForProfileStore = globalThis as typeof globalThis & {
  profileStore?: SqliteProfileStore;
};

export function getProfileStore(): SqliteProfileStore {
  globalForProfileStore.profileStore ??= new SqliteProfileStore(
    join(process.cwd(), "data", "chat.sqlite"),
  );
  return globalForProfileStore.profileStore;
}
