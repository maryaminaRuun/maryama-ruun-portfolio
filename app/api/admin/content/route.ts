import { adminGuard, audit } from "../../../../lib/admin";
import { createItem, deleteRow, getDashboard, reorderItems, setItemFeatured, setItemStatus, setMessageStatus, updateItem, AdminError } from "../../../../lib/admin-content";
import { handle, idFrom, json } from "../../../../lib/api";

export async function GET(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor");
    if (!g.ok) return g.response;
    const days = Number(new URL(request.url).searchParams.get("days") || 30);
    return json({ me: g.admin, ...(await getDashboard(g.db, g.admin.role, days)) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor", { mutating: true });
    if (!g.ok) return g.response;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = await createItem(g.db, body);
    await audit(g.db, g.admin.email, "create", String(body.type), id, { title: body.title });
    return json({ ok: true, id });
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor", { mutating: true });
    if (!g.ok) return g.response;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = idFrom(body.id);
    await updateItem(g.db, id, body);
    await audit(g.db, g.admin.email, "update", "content", id, { title: body.title });
    return json({ ok: true });
  });
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "editor", { mutating: true });
    if (!g.ok) return g.response;
    const b = (await request.json().catch(() => ({}))) as { id?: unknown; ids?: unknown; status?: unknown; table?: unknown; action?: unknown; featured?: unknown };
    const action = b.action ?? (b.table === "messages" ? "message-status" : "status");
    if (action === "reorder") {
      await reorderItems(g.db, Array.isArray(b.ids) ? (b.ids as number[]) : []);
      await audit(g.db, g.admin.email, "reorder", "content", null);
      return json({ ok: true });
    }
    const id = idFrom(b.id);
    if (action === "message-status") {
      if (g.admin.role !== "owner") throw new AdminError("Only the portfolio owner can manage messages.", 403);
      await setMessageStatus(g.db, id, b.status);
    } else if (action === "featured") {
      await setItemFeatured(g.db, id, b.featured === true);
      await audit(g.db, g.admin.email, b.featured ? "feature" : "unfeature", "project", id);
    } else {
      await setItemStatus(g.db, id, b.status);
      await audit(g.db, g.admin.email, "status", "content", id, { status: b.status });
    }
    return json({ ok: true });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const g = await adminGuard(request, "owner", { mutating: true });
    if (!g.ok) return g.response;
    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table") === "messages" ? "messages" : "items";
    const id = idFrom(searchParams.get("id"));
    await deleteRow(g.db, table, id);
    await audit(g.db, g.admin.email, "delete", table, id);
    return json({ ok: true });
  });
}
