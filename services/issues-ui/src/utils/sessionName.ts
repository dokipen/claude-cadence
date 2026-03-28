// Session names are formatted as "{projectId}-{sessionName}" where projectId is a 25-char CUID.
// Strip the prefix for display; preserve the full name for internal API usage.
export function stripProjectPrefix(name: string): string {
  if (name.length > 26 && name[25] === "-") {
    return name.slice(26);
  }
  return name;
}
