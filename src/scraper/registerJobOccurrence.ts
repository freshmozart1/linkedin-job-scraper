// Registers this occurrence of a LinkedIn posting ID and returns the index of
// the earlier job it duplicates, or null if it's the first occurrence.
// Later occurrences must NOT repoint the map: it has to keep naming the first
// occurrence so every duplicate (and the stale-retry pass, which re-scrapes a
// job at its own index and must not see itself as a duplicate) resolves to
// the same first index.
export function registerJobOccurrence(
    seenSourceJobIds: Map<string, number>,
    sourceJobId: string | null,
    index: number,
): number | null {
    if (sourceJobId === null) return null;
    const firstSeenIndex = seenSourceJobIds.get(sourceJobId);
    if (firstSeenIndex === undefined) {
        seenSourceJobIds.set(sourceJobId, index);
        return null;
    }
    return firstSeenIndex === index ? null : firstSeenIndex;
}
