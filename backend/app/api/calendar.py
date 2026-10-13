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

    follow = await db.rpc("follow_up_reminders")
    due: Counter = Counter()
    for f in follow:
        if f.get("due_date") and start.isoformat() <= f["due_date"] < end.isoformat():
            due[(f["due_date"], f["department"])] += 1
    return {
        "month": month,
        "follow_ups": [{"date": k[0], "department": k[1], "count": v} for k, v in sorted(due.items())],
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


@router.get("/people")
async def people(kind: str = Query(..., pattern="^(birthday|anniversary)$"), user: CurrentUser = Depends(get_current_user)):
    """Every doctor with this kind of date, soonest first (Birthdays / Work Anniversaries pages)."""
    rows = await user.db().rpc("important_dates", {"p_kind": kind})
    for r in rows:
        orig = r.get("original") or ""
        r["year"] = int(orig[:4]) if orig[:4].isdigit() and int(orig[:4]) > 1904 else None
    return {"kind": kind, "items": rows}


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


# ------------------------------------------------------------------ reminders
reminders_router = APIRouter(prefix="/api/reminders", tags=["reminders"])


def _today_ist() -> date:
    return datetime.now(IST).date()


@reminders_router.get("")
async def reminders(user: CurrentUser = Depends(get_current_user)):
    """Everything that needs action: follow-up emails due, failed emails, doctors eligible
    again for FDA messages, birthdays/anniversaries this week and new FDA molecules."""
    db = user.db()
    today = _today_ist()
    follow = await db.rpc("follow_up_reminders")
    for f in follow:
        due = date.fromisoformat(f["due_date"]) if f.get("due_date") else None
        f["days_overdue"] = (today - due).days if due else None
        f["bucket"] = ("failed" if not f.get("last_sent_at") else
                       "overdue" if due and due < today else
                       "today" if due == today else
                       "week" if due and due <= today + timedelta(days=7) else "later")
    follow.sort(key=lambda f: (not f.get("must_see"), f["due_date"] or "9999"))
    soon = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    fda_eligible, _ = await db.select("doctors", [
        ("select", "id,doctor_name,department,sub_department,institute,must_see,last_message_sent_at,next_eligible_at,contact_frequency"),
        ("last_message_sent_at", "not.is.null"), ("or", f"(next_eligible_at.is.null,next_eligible_at.lte.{soon})"),
        ("order", "must_see.desc,next_eligible_at.asc.nullsfirst"), ("limit", "200")])
    dates = await db.rpc("upcoming_dates", {"p_days": 7})
    molecules = [m for m in await db.rpc("new_molecules", {"p_days": 365})
                 if m.get("india_status") in ("NOT_FOUND", "MANUAL_NOT_APPROVED")]
    settings_rows, _ = await db.select("app_settings", {"key": "eq.reminder_settings", "select": "value"})
    return {
        "today": today.isoformat(),
        "follow_ups": follow,
        "fda_eligible": fda_eligible,
        "important_dates": dates,
        "new_molecules": molecules,
        "settings": (settings_rows[0]["value"] if settings_rows else {}) or {"npp_days": 20, "rare_days": 15},
    }


class ReminderSettings(BaseModel):
    npp_days: int = Field(ge=1, le=365)
    rare_days: int = Field(ge=1, le=365)


@reminders_router.put("/settings")
async def save_reminder_settings(body: ReminderSettings, request: Request, user: CurrentUser = Depends(require_admin)):
    await user.db().insert("app_settings", {
        "key": "reminder_settings", "value": body.model_dump(), "updated_by": user.id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="key", resolution="merge-duplicates")
    await audit("Settings changed", user, "reminder_settings", None, body.model_dump(), request)
    return body.model_dump()
