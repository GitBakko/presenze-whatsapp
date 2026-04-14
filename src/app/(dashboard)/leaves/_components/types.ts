export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  typeLabel: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  timeSlots: { from: string; to: string }[] | null;
  sickProtocol: string | null;
  notes: string | null;
  status: string;
  source: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface CalendarEvent {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  typeLabel: string;
  status: string;
  hours: number | null;
  startDate: string;
  endDate: string;
  timeSlots: { from: string; to: string }[] | null;
  notes: string | null;
  source: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface CalendarDay {
  date: string;
  events: CalendarEvent[];
}

export interface Employee {
  id: string;
  name: string;
  displayName: string | null;
}

export interface LeaveBalance {
  year: number;
  vacationAccrued: number;
  vacationAccrualAdjust?: number;
  vacationUsed: number;
  vacationCarryOver: number;
  vacationRemaining: number;
  rolAccrued: number;
  rolAccrualAdjust?: number;
  rolUsed: number;
  rolCarryOver: number;
  rolRemaining: number;
  sickDays: number;
  weeklyHours: number;
  contractType: string;
}

export interface ByEmployeeRequest {
  id: string;
  type: string;
  typeLabel: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  status: string;
  source: string;
  notes: string | null;
  createdAt: string;
}

export interface ByEmployeeCard {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  balance: LeaveBalance | null;
  requests: ByEmployeeRequest[];
}

export const LEAVE_TYPE_OPTIONS = [
  { value: "VACATION", label: "Ferie (giornata intera)" },
  { value: "VACATION_HALF_AM", label: "Ferie (mattina)" },
  { value: "VACATION_HALF_PM", label: "Ferie (pomeriggio)" },
  { value: "ROL", label: "Permesso orario (ROL)" },
  { value: "SICK", label: "Malattia" },
  { value: "BEREAVEMENT", label: "Lutto" },
  { value: "MARRIAGE", label: "Matrimonio" },
  { value: "LAW_104", label: "L. 104" },
  { value: "MEDICAL_VISIT", label: "Visita medica" },
];

export const TYPE_COLORS: Record<string, string> = {
  VACATION: "bg-blue-100 text-blue-800",
  VACATION_HALF_AM: "bg-blue-50 text-blue-700",
  VACATION_HALF_PM: "bg-blue-50 text-blue-700",
  ROL: "bg-amber-100 text-amber-800",
  SICK: "bg-red-100 text-red-800",
  BEREAVEMENT: "bg-purple-100 text-purple-800",
  MARRIAGE: "bg-pink-100 text-pink-800",
  LAW_104: "bg-teal-100 text-teal-800",
  MEDICAL_VISIT: "bg-cyan-100 text-cyan-800",
};

export const STATUS_COLORS: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  REJECTED: "bg-red-100 text-red-800",
};

export const STATUS_LABELS: Record<string, string> = {
  APPROVED: "Approvata",
  PENDING: "In attesa",
  REJECTED: "Rifiutata",
};
