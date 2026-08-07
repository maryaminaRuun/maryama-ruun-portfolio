import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import AdminPanel from "./AdminPanel";
export const dynamic="force-dynamic";
export default async function AdminPage(){const user=await requireChatGPTUser("/admin");if(user.email.toLowerCase()!=="ruun4646@gmail.com")return <main className="admin-denied"><h1>Access denied</h1><p>This dashboard is restricted to the portfolio owner.</p><a href="/">Return to portfolio</a></main>;return <AdminPanel name={user.displayName} signOut={chatGPTSignOutPath("/")}/>;}
