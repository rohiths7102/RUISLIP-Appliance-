"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton({ signinPath }: { signinPath: string }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push(signinPath);
        router.refresh();
      }}
      className="rounded-full border border-navy/20 px-3 py-1 hover:border-blue"
    >
      Log out
    </button>
  );
}
