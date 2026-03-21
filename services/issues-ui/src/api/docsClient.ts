import { hubFetch } from "./agentHubClient";

export interface DocFile {
  path: string;
  name: string;
}

export interface DocListResponse {
  files: DocFile[];
}

export interface DocContentResponse {
  path: string;
  content: string;
}

export async function fetchDocFiles(): Promise<DocFile[]> {
  const data = await hubFetch<DocListResponse>("/docs");
  return data.files;
}

export async function fetchDocContent(path: string): Promise<string> {
  const encoded = encodeURIComponent(path);
  const data = await hubFetch<DocContentResponse>(`/docs/${encoded}`);
  return data.content;
}
