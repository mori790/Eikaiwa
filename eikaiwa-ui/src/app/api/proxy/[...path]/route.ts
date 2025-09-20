import { NextRequest } from "next/server";
import crypto from "crypto";

const BACKEND = process.env.BACKEND_URL!;
const HMAC_SECRET = process.env.API_HMAC_SECRET!;

function sign(email: string, ts: string) {
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(`${email}.${ts}`)
    .digest("hex");
}

async function forward(req: NextRequest, path: string[]) {
  // Temporarily bypass authentication for testing
  const email = "test@example.com"; // Default email for testing

  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(email, ts);

  const url = `${BACKEND}/${path.join("/")}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") ?? "",
      "x-user-email": email,
      "x-timestamp": ts,
      "x-signature": sig,
    },
    body: ["GET", "HEAD"].includes(req.method)
      ? undefined
      : await req.arrayBuffer(),
  };
  const res = await fetch(url, init);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return forward(req, path);
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return forward(req, path);
}
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return forward(req, path);
}
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return forward(req, path);
}
