const endpoint =
  "https://encsvkwnsuwjxwrqxcsr.supabase.co/functions/v1/guest-account-deletion";
const legalOrigin = "https://getbloomdoc.com";
const codePattern =
  /^BDR1:([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):([a-f0-9]{64})$/;
const unavailable =
  "Deletion could not be confirmed. Keep the code and try again later.";
const maximumResponseBytes = 4096;

class RecoveryError extends Error {}

export function parseGuestDeletionRecoveryCode(raw) {
  if (typeof raw !== "string" || raw.length > 110) {
    throw new RecoveryError("Enter the complete recovery code saved from BloomDoc.");
  }
  const match = codePattern.exec(raw.trim());
  if (!match) {
    throw new RecoveryError("Enter the complete recovery code saved from BloomDoc.");
  }
  return { capability_id: match[1], capability_secret: match[2] };
}

async function boundedResponse(response, signal) {
  if (
    response.redirected || !response.body ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
  ) {
    void response.body?.cancel().catch(() => {});
    throw new RecoveryError(unavailable);
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumResponseBytes)) {
    void response.body.cancel().catch(() => {});
    throw new RecoveryError(unavailable);
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  try {
    while (true) {
      if (signal.aborted) throw new RecoveryError(unavailable);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumResponseBytes) throw new RecoveryError(unavailable);
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function requestGuestDeletion(raw, {
  fetcher = fetch, signal, deadlineMs = 15000,
} = {}) {
  const body = parseGuestDeletionRecoveryCode(raw);
  if (!Number.isFinite(deadlineMs) || deadlineMs < 1 || deadlineMs > 15000) {
    throw new RecoveryError(unavailable);
  }
  if (signal?.aborted) throw new RecoveryError(unavailable);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const stopped = new Promise((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new RecoveryError(unavailable)), { once: true });
  });
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, deadlineMs);
  try {
    return await Promise.race([stopped, (async () => {
      const response = await fetcher(endpoint, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 429) {
        void response.body?.cancel().catch(() => {});
        throw new RecoveryError("Too many attempts. Keep the code and try again later.");
      }
      const value = await boundedResponse(response, controller.signal);
      if (response.status === 404 && value?.error === "recovery_unavailable") {
        throw new RecoveryError("That recovery code could not be verified.");
      }
      if (!response.ok || value?.accepted !== true) throw new RecoveryError(unavailable);
      const complete = response.status === 200 &&
        value.cloud_complete === true && value.pending === false &&
        value.state === "complete";
      const pending = response.status === 202 &&
        value.cloud_complete === false && value.pending === true &&
        ["pending", "attention", "finalizing"].includes(value.state);
      if (!complete && !pending) {
        throw new RecoveryError("Deletion status was inconsistent. Keep the code and contact support.");
      }
      return { complete, state: value.state };
    })()]);
  } catch (error) {
    // Never display transport or server-provided text: it may include a code.
    throw error instanceof RecoveryError ? error : new RecoveryError(unavailable);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

export function wireGuestDeletionForm({
  document: page = globalThis.document,
  window: browser = globalThis.window,
  request = requestGuestDeletion,
} = {}) {
  const form = page?.querySelector("#guest-deletion-form");
  const input = page?.querySelector("#recovery-code");
  const consent = page?.querySelector("#deletion-consent");
  const output = page?.querySelector("#deletion-result");
  const button = page?.querySelector("#request-deletion");
  const fields = page?.querySelector("#deletion-fields");
  if (!form || !input || !consent || !output || !button || !fields || !browser) return;
  let active = null;
  let generation = 0;
  const clearPrivateInput = () => {
    input.value = "";
    consent.checked = false;
  };
  const isAllowedContext = () => {
    try { return browser.top === browser.self && browser.location.origin === legalOrigin; }
    catch { return false; }
  };
  const resetPage = () => {
    generation++;
    active?.abort();
    active = null;
    clearPrivateInput();
    button.disabled = false;
    form.removeAttribute("aria-busy");
    output.textContent = "";
    delete output.dataset.state;
    const allowed = isAllowedContext();
    fields.disabled = !allowed;
    form.hidden = !allowed;
    if (!allowed) {
      output.textContent = "Open https://getbloomdoc.com/legal/delete-account.html directly in your browser to use a recovery code.";
    }
  };
  // Fail closed in embedded pages even where the host cannot send frame headers.
  // This is not a substitute for HTTP frame-ancestors / X-Frame-Options.
  resetPage();
  browser.addEventListener("pagehide", () => {
    resetPage();
    fields.disabled = true;
    form.hidden = true;
  });
  browser.addEventListener("pageshow", resetPage);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (active || !isAllowedContext() || fields.disabled) return;
    if (!consent.checked) {
      output.dataset.state = "error";
      output.textContent = "Confirm that you understand permanent deletion before continuing.";
      return;
    }
    const raw = input.value;
    clearPrivateInput();
    const requestGeneration = ++generation;
    active = new AbortController();
    button.disabled = true;
    fields.disabled = true;
    form.setAttribute("aria-busy", "true");
    output.textContent = "Checking the recovery code…";
    output.dataset.state = "pending";
    try {
      const result = await request(raw, { signal: active.signal });
      if (requestGeneration !== generation) return;
      output.dataset.state = result.complete ? "complete" : "pending";
      output.textContent = result.complete
        ? "Cloud account deletion is complete. Your store subscription is separate; cancel it with Apple or Google if needed."
        : "Deletion was accepted and is still pending. This is not confirmation of completed deletion. Keep your recovery code and check again later.";
    } catch (error) {
      if (requestGeneration !== generation) return;
      output.dataset.state = "error";
      output.textContent = error instanceof RecoveryError ? error.message : unavailable;
    } finally {
      if (requestGeneration === generation) {
        active = null;
        clearPrivateInput();
        button.disabled = false;
        fields.disabled = false;
        form.removeAttribute("aria-busy");
      }
    }
  });
}

if (typeof document !== "undefined") wireGuestDeletionForm();

export const guestDeletionEndpoint = endpoint;
