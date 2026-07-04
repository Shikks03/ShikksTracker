"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Contacts" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/review", label: "Review Queue" },
  { href: "/import", label: "Import" },
  { href: "/suppressions", label: "Suppressions" },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-gray-200 bg-white px-6 py-3 flex gap-6 items-center">
      <span className="font-semibold text-gray-800 mr-4">ShikksTracker</span>
      {NAV_LINKS.map(({ href, label }) => {
        const active =
          href === "/"
            ? pathname === "/"
            : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? "text-blue-600 font-medium text-sm border-b-2 border-blue-600 pb-0.5"
                : "text-gray-600 hover:text-gray-900 text-sm"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
