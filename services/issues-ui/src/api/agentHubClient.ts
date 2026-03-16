const BASE_PATH = "/api/v1";

export class HubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

export async function hubFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${BASE_PATH}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // use statusText
    }
    throw new HubError(res.status, message);
  }

  return res.json();
}
