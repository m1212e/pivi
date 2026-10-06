import { customAlphabet } from 'nanoid';

// Ids for table primary keys (see db/schema.ts). The alphabet leaves out
// lookalike characters so ids can't be mixed up when read or typed.
// https://github.com/CyberAP/nanoid-dictionary?tab=readme-ov-file#nolookalikessafe
const NANOID_ALPHABET = '6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz';
const NANOID_LENGTH = 30;
export const nanoid = customAlphabet(NANOID_ALPHABET, NANOID_LENGTH);
