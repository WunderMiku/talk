/* ============================================================
   talk. — Declarative data-action dispatch registry
   Allows each feature/view module to register its own click
   action handlers so app.js no longer carries a monolithic switch.
   ============================================================ */

export function createActionRegistry() {
  const handlers = new Map();

  function register(map) {
    for (const [action, fn] of Object.entries(map || {})) {
      if (typeof fn === "function") handlers.set(action, fn);
    }
  }

  function has(action) {
    return handlers.has(action);
  }

  async function dispatch(action, ctx) {
    const fn = handlers.get(action);
    if (!fn) return false;
    await fn(ctx);
    return true;
  }

  function list() {
    return [...handlers.keys()].sort();
  }

  return { register, has, dispatch, list };
}
