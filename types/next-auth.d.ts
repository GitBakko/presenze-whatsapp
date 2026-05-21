import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "EMPLOYEE";
    active: boolean;
    employeeId: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: "ADMIN" | "EMPLOYEE";
      active: boolean;
      employeeId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "ADMIN" | "EMPLOYEE";
    active: boolean;
    employeeId: string | null;
  }
}
