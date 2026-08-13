/**
 * Personal dictionary (spec #36) — names, jargon, acronyms.
 */

export interface DictionaryEntry {
  term: string;
  replacement: string;
  pronunciation?: string;
  context?: string;
}

export class PersonalDictionary {
  private entries = new Map<string, DictionaryEntry>();

  add(entry: DictionaryEntry): void {
    this.entries.set(entry.term.toLowerCase(), entry);
  }

  remove(term: string): void {
    this.entries.delete(term.toLowerCase());
  }

  list(): DictionaryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Apply case-insensitive whole-word replacements. */
  apply(text: string): string {
    let out = text;
    for (const e of this.entries.values()) {
      const re = new RegExp(`\\b${escapeRegExp(e.term)}\\b`, "gi");
      out = out.replace(re, e.replacement);
    }
    return out;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
