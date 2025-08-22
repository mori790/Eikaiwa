import Google from "next-auth/providers/google";
import NextAuth from "next-auth";

// 環境変数からメールアドレスを取り出す
const allow = (process.env.ALLOWLIST_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const authOptions = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" as const },
  callbacks: {
    async signIn({ profile }: { profile?: any }) {
      const email = (profile?.email ?? "").toLowerCase();
      return allow.length === 0 || allow.includes(email);
    },
    async jwt({ token, profile }: { token: any; profile?: any }) {
      if (profile?.email) token.email = profile.email.toLowerCase();
      return token;
    },
    async session({ session, token }: { session: any; token: any }) {
      if (token?.email) (session.user as any).email = token.email;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const { handlers } = NextAuth(authOptions);
export const { GET, POST } = handlers;