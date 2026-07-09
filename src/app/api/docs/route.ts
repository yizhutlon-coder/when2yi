import { NextResponse } from "next/server";
import { openapi } from "@/lib/openapi";

/** GET /api/docs → OpenAPI JSON; GET /api/docs?ui=1 → Swagger UI. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("ui") === null) {
    return NextResponse.json(openapi);
  }
  const html = `<!doctype html>
<html>
<head>
  <title>When2Yi API</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui.min.css" />
</head>
<body>
  <div id="ui"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14/swagger-ui-bundle.min.js"></script>
  <script>SwaggerUIBundle({ url: "/api/docs", dom_id: "#ui" });</script>
</body>
</html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html" } });
}
