// eikaiwa-ui/src/middleware.ts
export { auth as middleware } from "@/auth";
export const config = { matcher: ["/((?!api/auth|_next|favicon.ico).*)"] };
