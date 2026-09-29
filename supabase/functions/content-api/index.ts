// Cửa duy nhất cho runner Content trên máy Duy (header X-Content-Secret = CONTENT_RUNNER_SECRET)
import { contentApi } from "../_shared/content-server.ts";
Deno.serve(contentApi);
