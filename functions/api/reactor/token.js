const allowedOriginPattern =
  /^https?:\/\/(localhost|127\.0\.0\.1):517\d$|^https:\/\/([a-z0-9-]+\.)?rerender\.app$|^https:\/\/([a-z0-9-]+\.)?rerender\.pages\.dev$/i;

function responseHeaders(request) {
  const origin = request.headers.get("Origin") ?? "";
  const headers = {
    "Content-Type": "application/json",
  };

  if (allowedOriginPattern.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }

  return headers;
}

function json(request, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: responseHeaders(request),
    status,
  });
}

export function onRequestOptions({ request }) {
  return new Response(null, {
    headers: responseHeaders(request),
    status: 204,
  });
}

export async function onRequestPost({ env, request }) {
  const body = await request.json().catch(() => ({}));
  const submittedKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const apiKey = submittedKey || env.REACTOR_API_KEY || env.REACTR_API_KEY;

  if (!apiKey) {
    return json(request, { error: "Enter a Reactor API key before connecting." }, 400);
  }

  try {
    const reactorResponse = await fetch("https://api.reactor.inc/tokens", {
      headers: {
        "Reactor-API-Key": apiKey,
      },
      method: "POST",
    });

    const payload = await reactorResponse.json().catch(() => ({}));
    if (!reactorResponse.ok) {
      return json(
        request,
        {
          error: payload?.error ?? payload?.message ?? "Reactor token request failed.",
        },
        reactorResponse.status,
      );
    }

    return json(request, payload);
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Unable to reach Reactor." }, 502);
  }
}
