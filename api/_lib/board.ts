/**
 * Boards — each is an independent shared roster identified by a short code.
 *
 * A board lives entirely in Redis: `board:{id}:meta` (JSON name/createdAt) plus
 * `board:{id}:users` (a SET of usernames). The code in the URL (`/b/{id}`) is
 * the only key needed to view/edit it — no accounts, no login. Boards require
 * Redis; without it `createBoard` reports unavailable and lookups 404.
 */

import { randomInt } from "node:crypto";
import { getRedis } from "./redis.js";
import { KEY } from "./config.js";

// Crockford-ish base32: no 0/1/O/I/L/U to avoid ambiguous, confusable codes.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_LENGTH = 7;

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
}

/** Generate a random, human-friendly board id (e.g. "K7P2QXM"). */
function newId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

/**
 * Normalize + validate a board id from untrusted input (URL/query). Uppercases
 * (codes are case-insensitive) and confirms charset/length. Returns null if bad.
 */
export function normalizeBoardId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toUpperCase();
  return /^[0-9A-Z]{4,16}$/.test(id) ? id : null;
}

/** Clamp/clean a user-supplied board name; empty → falls back to the code. */
export function cleanBoardName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  return name || fallback;
}

export async function getBoardMeta(id: string): Promise<BoardMeta | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<BoardMeta>(KEY.boardMeta(id));
  } catch (e) {
    console.error(`[board] meta read failed for ${id}`, e);
    return null;
  }
}

export async function boardExists(id: string): Promise<boolean> {
  return (await getBoardMeta(id)) !== null;
}

/**
 * Create a new board. Returns null when Redis isn't configured. Retries a few
 * times on the (astronomically unlikely) id collision.
 */
export async function createBoard(name?: string): Promise<BoardMeta | null> {
  const redis = getRedis();
  if (!redis) return null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId();
    if (await redis.exists(KEY.boardMeta(id))) continue;
    const meta: BoardMeta = {
      id,
      name: cleanBoardName(name, id),
      createdAt: Date.now(),
    };
    await redis.set(KEY.boardMeta(id), meta);
    await redis.sadd(KEY.boards, id);
    return meta;
  }
  return null;
}
