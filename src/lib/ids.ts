import { customAlphabet } from "nanoid";

/** URL-friendly, unambiguous alphabet (no 0/O/1/l/I). */
const alphabet = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

export const newId = customAlphabet(alphabet, 12);
/** Event slug — short enough to read aloud, long enough to be unguessable-ish. */
export const newSlug = customAlphabet(alphabet, 10);
/** Secrets: organizer token, respondent edit token, webhook secret. */
export const newToken = customAlphabet(alphabet, 24);
