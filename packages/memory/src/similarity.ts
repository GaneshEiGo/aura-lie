export function textSimilarity(text1: string, text2: string): number {
  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    const lower = str.toLowerCase().replace(/[^\w\s]/g, '').trim();
    for (let i = 0; i < lower.length - 1; i++) {
      bigrams.add(lower.substring(i, i + 2));
    }
    return bigrams;
  };

  const set1 = getBigrams(text1);
  const set2 = getBigrams(text2);

  if (set1.size === 0 || set2.size === 0) return 0;

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}