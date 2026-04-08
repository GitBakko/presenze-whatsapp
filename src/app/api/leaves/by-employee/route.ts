import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkAuth } from "@/lib/auth-guard";
import { computeLeaveBalance, LEAVE_TYPES, type LeaveType } from "@/lib/leaves";

/**
 * GET /api/leaves/by-employee
 *
 * Vista "Per dipendente" della pagina /leaves.
 *
 * Per ogni dipendente attivo restituisce:
 *   - profilo base (id, nome visualizzato, avatar)
 *   - saldo annuale completo (ferie/ROL/malattia) via computeLeaveBalance
 *   - tutte le richieste dell'anno corrente, ordinate per data inizio desc
 *
 * Ordinamento card: alfabetico per nome (A→Z).
 */
export async function GET() {
  const denied = await checkAuth();
  if (denied) return denied;

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
  });

  // Tutte le richieste dell'anno per tutti i dipendenti, in una query
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      OR: [
        { startDate: { gte: yearStart, lte: yearEnd } },
        { endDate: { gte: yearStart, lte: yearEnd } },
      ],
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });

  // Raggruppa richieste per employeeId
  const leavesByEmp = new Map<string, typeof leaves>();
  for (const l of leaves) {
    if (!leavesByEmp.has(l.employeeId)) leavesByEmp.set(l.employeeId, []);
    leavesByEmp.get(l.employeeId)!.push(l);
  }

  // Calcola il balance per ogni dipendente in parallelo
  const result = await Promise.all(
    employees.map(async (emp) => {
      let balance = null;
      try {
        balance = await computeLeaveBalance(emp.id, year);
      } catch {
        // Se per qualche motivo il calcolo fallisce (es. employee senza
        // schedule e senza contractType valido), restituiamo null e la
        // UI mostra "—" al posto dei numeri.
      }
      const empLeaves = leavesByEmp.get(emp.id) ?? [];
      return {
        id: emp.id,
        name: emp.name,
        displayName: emp.displayName || emp.name,
        avatarUrl: emp.avatarUrl,
        balance,
        requests: empLeaves.map((l) => ({
          id: l.id,
          type: l.type,
          typeLabel: LEAVE_TYPES[l.type as LeaveType]?.label ?? l.type,
          startDate: l.startDate,
          endDate: l.endDate,
          hours: l.hours,
          status: l.status,
          source: l.source,
          notes: l.notes,
          createdAt: l.createdAt.toISOString(),
        })),
      };
    })
  );

  return NextResponse.json({ year, employees: result });
}
