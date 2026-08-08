const authorityUpdates = new Map<string, Promise<unknown>>();

/** Serialize prompt dispatch and authority transfer for one agent identity. */
export async function withAgentAuthorityLock<T>(
  agentId: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = authorityUpdates.get(agentId) ?? Promise.resolve();
  const current = previous.then(action, action);
  authorityUpdates.set(agentId, current);
  try {
    return await current;
  } finally {
    if (authorityUpdates.get(agentId) === current) {
      authorityUpdates.delete(agentId);
    }
  }
}
