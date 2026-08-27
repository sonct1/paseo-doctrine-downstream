export function shouldShowProjectConfiguration(protocolRoot: string | undefined): boolean {
  return !protocolRoot?.trim();
}
