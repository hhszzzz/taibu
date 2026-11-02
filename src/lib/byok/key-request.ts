/** Asks the page's model menu to open the key dialog for an own model; the detail is the model's `byok:` reference. */
export const BYOK_KEY_REQUEST_EVENT = 'taibu:byok-key-request';

export function requestByokKey(ref: string): void {
  window.dispatchEvent(new CustomEvent<string>(BYOK_KEY_REQUEST_EVENT, { detail: ref }));
}
