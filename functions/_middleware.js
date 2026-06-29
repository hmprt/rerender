export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === "www.rerender.app") {
    url.hostname = "rerender.app";
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
