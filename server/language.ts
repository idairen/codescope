import type { Language, LanguageChoice, SourceFile } from '../shared/types';
export function detectLanguage(documents: SourceFile[]): LanguageChoice {
  const ranked = [...documents].sort(
    (a, b) => rank(b.path) - rank(a.path) || a.path.localeCompare(b.path),
  );
  const votes = new Map<Language, number>();
  const evidence: string[] = [];
  for (const doc of ranked.slice(0, 30)) {
    const text = doc.text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .slice(0, 18000);
    const counts = {
      ja: (text.match(/[\u3040-\u30ff]/g) ?? []).length,
      ko: (text.match(/[\uac00-\ud7af]/g) ?? []).length,
      ru: (text.match(/[\u0400-\u04ff]/g) ?? []).length,
      zh: (text.match(/[\u4e00-\u9fff]/g) ?? []).length,
    };
    let lang: Language =
      counts.ja >= 8
        ? 'ja'
        : counts.ko >= 8
          ? 'ko'
          : counts.ru >= 12
            ? 'ru'
            : counts.zh >= 12
              ? 'zh'
              : 'unknown';
    if (
      lang === 'unknown' &&
      (text.match(/\b(the|and|this|with|from|for|is|are|to|of)\b/gi) ?? []).length >= 5
    )
      lang = 'en';
    if (lang === 'unknown') continue;
    evidence.push(doc.path);
    // A substantial primary README defines the default; localized copies do not outvote it.
    if (/^readme\.(md|mdx|rst|txt)$/i.test(doc.path) && text.trim().length >= 100)
      return { code: lang, evidence: [doc.path], reason: 'primary-readme' };
    votes.set(lang, (votes.get(lang) ?? 0) + rank(doc.path));
  }
  const sorted = [...votes].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || (sorted[1] && sorted[0][1] < sorted[1][1] * 1.3))
    return { code: 'unknown', evidence, reason: 'insufficient-or-mixed' };
  return { code: sorted[0][0], evidence, reason: 'documentation-majority' };
}
function rank(p: string): number {
  return /^readme\./i.test(p) ? 5 : /architecture|架构/i.test(p) ? 4 : /docs\//i.test(p) ? 3 : 1;
}
