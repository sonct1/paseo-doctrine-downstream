const authorityUpdates = new Map<string, Promise<unknown>>();

/** Serialize prompt dispatch and authority transfer for one agent identity. */
export async function withAgentAuthorityLock<T>(
  agentId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = authorityUpdates.get(agentId);
  const current = previous ? previous.then(action, action) : action();
  authorityUpdates.set(agentId, current);
  try {
    return await current;
  } finally {
    if (authorityUpdates.get(agentId) === current) {
      authorityUpdates.delete(agentId);
    }
  }
}

/** Acquire multiple identities in stable order so adjacent handoffs cannot deadlock. */
export async function withAgentAuthorityLocks<T>(
  agentIds: readonly string[],
  action: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(agentIds)].sort();
  const acquire = (index: number): Promise<T> =>
    index >= ordered.length
      ? action()
      : withAgentAuthorityLock(ordered[index], () => acquire(index + 1));
  return acquire(0);
}
