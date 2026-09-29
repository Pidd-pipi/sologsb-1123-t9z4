const PLAN_CHANGED_EVENT = 'gbdronemap:plan-changed';

export function emitPlanChanged(): void {
  window.dispatchEvent(new CustomEvent(PLAN_CHANGED_EVENT));
}

export function onPlanChanged(listener: () => void): () => void {
  window.addEventListener(PLAN_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PLAN_CHANGED_EVENT, listener);
}
