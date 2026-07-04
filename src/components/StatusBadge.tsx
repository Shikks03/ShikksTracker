type StatusBadgeProps = { value: string };

const COLOR_MAP: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  replied: "bg-blue-100 text-blue-800",
  bounced: "bg-red-100 text-red-800",
  unsubscribed: "bg-gray-100 text-gray-600",
  draft: "bg-gray-100 text-gray-700",
  approved: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-800",
};

export default function StatusBadge({ value }: StatusBadgeProps) {
  const cls = COLOR_MAP[value] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {value}
    </span>
  );
}
