from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ..core.security import CurrentUser, get_current_user, require_admin
from ..services.audit import audit
from ..services.mapping import IST

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


def _month_bounds(month: str) -> tuple[date, date]:
    y, m = (int(p) for p in month.split("-"))
    start = date(y, m, 1)
    end = (start + timedelta(days=32)).replace(day=1)
    return start, end


def _utc(d: date) -> str:
    return datetime(d.year, d.month, d.day, tzinfo=IST).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _schedule(user: CurrentUser) -> list[dict]:
    rows, _ = await user.db().select("app_settings", {"key": "eq.automation_schedule", "select": "value"})
    items = rows[0]["value"] if rows else []
    return [i for i in items if i.get("department") in user.departments]


@router.get("")
async def month_view(month: str = Query(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), user: CurrentUser = Depends(get_current_user)):
    start, end = _month_bounds(month)
    days_in_month = (end - start).days
    db = user.db()

    people = await db.rpc("calendar_dates", {"p_month": start.month})
    dates = [{
        "date": start.replace(day=min(p["day"], days_in_month)).isoformat(),
        "kind": p["kind"], "doctor_id": p["doctor_id"], "doctor_name": p["doctor_name"],
        "department": p["department"], "sub_department": p["sub_department"],
        "year": int(p["original"][:4]) if p.get("original") and int(p["original"][:4]) > 1904 else None,
    } for p in people]

    events = await db.select_all("communication_events", [
        ("select", "department,channel,campaign,event_type,status,occurred_at"),
        ("occurred_at", f"gte.{_utc(start)}"), ("occurred_at", f"lt.{_utc(end)}"),
    ])
    outreach: Counter = Counter()
    for e in events:
        day = datetime.fromisoformat(e["occurred_at"].replace("Z", "+00:00")).astimezone(IST).date().isoformat()
        outreach[(day, e["department"], e["channel"], e["campaign"] or e["event_type"], e["status"])] += 1

    feedback_rows = await db.select_all("patient_feedback", [
        ("select", "department,request_date,whatsapp_status"),
        ("request_date", f"gte.{start.isoformat()}"), ("request_date", f"lt.{end.isoformat()}"),
    ])
    feedback: Counter = Counter((f["request_date"], f["department"], f["whatsapp_status"] or "Pending") for f in feedback_rows)

    schedule = []
    for item in await _schedule(user):
        for d in item.get("days", []):
            if 1 <= int(d) <= days_in_month:
                schedule.append({
                    "date": start.replace(day=int(d)).isoformat(), "name": item.get("name"),
                    "department": item.get("department"), "time": item.get("time") or None, "note": item.get("note"),
                })

    return {
        "month": month,
        "dates": dates,
        "outreach": [
            {"date": k[0], "department": k[1], "channel": k[2], "campaign": k[3], "status": k[4], "count": v}
            for k, v in sorted(outreach.items())
        ],
        "feedback": [{"date": k[0], "department": k[1], "status": k[2], "count": v} for k, v in sorted(feedback.items())],
        "schedule": schedule,
    }


@router.get("/upcoming")
async def upcoming(days: int = Query(30, ge=0, le=366), user: CurrentUser = Depends(get_current_user)):
    db = user.db()
    rows = await db.rpc("upcoming_dates", {"p_days": days})
    counts = await db.rpc("doctors_with_dates")
    return {"items": rows, **counts}


@router.get("/schedule")
async def get_schedule(user: CurrentUser = Depends(get_current_user)):
    return await _schedule(user)


class ScheduleItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    department: str = Field(pattern="^(NPP|RARE_DISEASES)$")
    days: list[int] = Field(min_length=1, max_length=31)
    time: str | None = Field(None, pattern=r"^$|^([01]\d|2[0-3]):[0-5]\d$")
    note: str | None = Field(None, max_length=300)


@router.put("/schedule")
async def save_schedule(items: list[ScheduleItem], request: Request, user: CurrentUser = Depends(require_admin)):
    clean = []
    for i in items:
        days = sorted({d for d in i.days if 1 <= d <= 31})
        if days:
            clean.append({**i.model_dump(), "days": days, "time": i.time or ""})
    await user.db().insert("app_settings", {
        "key": "automation_schedule", "value": clean, "updated_by": user.id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key", resolution="merge-duplicates")
    await audit("Settings changed", user, "automation_schedule", None, {"items": len(clean)}, request)
    return clean
