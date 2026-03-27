import { auth } from "./auth";

export async function checkAuth() {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Non autorizzato" }, { status: 401 });
  }
  return null;
}
