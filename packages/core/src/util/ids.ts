let counter = 0;

/** Short, sortable, collision-resistant id. Not cryptographic. */
export function shortId(prefix = ""): string {
  counter = (counter + 1) % 1_000_000;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = counter.toString(36);
  return prefix ? `${prefix}_${time}${rand}${seq}` : `${time}${rand}${seq}`;
}

export function runId(): string {
  return shortId("run");
}

export function taskId(): string {
  return shortId("task");
}

export function traceId(): string {
  return shortId("trace");
}

export function callId(): string {
  return shortId("call");
}

export function workflowId(slug: string): string {
  return `wf_${slug}`;
}
