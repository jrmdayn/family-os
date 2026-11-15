import * as Schema from "effect/Schema";

/** Uppercase, without spaces: "fr76 3000 …" → "FR763000…". */
export const normalizeIban = (iban: string): string => iban.replace(/\s+/g, "").toUpperCase();

/** The ISO 13616 check: country, check digits, then mod 97 of the rearranged number. */
const isValidIban = (raw: string): boolean => {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
};

/** A bank account number. Spaces and lowercase are accepted, and removed when recorded. */
export const Iban = Schema.String.check(
  Schema.makeFilter((value: string) => isValidIban(value) || "not a valid IBAN"),
).annotate({
  description: 'An IBAN, with or without spaces ("FR76 3000 6000 0112 3456 7890 189").',
});
