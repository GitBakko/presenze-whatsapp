import { auth } from "./auth";

export interface AuthUser {
  id: string;
  role: "ADMIN" | "EMPLOYEE";
  active: boolean;
  employeeId: string | null;
}

/**
 * Verifica che l'utente sia loggato E sia admin attivo.
 * Usata da tutte le route di amministrazione (dipendenti, impostazioni,
 * report, anomalie, ecc.).
 *
 * Restituisce null se OK, Response se errore.
 */
export async function checkAuth(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const user = session.user as AuthUser;
  if (!user.active) {
    return Response.json({ error: "Account non attivato" }, { status: 403 });
  }
  if (user.role !== "ADMIN") {
    return Response.json({ error: "Accesso riservato agli amministratori" }, { status: 403 });
  }
  return null;
}

/**
 * Verifica che l'utente sia loggato E attivo (qualsiasi ruolo).
 * Usata dalle route accessibili sia da admin che da dipendenti.
 *
 * Restituisce l'AuthUser se OK, Response se errore.
 */
export async function checkAuthAny(): Promise<AuthUser | Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const user = session.user as AuthUser;
  if (!user.active) {
    return Response.json({ error: "Account non attivato" }, { status: 403 });
  }
  return user;
}

/** Type guard: true se il risultato e' un AuthUser (non un Response). */
export function isAuthUser(result: AuthUser | Response): result is AuthUser {
  return !(result instanceof Response);
}
