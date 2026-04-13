import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user) return null;

        const isValid = await compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) return null;

        // Includiamo role, active, employeeId nel token JWT
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
          employeeId: user.employeeId,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = user as any;
        token.role = (u.role as string) ?? "EMPLOYEE";
        token.active = (u.active as boolean) ?? false;
        token.employeeId = (u.employeeId as string | null) ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const su = session.user as any;
        su.id = token.id;
        su.role = token.role;
        su.active = token.active;
        su.employeeId = token.employeeId;
      }
      return session;
    },
  },
});
