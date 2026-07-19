import { requireAdmin } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import ChatbotAdmin from "@/components/admin/ChatbotAdmin";
export const dynamic = "force-dynamic";
export default async function AdminChatbot() {
  const admin = await requireAdmin();
  return <AdminShell active="/admin/chatbot" email={admin.email}><ChatbotAdmin /></AdminShell>;
}
