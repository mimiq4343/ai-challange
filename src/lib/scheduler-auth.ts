import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

type SchedulerAuthorization =
  | { status: 200; profileId: number }
  | { status: 400 | 401 | 503; message: string };

export function authorizeSchedulerRequest(
  headers: IncomingHttpHeaders,
  expectedToken: string | undefined,
): SchedulerAuthorization {
  if (!expectedToken || !/^[A-Za-z0-9_-]{32,256}$/.test(expectedToken)) {
    return { status: 503, message: "Scheduler credentials are not configured" };
  }
  const authorization = headers.authorization;
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  if (typeof authorization !== "string") return { status: 401, message: "Unauthorized" };
  const actual = Buffer.from(authorization);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401, message: "Unauthorized" };
  }
  const profile = headers["x-flash-profile-id"];
  if (typeof profile !== "string" || !/^[1-9]\d*$/.test(profile) || !Number.isSafeInteger(Number(profile))) {
    return { status: 400, message: "A valid profile identifier is required" };
  }
  return { status: 200, profileId: Number(profile) };
}
