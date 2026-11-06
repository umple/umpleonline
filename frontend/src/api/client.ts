import type {
  GenerationRequest,
  GenerationResponse,
  ExampleSet,
  ExampleResponse,
  DiagramResponse,
  GetModelResponse,
  CrudSchemaResponse,
  PromoteResponse,
  StatusResponse,
  StatusSummary,
} from "./types";

const API_BASE = "/api";

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

async function requestBlob(path: string, options?: RequestInit): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.blob();
}

export const api = {
  generate(req: GenerationRequest, signal?: AbortSignal): Promise<GenerationResponse> {
    return request("/generate", {
      method: "POST",
      body: JSON.stringify(req),
      signal,
    });
  },

  listExamples(): Promise<ExampleSet[]> {
    return request("/examples");
  },

  getModel(id: string, signal?: AbortSignal): Promise<GetModelResponse> {
    return request(`/models/${encodeURIComponent(id)}`, { signal });
  },

  getExample(id: string): Promise<ExampleResponse> {
    return request(`/examples/${encodeURIComponent(id)}`);
  },

  resolveExample(example: string): Promise<ExampleResponse> {
    return request(`/examples/resolve?example=${encodeURIComponent(example)}`);
  },

  async sync(req: {
    action: string;
    modelId: string;
    params: Record<string, string>;
  }): Promise<{
    code: string;
    result: string;
    errors?: string;
    modelId?: string;
    rejected?: boolean;
    noEffect?: boolean;
  }> {
    const res = await fetch(`${API_BASE}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    // 422 carries a valid SyncResponse with rejected: true — parse it normally.
    if (!res.ok && res.status !== 422) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  diagram(req: {
    code: string;
    diagramType: string;
    modelId?: string;
    suboptions?: string[];
    classFilterQuery?: string;
    namedFilters?: string[];
    mixsets?: string[];
    needsLayout?: boolean;
    activeTabId?: string;
  }): Promise<DiagramResponse> {
    return request("/diagram", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  export(req: {
    code: string;
    format: string;
    modelId?: string;
    activeTabId?: string;
  }): Promise<Blob> {
    return requestBlob("/export", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  execute(req: {
    code: string;
    language: string;
    modelId?: string;
    activeTabId?: string;
  }): Promise<{ output: string; errors?: string }> {
    return request("/execute", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  crudSchema(req: {
    code: string;
    modelId?: string;
    activeTabId?: string;
  }): Promise<CrudSchemaResponse> {
    return request("/crud/schema", {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  crudDiagram(dot: string): Promise<{ svg: string; error?: string }> {
    return request("/crud/diagram", {
      method: "POST",
      body: JSON.stringify({ dot }),
    });
  },

  promoteModel(id: string): Promise<PromoteResponse> {
    return request(`/models/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    });
  },

  status(signal?: AbortSignal): Promise<StatusResponse> {
    return request("/status", { signal });
  },

  statusSummary(signal?: AbortSignal): Promise<StatusSummary> {
    return request("/status/summary", { signal });
  },

  async recordVisit(): Promise<void> {
    const res = await fetch("/api/status/visit", { method: "POST" });
    if (!res.ok) throw new Error("Could not record visit");
  },

  async recordSessionStarted(): Promise<void> {
    const res = await fetch(`${API_BASE}/status/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
  },
};
