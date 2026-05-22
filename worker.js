export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/owner/ping") {
      return Response.json({
        ok: true,
        worker: "alive",
        configured_key_exists: Boolean(env.ADMIN_KEY),
        time: new Date().toISOString()
      });
    }

    return env.ASSETS.fetch(request);
  }
};
