import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details/[id]
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const detail = await getRequestDetailById(id);

    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ detail });
  } catch (error) {
    console.error("[API] Failed to get request detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch request detail" },
      { status: 500 }
    );
  }
}
